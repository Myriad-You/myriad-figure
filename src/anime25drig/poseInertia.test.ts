import assert from 'node:assert/strict'
import test from 'node:test'
import { IDENTITY_DRIVER } from './driver'
import { Anime25DPoseInertia } from './poseInertia'

const FPS = 60

function follow(inertia: Anime25DPoseInertia, targets: Partial<typeof IDENTITY_DRIVER>, seconds: number) {
  const frames: Array<typeof IDENTITY_DRIVER> = []
  for (let i = 0; i < seconds * FPS; i += 1) {
    const pose = { ...IDENTITY_DRIVER, ...targets }
    inertia.step(pose, 1 / FPS)
    frames.push(pose)
  }
  return frames
}

test('a jump in the composed pose becomes a carried movement that arrives', () => {
  const inertia = new Anime25DPoseInertia()
  follow(inertia, {}, 0.1)
  // A cue or a hand-off that tilts the head 22° at once.
  const frames = follow(inertia, { angleZ: 0.75, angleY: -0.5 }, 1)
  const roll = frames.map((pose) => pose.angleZ)
  const fastest = Math.max(...roll.slice(1).map((value, i) => Math.abs(value - roll[i]!) * FPS))
  assert.ok(fastest <= 6 + 1e-9, `roll speed ${fastest} units/s stays under the cap`)
  assert.ok(roll[0]! <= 0.1 + 1e-9, 'not there at once')
  assert.ok(Math.abs(roll.at(-1)! - 0.75) < 0.01 && Math.abs(frames.at(-1)!.angleY + 0.5) < 0.01, 'but it gets there')
})

test('a held pose passes through untouched, and only head and torso are carried', () => {
  const inertia = new Anime25DPoseInertia()
  follow(inertia, { angleX: 0.4 }, 0.1)
  const [first] = follow(inertia, { angleX: 0.4, eyeX: 1, mouthOpen: 1 }, 1 / FPS)
  assert.equal(first!.angleX, 0.4)
  assert.equal(first!.eyeX, 1)
  assert.equal(first!.mouthOpen, 1)
})

test('every frame rate carries the same movement the same way', () => {
  // A head turn arriving at once, then a slow sway: at 120 fps and at 30 the body follows alike.
  const at = (fps: number) => {
    const inertia = new Anime25DPoseInertia()
    const samples: number[] = []
    for (let frame = 0; frame < fps * 1.5; frame += 1) {
      // The player advances its clock before it composes, so a frame's pose is its end's.
      const time = (frame + 1) / fps
      const pose = { ...IDENTITY_DRIVER, angleX: time <= 0.1 ? 0 : 0.9 + 0.3 * Math.sin(time * 4), body: time <= 0.1 ? 0 : 0.6 }
      inertia.step(pose, 1 / fps)
      if ((frame + 1) % (fps / 10) === 0) samples.push(pose.angleX, pose.body)
    }
    return samples
  }
  const finest = at(240)
  for (const fps of [30, 60, 120]) {
    const samples = at(fps)
    const worst = Math.max(...samples.map((value, i) => Math.abs(value - finest[i]!)))
    assert.ok(worst < 0.02, `${fps} fps strays ${worst} from 240 fps`)
  }
})

test('the composition gets its own pose back, not the carried one', () => {
  const inertia = new Anime25DPoseInertia()
  follow(inertia, {}, 0.1)
  const pose = { ...IDENTITY_DRIVER, angleX: 0.8, eyeX: 0.3 }
  inertia.step(pose, 1 / FPS)
  assert.ok(pose.angleX < 0.8, 'the body lags the jump')
  pose.eyeX = 0.5
  inertia.release(pose)
  assert.equal(pose.angleX, 0.8)
  assert.equal(pose.eyeX, 0.5, 'channels it does not carry are left alone')
})
