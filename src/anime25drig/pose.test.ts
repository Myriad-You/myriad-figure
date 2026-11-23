import type { Anime25DPose } from './pose'
import assert from 'node:assert/strict'
import test from 'node:test'
import { IDENTITY_DRIVER } from './driver'
import { blendPoses, poseFromJSON, poseToJSON } from './pose'

function poseOf(at: number, gesture = 'wave'): Anime25DPose {
  return {
    version: 1,
    figure: '2-abc',
    time: at,
    driver: { ...IDENTITY_DRIVER, angleX: at, talk: at > 0.5 },
    frame: { viewWidth: 10, viewHeight: 20, bodyPivotX: at, bodyPivotY: 0, bodyRotationCosine: 1, bodyRotationSine: 0, bodyBendHeight: 0, time: at, eyeCry: 0 },
    order: Uint16Array.of(at > 0.5 ? 1 : 0, at > 0.5 ? 0 : 1),
    layers: [
      { transform: Float32Array.of(1, 0, 0, 0, 1, 0, at, 0, 1), opacity: at, multiply: null, behindFace: 0, vertices: Float32Array.of(0.1 + at, 1 / 3) },
      { transform: Float32Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1), opacity: 1, multiply: Float32Array.of(1, 1, at), behindFace: 1, vertices: null },
    ],
    collar: null,
    mouth: { wide: at, round: 0, narrow: 0 },
    sticker: at > 0.5 ? { time: at, amount: 1, x: 0, y: 0, size: 1 } : null,
    arms: [{
      side: 'L',
      now: {
        gesture, twist: at, cuff: 1, radius: [1, 2 + at], restEnd: 1, ink: null,
        joints: { s: [0, 0, 0], e: [1, at, 0], w: [2, 0, at], hand: [[at, 0, 0]] },
        presence: 1, handRest: 0, hanging: 0, restNear: 0, unlined: 0, foot: [[at, 0]], sides: [-Infinity, 5 + at],
        held: null, rest: null, also: [{ gesture: 'wave', weight: at }, { gesture: 'point', weight: 0 }],
      },
      leaving: null,
      cloths: [{ nodes: Float32Array.of(at, 0), under: Uint16Array.of(0, 1, 2), front: Uint16Array.of() }, null],
    }],
  }
}

test('a pose is itself again from JSON, to the bit', () => {
  const pose = poseOf(0.7)
  assert.deepEqual(poseFromJSON(poseToJSON(pose)), pose)
})

test('vertices that are a view of a longer buffer are written as their own', () => {
  const pose = poseOf(0.2)
  pose.arms[0]!.cloths[0]!.under = Uint16Array.of(9, 9, 0, 1, 2, 9).subarray(2, 5)
  assert.deepEqual(poseFromJSON(poseToJSON(pose)).arms[0]!.cloths[0]!.under, Uint16Array.of(0, 1, 2))
})

test('between two poses, numbers are between and what cannot be is the nearer one\'s', () => {
  const [a, b] = [poseOf(0), poseOf(1)]
  const near = blendPoses(a, b, 0.25)
  assert.equal(near.time, 0.25)
  assert.equal(near.layers[0]!.transform[6], 0.25)
  assert.equal(near.layers[0]!.opacity, 0.25)
  assert.equal(near.layers[0]!.vertices![0], Math.fround(Math.fround(0.1) + (Math.fround(1.1) - Math.fround(0.1)) * 0.25))
  assert.deepEqual(near.order, a.order)
  assert.equal(near.sticker, null)
  assert.equal(near.driver.talk, false)
  const now = near.arms[0]!.now!
  assert.deepEqual(now.joints.w, [2, 0, 0.25])
  assert.deepEqual(now.sides, [-Infinity, 5.25])
  assert.equal(now.also![0]!.weight, 0.25)
  assert.deepEqual(near.arms[0]!.cloths[0]!.under, Uint16Array.of(0, 1, 2))
  const far = blendPoses(a, b, 0.75)
  assert.deepEqual(far.order, b.order)
  assert.deepEqual(far.sticker, b.sticker)
})

test('an arm between two gestures is in one picture or the other, and never between figures', () => {
  const [a, b] = [poseOf(0), poseOf(1, 'point')]
  assert.deepEqual(blendPoses(a, b, 0.25).arms[0]!.now, a.arms[0]!.now)
  assert.deepEqual(blendPoses(a, b, 0.75).arms[0]!.now, b.arms[0]!.now)
  const other = { ...b, figure: '2-def' }
  assert.equal(blendPoses(a, other, 0.25), a)
  assert.equal(blendPoses(a, other, 0.75), other)
})

test('at either end it is the pose itself, and neither is changed', () => {
  const [a, b] = [poseOf(0), poseOf(1)]
  blendPoses(a, b, 0.5)
  assert.deepEqual([a, b], [poseOf(0), poseOf(1)])
  assert.equal(blendPoses(a, b, 0), a)
  assert.equal(blendPoses(a, b, 1), b)
})
