import type { FigurePitchBinding } from './figurePitch'
import type { Anime25DPlaybackAnchors, Anime25DTorsoShellProfile } from './types'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bindFigurePitch,
  FIGURE_PITCH_BACK,
  FIGURE_PITCH_FORWARD,
  FigurePitch,
  figurePitchAngle,
  figurePitchRest,
} from './figurePitch'
import { figureRest } from './figureSkeleton'
import { leanAnime25DAttachment } from './layerAttachment'

// A figure 1400 tall: face 100–220, neck's foot 270, waist 451.5, hips 600, ground 1400.
const anchors = {
  face: { x0: 450, y0: 100, x1: 550, y1: 220, cx: 500, cy: 160 },
  neckPivot: { x: 500, y: 240 },
  neckTop: 220,
  neckBottom: 270,
  bodyPivot: { x: 500, y: 600 },
  groundY: 1400,
  mouth: { x0: 480, y0: 190, x1: 520, y1: 205, cx: 500, cy: 198 },
  faceScale: 1,
} as Anime25DPlaybackAnchors
const torso = { enabled: true, blend: 1, centerX: 500, radiusX: 120, radiusZ: 90, neckDepth: 0.25 } as Anime25DTorsoShellProfile
const UPRIGHT = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }

function leaning(angle: number, yaw = 0): FigurePitch {
  const rest = figurePitchRest(figureRest(anchors)!, torso, anchors.face, 360, [{ icy: 165 }], [{ y: 300 }])
  const pitch = new FigurePitch(rest)
  pitch.step(angle, Math.sin(yaw), Math.cos(yaw), UPRIGHT)
  return pitch
}

function carried(pitch: FigurePitch, kind: FigurePitchBinding['kind'], x: number, y: number) {
  const point = { x, y }
  pitch.carryPoint(point, { kind }, x, y)
  return point
}

test('upright, nothing is carried and the lean is not active', () => {
  const pitch = leaning(0)
  assert.equal(pitch.active, false)
  for (const kind of ['head', 'neck', 'trunk', 'arm'] as const) assert.deepEqual(carried(pitch, kind, 430, 333), { x: 430, y: 333 })
})

test('leaning in, the head comes nearer by about a quarter, upright, grown about its chin: its jaw stays on the neck', () => {
  const pitch = leaning(FIGURE_PITCH_FORWARD)
  assert.ok(pitch.head.scale > 1.15 && pitch.head.scale < 1.3, `${pitch.head.scale}`)
  const top = carried(pitch, 'head', 500, 100)
  const chin = carried(pitch, 'head', 500, 220)
  const side = carried(pitch, 'head', 550, 100)
  // One scale every way: the head is not stretched.
  assert.ok(Math.abs((chin.y - top.y) / 120 - (side.x - top.x) / 50) < 1e-9)
  assert.ok(Math.abs(top.x - 500) < 1e-9)
  // The chin comes down on the neck's foot only a little way: most of the neck still shows.
  const foot = carried(pitch, 'trunk', 500, 270)
  assert.ok(foot.y - chin.y > 50 * 0.55 && foot.y - chin.y < 50 * 1.1, `neck ${foot.y - chin.y}`)
  // ...where grown about its eyes its top stood still: now the crown comes up as the head nears.
  assert.ok(top.y < chin.y - 120 * 1.15)
})

test('leaning back, the head goes further and shows smaller', () => {
  const pitch = leaning(-FIGURE_PITCH_BACK)
  assert.ok(pitch.head.scale > 0.82 && pitch.head.scale < 0.92, `${pitch.head.scale}`)
})

test('the trunk turns about the hips: the shoulders grow more than the waist, and it shows shorter', () => {
  const pitch = leaning(FIGURE_PITCH_FORWARD)
  const width = (y: number) => carried(pitch, 'trunk', 600, y).x - carried(pitch, 'trunk', 400, y).x
  assert.ok(width(300) > width(440) + 2 && width(300) > 200, `${width(300)} ${width(440)}`)
  // The shoulders show their nearness plainly (several times the camera's own few percent), less than the head.
  assert.ok(width(300) > 200 * 1.06 && width(300) < 200 * pitch.head.scale, `${width(300)}`)
  const away = leaning(-FIGURE_PITCH_BACK)
  assert.ok(carried(away, 'trunk', 600, 300).x - carried(away, 'trunk', 400, 300).x < 200 * 0.96)
  // Along the trunk's side (where its depth adds nothing), from the shoulders down to the waist.
  const length = carried(pitch, 'trunk', 620, 451).y - carried(pitch, 'trunk', 620, 300).y
  assert.ok(length < 151 * 0.99, `${length}`)
})

test('the trunk and the legs are one field: a belt drawn with the shirt stays on its skirt, a thigh inside its skirt, a long hem on its feet', () => {
  // Whatever layer a point was cut into, where it was drawn says where it goes.
  for (const role of ['topwear', 'bottomwear', 'legwear', 'footwear', 'objects', 'collar_back']) {
    assert.deepEqual(bindFigurePitch(role, { group: 'body' }), { kind: 'trunk' })
  }
  assert.deepEqual(bindFigurePitch('face', { group: 'head' }), { kind: 'head' })
  const forward = leaning(FIGURE_PITCH_FORWARD, 0.45)
  const back = leaning(-FIGURE_PITCH_BACK, 0.45)
  const { ankleY } = forward.rest
  for (const pitch of [forward, back]) {
    // Down a column from the waist to the ground nothing folds and nothing jumps.
    let last = carried(pitch, 'trunk', 470, 440)
    for (let y = 441; y <= 1400; y += 1) {
      const next = carried(pitch, 'trunk', 470, y)
      assert.ok(next.y - last.y > 0.5 && next.y - last.y < 1.5 && Math.abs(next.x - last.x) < 0.5, `at ${y}: ${next.x - last.x} ${next.y - last.y}`)
      last = next
    }
    // The feet stand: a hem down at the ankles is still on them.
    assert.deepEqual(carried(pitch, 'trunk', 470, ankleY), { x: 470, y: ankleY })
    assert.deepEqual(carried(pitch, 'trunk', 470, 1390), { x: 470, y: 1390 })
  }
})

test('below the hips nothing is still but the feet: the legs lean the other way from the ankles, the hips going back under a trunk leaning in', () => {
  // Turned to the picture's right: forward is to the right, so hips gone back are to the left.
  const forward = leaning(FIGURE_PITCH_FORWARD, 0.45)
  const back = leaning(-FIGURE_PITCH_BACK, 0.45)
  const ankleY = forward.rest.ankleY
  const hip = carried(forward, 'trunk', 500, 640).x - 500
  const knee = carried(forward, 'trunk', 500, (640 + ankleY) / 2).x - 500
  assert.ok(hip < -10 && knee < hip / 2 + 2 && knee > hip, `${hip} ${knee}`)
  assert.ok(carried(back, 'trunk', 500, 640).x - 500 > 5)
  // The trunk stands on the hips the legs moved: its foot goes back with them, its head still comes forward.
  assert.ok(carried(forward, 'trunk', 500, 600).x - 500 < -10)
  assert.ok(carried(forward, 'head', 500, 160).x - 500 > 10)
  // The hips move far less than the chest over them.
  const front = leaning(FIGURE_PITCH_FORWARD)
  assert.ok(Math.abs(carried(front, 'trunk', 470, 760).y - 760) < (carried(front, 'trunk', 470, 330).y - 330) / 3)
  // Seen from the front the legs only near and recede: the hips, gone back, show a little smaller.
  const out = { scale: 1, x: 0, y: 0 }
  assert.ok(front.carryAt({ kind: 'trunk' }, 470, 640, out).scale < 0.99)
  assert.equal(front.carryAt({ kind: 'trunk' }, 470, ankleY, out).scale, 1)
  // A floating figure has no feet to keep its weight over: its legs hang as they hung.
  const floating = new FigurePitch(figurePitchRest(figureRest(anchors)!, torso, anchors.face, 360, [{ icy: 165 }], [{ y: 300 }], false))
  floating.step(FIGURE_PITCH_FORWARD, Math.sin(0.45), Math.cos(0.45), UPRIGHT)
  assert.deepEqual(carried(floating, 'trunk', 500, 700), { x: 500, y: 700 })
})

test('the neck is the chest\'s at its foot and the head\'s under the chin; an arm is the trunk\'s at the shoulder', () => {
  for (const angle of [FIGURE_PITCH_FORWARD, -FIGURE_PITCH_BACK]) {
    const pitch = leaning(angle)
    assert.deepEqual(carried(pitch, 'neck', 510, 270), carried(pitch, 'trunk', 510, 270))
    assert.deepEqual(carried(pitch, 'arm', 390, 300), carried(pitch, 'trunk', 390, 300))
  }
  const back = leaning(-FIGURE_PITCH_BACK)
  assert.deepEqual(carried(back, 'neck', 510, 220), carried(back, 'head', 510, 220))
})

test('a chin come down over the neck presses it short but never folds it; then the chin slides on over it', () => {
  for (const angle of [0.1, 0.2, FIGURE_PITCH_FORWARD, 0.45, 0.6]) {
    const pitch = leaning(angle)
    const chin = carried(pitch, 'head', 500, 220).y
    const top = carried(pitch, 'neck', 500, 220).y
    const foot = carried(pitch, 'neck', 500, 270).y
    assert.ok(foot - top > 50 * 0.3, `${angle}: ${foot - top}`)
    assert.ok(top <= chin + 1e-9, `${angle}: the neck's top stays under the chin`)
    // In every column: a necklace as wide as the shoulders, where the trunk's front is shallower, too.
    for (const x of [500, 540, 600, 620]) {
      let last = -Infinity
      for (let y = 220; y <= 270; y += 5) {
        const at = carried(pitch, 'neck', x, y).y
        assert.ok(at > last, `${angle}: in order at ${x}, ${y}`)
        last = at
      }
    }
  }
})

test('an arm hangs from its shoulder: down with it leaning in, and as one below the chest', () => {
  const pitch = leaning(FIGURE_PITCH_FORWARD)
  const elbow = carried(pitch, 'arm', 360, 450)
  const wrist = carried(pitch, 'arm', 360, 600)
  assert.ok(elbow.y > 450 && wrist.y > 600)
  // Not foreshortened like the trunk beside it: it is as long as drawn, times its nearness.
  assert.ok(Math.abs((wrist.y - elbow.y) / 150 - pitch.hung.scale) < 1e-9)
  assert.ok(pitch.hung.scale > 1.005 && pitch.hung.scale < pitch.head.scale)
})

test('turned to a side, it leans the way it faces', () => {
  const right = carried(leaning(FIGURE_PITCH_FORWARD, 0.45), 'head', 500, 160)
  const left = carried(leaning(FIGURE_PITCH_FORWARD, -0.45), 'head', 500, 160)
  const back = carried(leaning(-FIGURE_PITCH_BACK, 0.45), 'head', 500, 160)
  assert.ok(right.x > 520 && left.x < 480 && back.x < 490, `${right.x} ${left.x} ${back.x}`)
  assert.ok(Math.abs(right.x - 500 + (left.x - 500)) < 1e-9)
})

test('what swings from the head is thrown by how far the head travels, not by how much larger it shows', () => {
  const pitch = leaning(FIGURE_PITCH_FORWARD, 0.3)
  // Its chin is where the head grows about: carried, it is where the head has travelled to.
  const chin = carried(pitch, 'head', 500, 220)
  const travel = { x: chin.x - 500, y: chin.y - 220 }
  assert.ok(Math.hypot(travel.x, travel.y) > 20)
  for (const [x, y] of [[430, 110], [570, 110], [500, 60], [540, 300]] as const) {
    const root = carried(pitch, 'head', x, y)
    assert.ok(Math.hypot(root.x - x - travel.x, root.y - y - travel.y) > 4, 'a root off the chin is carried further or less, by the head\'s growth')
    pitch.headTravel(root)
    assert.ok(Math.abs(root.x - x - travel.x) < 1e-3 && Math.abs(root.y - y - travel.y) < 1e-3, `${root.x - x} ${root.y - y}`)
  }
  const upright = leaning(0)
  const point = { x: 430, y: 110 }
  upright.headTravel(point)
  assert.deepEqual(point, { x: 430, y: 110 })
})

/** Plays a lean asked for at once and held, frame by frame as the player does: posed, its springs stepped, then posed again to be drawn. */
function play(pitch: FigurePitch, angle: number, seconds: number, fps = 60, each?: (pitch: FigurePitch, frame: number) => void): void {
  for (let i = 0; i < seconds * fps; i += 1) {
    pitch.step(angle, 0, 1, UPRIGHT)
    pitch.follow(1 / fps, true)
    pitch.step(angle, 0, 1, UPRIGHT)
    each?.(pitch, i)
  }
}

test('a lean is taken in turn: the hips as asked, the chest after them and a little past, the hands last; then all of it settles where it was asked', () => {
  const held = leaning(FIGURE_PITCH_FORWARD)
  const want = { chest: carried(held, 'trunk', 500, 300).y, hip: carried(held, 'trunk', 500, 640).y, hand: carried(held, 'arm', 360, 600).y }
  const pitch = leaning(0)
  pitch.follow(1 / 60, true)
  const reached = { chest: -1, hand: -1 }
  let chestMost = 0
  let handMost = 0
  play(pitch, FIGURE_PITCH_FORWARD, 3, 60, (now, frame) => {
    // The hips and the legs are there with the asking, from the first frame.
    assert.ok(Math.abs(carried(now, 'trunk', 500, 640).y - want.hip) < 1e-6)
    const chest = carried(now, 'trunk', 500, 300).y - 300
    const hand = carried(now, 'arm', 360, 600).y - 600
    if (reached.chest < 0 && chest >= (want.chest - 300) * 0.5) reached.chest = frame
    if (reached.hand < 0 && hand >= (want.hand - 600) * 0.5) reached.hand = frame
    chestMost = Math.max(chestMost, chest / (want.chest - 300))
    handMost = Math.max(handMost, hand / (want.hand - 600))
  })
  assert.ok(reached.chest >= 3 && reached.hand > reached.chest + 2, `chest ${reached.chest}, hand ${reached.hand}`)
  assert.ok(chestMost > 1.03 && chestMost < 1.3, `the chest goes a little past: ${chestMost}`)
  assert.ok(handMost > chestMost && handMost < 1.6, `the hands further: ${handMost}`)
  assert.ok(Math.abs(carried(pitch, 'trunk', 500, 300).y - want.chest) < 0.05 && Math.abs(carried(pitch, 'arm', 360, 600).y - want.hand) < 0.05, 'and it settles where it was asked')
  // Let go, it swings back, comes to rest and is exactly upright again.
  play(pitch, 0, 0.2)
  assert.ok(pitch.active && carried(pitch, 'trunk', 500, 300).y > 300.5, 'still on its way back')
  play(pitch, 0, 6)
  pitch.step(0, 0, 1, UPRIGHT)
  assert.equal(pitch.active, false)
  assert.deepEqual(carried(pitch, 'arm', 360, 600), { x: 360, y: 600 })
})

test('with no physics the whole body is where the lean is asked, at once; and every frame rate moves alike', () => {
  const held = leaning(FIGURE_PITCH_FORWARD)
  const stiff = leaning(0)
  for (let i = 0; i < 5; i += 1) {
    stiff.step(FIGURE_PITCH_FORWARD, 0, 1, UPRIGHT)
    assert.deepEqual(carried(stiff, 'arm', 360, 600), carried(held, 'arm', 360, 600))
    stiff.follow(1 / 60, false)
  }
  const at = (fps: number) => {
    const pitch = leaning(0)
    pitch.follow(1 / fps, true)
    const samples: number[] = []
    play(pitch, -FIGURE_PITCH_BACK, 1.5, fps, (now, frame) => {
      if ((frame + 1) % (fps / 10) === 0) samples.push(carried(now, 'trunk', 500, 300).y, carried(now, 'arm', 360, 600).y)
    })
    return samples
  }
  const finest = at(240)
  for (const fps of [30, 60, 120]) {
    const worst = Math.max(...at(fps).map((value, i) => Math.abs(value - finest[i]!)))
    assert.ok(worst < 0.5, `${fps} fps strays ${worst} px from 240 fps`)
  }
})

test('what a nod recruits of the trunk is taken as it is: only a directed lean is taken in turn', () => {
  const nod = 0.05
  const pitch = leaning(0)
  pitch.follow(1 / 60, true)
  const held = leaning(nod)
  for (let i = 0; i < 30; i += 1) {
    pitch.step(nod, 0, 1, UPRIGHT, nod)
    assert.deepEqual(carried(pitch, 'arm', 360, 600), carried(held, 'arm', 360, 600))
    pitch.follow(1 / 60, true)
    assert.equal(pitch.thrown, false, 'and it throws nothing that hangs free: a nod did not before')
    assert.equal(pitch.hipsAcross, 0)
  }
  // The nod over, nothing is left swinging.
  pitch.step(0, 0, 1, UPRIGHT, 0)
  pitch.follow(1 / 60, true)
  pitch.step(0, 0, 1, UPRIGHT, 0)
  assert.equal(pitch.active, false)
})

test('a directed lean has its full range each way; a nod alone recruits a little', () => {
  assert.equal(figurePitchAngle(1, 0), FIGURE_PITCH_FORWARD)
  assert.equal(figurePitchAngle(-1, 0), -FIGURE_PITCH_BACK)
  assert.equal(figurePitchAngle(1, 1), FIGURE_PITCH_FORWARD)
  assert.ok(Math.abs(figurePitchAngle(0, 0.35)) < 0.07)
  assert.equal(figurePitchAngle(0, 0), 0)
})

test('what a leaning figure carries rigid (an earring, a hair clip) takes the size of its host there, about its anchor', () => {
  const attachment = { x: 540, y: 150, binding: { figurePitch: { kind: 'head' } } } as Parameters<typeof leanAnime25DAttachment>[0]
  const placed = (m: Float32Array, x: number, y: number) => [m[0]! * x + m[3]! * y + m[6]!, m[1]! * x + m[4]! * y + m[7]!]
  // Hung on its host a little turned, 12 across and 30 down from where it was drawn.
  const hung = () => Float32Array.from([Math.cos(0.1), Math.sin(0.1), 0, -Math.sin(0.1), Math.cos(0.1), 0, 12, 30, 1])
  const pitch = leaning(FIGURE_PITCH_FORWARD)
  const m = hung()
  leanAnime25DAttachment(attachment, { figure: { pitch } } as Parameters<typeof leanAnime25DAttachment>[1], m)
  const [ax, ay] = placed(hung(), 540, 150)
  const [bx, by] = placed(m, 540, 150)
  assert.ok(Math.abs(ax! - bx!) < 1e-3 && Math.abs(ay! - by!) < 1e-3, 'its anchor stays where its host put it')
  assert.ok(Math.abs(Math.hypot(m[0]!, m[1]!) - pitch.head.scale) < 1e-6 && Math.abs(Math.hypot(m[3]!, m[4]!) - pitch.head.scale) < 1e-6)
  const still = hung()
  leanAnime25DAttachment(attachment, { figure: { pitch: leaning(0) } } as Parameters<typeof leanAnime25DAttachment>[1], still)
  assert.deepEqual(still, hung())
})
