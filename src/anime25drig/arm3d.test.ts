import type { V3 } from './arm3dMath'
import type { Anime25DArmModel } from './types'
import assert from 'node:assert/strict'
import test from 'node:test'
import { affineFit, arm3DCutSides, arm3DOnBody, arm3DUpperArmAlone, sleeveLineHeldOff } from './arm3dArm'
import { similarity2D } from './arm3dMath'
import { arm3DHandMesh, arm3DPalmAsModelled, arm3DSleeveMesh, arm3DWristMesh } from './arm3dMesh'
import { Arm3DMotion, arm3DShape } from './arm3dMotion'
import { ringFill } from './arm3dPrepare'

// A left arm hanging from (420, 620), raised with its hand up beside the head; in a layer at (100, 50).
const hand: Array<[number, number]> = [[200, 420]]
for (const [dx, spread] of [[-40, -0.9], [-15, -0.3], [0, 0], [15, 0.3], [30, 0.6]] as const) {
  for (let j = 1; j <= 4; j += 1) hand.push([200 + dx + spread * 10 * j, 420 - (dx === -40 ? 15 : 40) - 22 * j])
}
const model: Anime25DArmModel = {
  upper: 230,
  fore: 280,
  radius: Array.from({ length: 24 }, (_, i) => 50 - i),
  cuff: 0.6,
  bare: 22,
  bareShift: 0,
  restEnd: 0.4,
  restReach: Array.from({ length: 24 }, () => [48, 48] as [number, number]),
  rest: { shoulder: [420, 620, 0], elbow: [400, 850, 0], wrist: [390, 1130, 0] },
  raised: { shoulder: [420, 620, 0], elbow: [200, 690, 40], wrist: [200, 420, 60] },
  hand,
  fingers: [9, 8, 8, 8, 7],
  fingerProfile: [],
  keyProfile: [],
  palmOutline: null,
  hiddenFingers: [],
  skin: [240, 210, 196],
  shade: [210, 170, 160],
  line: [90, 60, 60],
  handOutline: [],
  armOutline: [],
}
const shape = arm3DShape(model, 100, 50)

function run(motion: Arm3DMotion, from: number, seconds: number): number {
  let t = from
  for (let i = 0; i < seconds * 60; i += 1) motion.step((t += 1 / 60))
  return t
}

const near = (a: V3, b: V3, within: number) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= within

test('a model is moved off its layer onto the canvas, its lengths kept', () => {
  assert.deepEqual(shape.rest.s, [520, 670, 0])
  assert.deepEqual(shape.raised.w, [300, 470, 60])
  assert.deepEqual(shape.hand[0], [300, 470])
  assert.equal(shape.upper, 230)
  assert.equal('handOutline' in shape, false)
})

test('the arm hangs as the portrait draws it, rises to the gesture, holds, and comes back down to rest', () => {
  const motion = new Arm3DMotion(shape, false)
  const anchor = shape.rest.s
  let t = run(motion, 0, 0.1)
  const hanging = motion.keyPose(0, anchor)
  assert.ok(near(motion.pose(anchor).w, hanging.w, 1))
  assert.ok(motion.resting)
  motion.wanted = true
  t = run(motion, t, 2)
  // Hung from the portrait's shoulder, the gesture's wrist lands where its bones put it.
  const raised = motion.restPose(anchor)
  assert.ok(near(motion.pose(anchor).w, raised.w, 12), `${motion.pose(anchor).w} against ${raised.w}`)
  assert.ok(near(raised.w, shape.raised.w, 40))
  assert.equal(motion.resting, false)
  motion.wanted = false
  run(motion, t, 2)
  assert.ok(near(motion.pose(anchor).w, hanging.w, 1))
  assert.ok(motion.resting)
})

test('let go, the forearm comes down ahead of the upper arm', () => {
  const motion = new Arm3DMotion(shape, false)
  const anchor = shape.rest.s
  motion.wanted = true
  let t = run(motion, 0, 2)
  const hanging = motion.keyPose(0, anchor)
  const raised = motion.restPose(anchor)
  const dir = (a: V3, b: V3) => {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const l = Math.hypot(d[0], d[1], d[2])
    return d.map((x) => x / l)
  }
  const angle = (a: number[], b: number[]) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])))
  // How far down each part has come from the gesture, 0 to 1.
  const down = (p: { s: V3; e: V3; w: V3 }) => [
    1 - angle(dir(p.s, p.e), dir(hanging.s, hanging.e)) / angle(dir(raised.s, raised.e), dir(hanging.s, hanging.e)),
    1 - angle(dir(p.e, p.w), dir(hanging.e, hanging.w)) / angle(dir(raised.e, raised.w), dir(hanging.e, hanging.w)),
  ]
  motion.wanted = false
  let checked = false
  for (let i = 0; i < 120 && !checked; i += 1) {
    motion.step((t += 1 / 60))
    const [upper, fore] = down(motion.pose(anchor))
    if (upper < 0.5) continue
    assert.ok(fore > upper + 0.1, `forearm ${fore.toFixed(2)} down where the upper arm is ${upper.toFixed(2)}`)
    checked = true
  }
  assert.ok(checked)
})

test('the hand keeps its drawn shape on the way, bone lengths and all', () => {
  const motion = new Arm3DMotion(shape, true)
  motion.wanted = true
  const t = run(motion, 0, 0.25)
  const pose = motion.pose(shape.rest.s)
  const drawn = motion.restPose(shape.rest.s)
  const bone = (h: V3[], a: number, b: number) => Math.hypot(h[b][0] - h[a][0], h[b][1] - h[a][1], h[b][2] - h[a][2])
  for (const [a, b] of [[5, 6], [9, 10], [0, 17]]) assert.ok(Math.abs(bone(pose.hand, a, b) - bone(drawn.hand, a, b)) < 0.5)
  run(motion, t, 1)
})

test('meshes keep their vertices pose to pose, so pictures laid on them once stay on', () => {
  const motion = new Arm3DMotion(shape, false)
  const hanging = motion.keyPose(0, shape.rest.s)
  const raised = motion.restPose(shape.rest.s)
  const px = 2
  const a = arm3DSleeveMesh(shape, hanging, 1, px)
  const b = arm3DSleeveMesh(shape, raised, 0, px)
  // Bent, the sleeve only gains vertices (past the elbow) after those it shares with hanging.
  assert.ok(b.pos.length >= a.pos.length)
  assert.ok(a.uv.every((v, i) => i % 2 === 0 || (v >= 0 && v <= 1.05)))
  // What it gains wears the upper sleeve's rows back from the elbow, not the elbow's one row all along.
  const gained = b.uv.slice(a.uv.length).filter((_, i) => i % 2 === 1)
  assert.ok(gained.length > 0 && Math.max(...gained) < 0.52 && Math.min(...gained) < 0.4)
  // Its round end goes on from its tube with no step in the rows where the two meet (the end's own equator is
  // turned from the tube's last ring; the rows follow the upper arm on both).
  const du = [raised.e[0] - raised.s[0], raised.e[1] - raised.s[1], raised.e[2] - raised.s[2]]
  const dl = Math.hypot(du[0], du[1], du[2])
  const alongUpper = (m: typeof b, i: number) => ((m.pos[i * 3] - raised.e[0]) * du[0] + (m.pos[i * 3 + 1] - raised.e[1]) * du[1] + (m.pos[i * 3 + 2] - raised.e[2]) * du[2]) / dl
  const from = a.pos.length / 3
  const rows = Array.from({ length: b.pos.length / 3 - from }, (_, k) => [alongUpper(b, from + k), b.uv[(from + k) * 2 + 1]])
  const slope = 0.5 / dl
  assert.ok(rows.every(([x, v]) => Math.abs(v - (0.5 - x * slope)) < 1e-6))
  // The picture's upper arm is told from its elbow by the sleeve's rows: what it gains is marked as its own.
  assert.equal(a.gained, undefined)
  assert.ok(b.gained! > 0 && b.gained! < b.idx.length && b.idx.slice(b.gained).every((i) => i >= from))
  // Hanging bent, what it gains keeps the rows it had: the elbow's one row along the tube, the end's own round it.
  const bentHanging = arm3DSleeveMesh(shape, raised, 1, px)
  const kept = bentHanging.uv.slice(a.uv.length).filter((_, i) => i % 2 === 1)
  assert.ok(kept.slice(0, 3 * 37).every((v) => v === 0.5) && Math.max(...kept) > 0.5)
  const palm = arm3DPalmAsModelled(raised.hand, null)
  const h1 = arm3DHandMesh(shape, raised, palm)
  const h2 = arm3DHandMesh(shape, hanging, palm)
  assert.equal(h1.pos.length, h2.pos.length)
  assert.equal(h1.along!.length, h1.pos.length / 3)
  assert.ok(h1.part!.includes(5))
  assert.ok(arm3DWristMesh(shape, raised).uv.every((v, i) => i % 2 === 0 || v <= -2))
})

test('a forearm bare from the elbow ends there round, back past the elbow, its end turned away along the arm', () => {
  const bareFromElbow = arm3DShape({ ...model, cuff: 0.1 }, 100, 50)
  const raised = new Arm3DMotion(bareFromElbow, false).restPose(bareFromElbow.rest.s)
  const fore = [raised.w[0] - raised.e[0], raised.w[1] - raised.e[1], raised.w[2] - raised.e[2]]
  const along = (q: number[]) => (q[0] - raised.e[0]) * fore[0] + (q[1] - raised.e[1]) * fore[1] + (q[2] - raised.e[2]) * fore[2]
  const m = arm3DWristMesh(bareFromElbow, raised)
  const first = [m.pos[0], m.pos[1], m.pos[2]]
  assert.ok(along(first) < 0)
  assert.ok(along([m.nrm[0], m.nrm[1], m.nrm[2]].map((n, i) => n + raised.e[i])) < 0)
  // Sleeved to the cuff, it starts inside the sleeve with no end of its own.
  const sleeved = arm3DWristMesh(shape, new Arm3DMotion(shape, false).restPose(shape.rest.s))
  assert.ok(sleeved.pos.length < m.pos.length)
})

test('the arm leans with the body as the figure\'s shader leans every layer: about its pivot, bending into it', () => {
  const lean = 0.05
  const body = { bodyPivotX: 300, bodyPivotY: 800, bodyRotationCosine: Math.cos(lean), bodyRotationSine: Math.sin(lean), bodyBendHeight: 0 }
  assert.deepEqual(arm3DOnBody([300, 800, 7], body), [300, 800, 7])
  const up = arm3DOnBody([300, 400, 7], body)
  assert.ok(Math.abs(up[0] - (300 + 400 * Math.sin(lean))) < 1e-9 && up[2] === 7)
  // Bending into it over 800 above the pivot, halfway up takes half the lean.
  const bent = arm3DOnBody([300, 400, 0], { ...body, bodyBendHeight: 800 })
  assert.ok(Math.abs(bent[0] - (300 + 400 * Math.sin(lean / 2))) < 1e-9)
})

test('held, the drawing laid over the arm is its upper arm and elbow: not the forearm, nor what lies in front', () => {
  // On a 400 × 400 layer, a model unit to a pixel: the upper arm straight down, the forearm out to the side; hair
  // drawn in front across the top.
  const small = { ...model, radius: Array.from({ length: 24 }, () => 20), raised: { shoulder: [100, 50, 0], elbow: [100, 250, 0], wrist: [300, 250, 0] } } as Anime25DArmModel
  const W = 400
  const H = 400
  const gesture = new Uint8ClampedArray(W * H * 4).fill(255)
  const portrait = new Uint8ClampedArray(W * H * 4)
  const front = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < 20; y += 1) {
    for (let x = 0; x < W; x += 1) front[(y * W + x) * 4 + 3] = 255
  }
  // The body keeps the portrait's arm everywhere under the drawn one.
  const { over, beside } = arm3DUpperArmAlone(gesture, portrait, front, W, H, small, 1, new Float32Array(W * H).fill(1))
  const a = (x: number, y: number) => over[(y * W + x) * 4 + 3]
  assert.equal(a(100, 150), 255)
  assert.equal(a(110, 250), 255)
  assert.equal(a(250, 250), 0)
  assert.equal(a(300, 100), 0)
  assert.equal(a(100, 10), 0)
  // Beside the sleeve too, past the upper arm's width, but not along the forearm, however far out.
  const b = (x: number, y: number) => beside[(y * W + x) * 4 + 3]
  assert.equal(b(60, 290), 255)
  assert.equal(b(250, 250), 0)
  assert.equal(b(250, 350), 0)
  // A wave's forearm swings, so none of it is laid on; held still, it is, on into the heel of the hand (the
  // modelled hand is kept clear of it as it is drawn).
  assert.equal(arm3DUpperArmAlone(gesture, portrait, front, W, H, small, 1, new Float32Array(W * H)).fore, null)
  const fore = arm3DUpperArmAlone(gesture, portrait, front, W, H, small, 1, new Float32Array(W * H), true).fore!
  const f = (x: number, y: number) => fore[(y * W + x) * 4 + 3]
  assert.equal(f(200, 250), 255)
  assert.equal(f(300, 250), 255)
  assert.equal(f(100, 150), 0)
  assert.equal(b(100, 10), 0)
})

test('held still, the forearm laid on beside and over what lies in front comes to the drawing\'s own cover', () => {
  // As above, the forearm out to the side; in front of it, a soft-edged layer (half there, a quarter there) and a
  // gesture drawn half there over one of them.
  const small = { ...model, radius: Array.from({ length: 24 }, () => 20), raised: { shoulder: [100, 50, 0], elbow: [100, 250, 0], wrist: [300, 250, 0] } } as Anime25DArmModel
  const W = 400
  const H = 400
  const gesture = new Uint8ClampedArray(W * H * 4).fill(255)
  const front = new Uint8ClampedArray(W * H * 4)
  for (let y = 240; y < 260; y += 1) {
    for (let x = 0; x < W; x += 1) front[(y * W + x) * 4 + 3] = x < 220 ? 128 : x < 260 ? 64 : 0
  }
  for (let x = 240; x < 260; x += 1) gesture[(250 * W + x) * 4 + 3] = 128
  const { fore, foreFront } = arm3DUpperArmAlone(gesture, new Uint8ClampedArray(W * H * 4), front, W, H, small, 1, new Float32Array(W * H), true)
  // Laid one over the other (as drawn, all but held): together, the gesture's own alpha there, wherever the front is.
  const together = (x: number, y: number) => {
    const a = fore![(y * W + x) * 4 + 3] / 255
    return a + foreFront![(y * W + x) * 4 + 3] / 255 * (1 - a)
  }
  for (const [x, k] of [[200, 1], [230, 1], [250, 128 / 255], [280, 1]] as const) assert.ok(Math.abs(together(x, 250) - k) < 0.01, `${x}: ${together(x, 250)}`)
  // Clear of the front, `fore` alone.
  assert.equal(foreFront![(250 * W + 280) * 4 + 3], 0)
})

test('the picture\'s sides count as cut where the figure runs straight down them, not where it ends at a point', () => {
  // A bust cut off at the left (x 0, y 300–1000); on the right its shoulder rounds off to a single point at x 900.
  const body = { rest: [0, 300, 0, 1000, 500, 300, 500, 1000] }
  const shoulder = { rest: [500, 300, 900, 500, 500, 700] }
  const [left, right] = arm3DCutSides([body, shoulder], 1000)
  assert.deepEqual(left, [[0, 0], [0, 1]])
  assert.deepEqual(right, [])
})

test('ring fill gives each unwritten texel the nearest written one round its row, and empty rows the nearest row', () => {
  const w = 6
  const h = 3
  const px = new Uint8Array(w * h * 4)
  const put = (x: number, y: number, v: number) => px.set([v, v, v, 255], (y * w + x) * 4)
  put(0, 0, 10)
  put(3, 0, 200)
  put(5, 2, 50)
  ringFill(px, w, h)
  const at = (x: number, y: number) => px[(y * w + x) * 4]
  // Row 0: 5 is beside 0 across the seam.
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((x) => at(x, 0)), [10, 10, 200, 200, 200, 10])
  // Row 1 has nothing: it takes the nearest row (0 before 2).
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((x) => at(x, 1)), [10, 10, 200, 200, 200, 10])
  assert.ok([0, 1, 2, 3, 4, 5].every((x) => at(x, 2) === 50 && px[(2 * w + x) * 4 + 3] === 255))
})

test('ring fill with an inset takes its colour from inside the written run, past the outline at its edge', () => {
  const w = 12
  const px = new Uint8Array(w * 4)
  const put = (x: number, v: number) => px.set([v, v, v, 255], x * 4)
  // A run 2..7, outlined (20) at both ends with cloth (200) between, and a lone texel (10) with nothing further in.
  for (const [i, v] of [20, 200, 200, 200, 200, 20].entries()) put(2 + i, v)
  put(10, 10)
  ringFill(px, w, 1, 2)
  const at = (x: number) => px[x * 4]
  assert.deepEqual([1, 8, 9, 11].map(at), [200, 200, 10, 10])
  // Written texels stay as they were.
  assert.deepEqual([2, 3, 7, 10].map(at), [20, 200, 20, 10])
  // A run of three steps in by one at an inset of one.
  const three = new Uint8Array(5 * 4)
  for (const [i, v] of [20, 200, 200].entries()) three.set([v, v, v, 255], i * 4)
  ringFill(three, 5, 1, 1)
  assert.deepEqual([3, 4].map((x) => three[x * 4]), [200, 200])
})

test('the hand as it is now is carried back onto the drawn one by one turn, scale and shift', () => {
  const drawn: V3[] = [[100, 200, 0], [130, 190, 3], [120, 160, -2], [90, 170, 1]]
  // Turned 30°, half again as large, moved: as a swaying body carries the held hand.
  const c = Math.cos(Math.PI / 6)
  const s = Math.sin(Math.PI / 6)
  const now = drawn.map(([x, y, z]): V3 => [1.5 * (c * x - s * y) + 40, 1.5 * (s * x + c * y) - 25, z])
  const fit = similarity2D(now, drawn)
  assert.ok(fit)
  const [r0, r1] = fit
  now.forEach(([x, y], i) => {
    assert.ok(Math.abs(r0[0] * x + r0[1] * y + r0[2] - drawn[i][0]) < 1e-9)
    assert.ok(Math.abs(r1[0] * x + r1[1] * y + r1[2] - drawn[i][1]) < 1e-9)
  })
  assert.equal(similarity2D([[1, 1, 0], [1, 1, 0]], drawn), null)
})

test('an affine fit carries a mesh as the figure draws it back to where it was drawn', () => {
  // Drawn at these points; this frame scaled, sheared a little and moved, as a breathing, leaning body does.
  const drawn = [100, 200, 300, 220, 140, 500, 320, 480, 210, 350]
  const now = drawn.map((v, i) => (i % 2 === 0 ? 1.02 * v + 0.03 * drawn[i + 1] + 7 : 0.98 * v - 0.01 * drawn[i - 1] - 4))
  const fit = affineFit(now, drawn)
  assert.ok(fit)
  for (let i = 0; i < drawn.length; i += 2) {
    assert.ok(Math.abs(fit[0] * now[i] + fit[1] * now[i + 1] + fit[2] - drawn[i]) < 1e-6)
    assert.ok(Math.abs(fit[3] * now[i] + fit[4] * now[i + 1] + fit[5] - drawn[i + 1]) < 1e-6)
  }
  // All on one line: no fit.
  assert.equal(affineFit([0, 0, 1, 1, 2, 2], [0, 0, 1, 1, 2, 2]), null)
})

test('the sleeve\'s line is let go over a moment as the hand lifts, however fast, and back only at hanging', () => {
  // Hanging: held off.
  assert.equal(sleeveLineHeldOff(1, 1, 1 / 60), 1)
  // The hand gone at once: still mostly held off a frame later, gone within a fifth of a second.
  let held = 1
  held = sleeveLineHeldOff(held, 0, 1 / 60)
  assert.ok(held > 0.9)
  for (let i = 0; i < 12; i += 1) held = sleeveLineHeldOff(held, 0, 1 / 60)
  assert.equal(held, 0)
  // Coming back down: none until the hand is all but at hanging.
  assert.equal(sleeveLineHeldOff(0, 0.6, 1 / 60), 0)
  assert.ok(sleeveLineHeldOff(0, 0.95, 1 / 60) > 0.5)
})
