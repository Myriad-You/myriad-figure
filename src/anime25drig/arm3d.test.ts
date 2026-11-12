import type { V3 } from './arm3dMath'
import type { Arm3DStance } from './arm3dReach'
import type { Anime25DArmModel } from './types'
import assert from 'node:assert/strict'
import test from 'node:test'
import { affineFit, arm3DOnBody, sleeveLineHeldOff } from './arm3dArm'
import { similarity2D } from './arm3dMath'
import { ARM3D_AROUND, ARM3D_CAP_V, ARM3D_RINGS, arm3DCapReach, arm3DHandMesh, arm3DKeepWhole, arm3DPalmAsModelled, arm3DShoulderIsBare, arm3DSleeveMesh, arm3DWristMesh } from './arm3dMesh'
import { Arm3DMotion, arm3DShape } from './arm3dMotion'
import { arm3DCutSides, arm3DUpperArmAlone, bareBelowSleeve, clothCuffMouth, ringFill } from './arm3dPrepare'
import { arm3DAimBones, arm3DAimHand, arm3DAimOf, Arm3DTransit } from './arm3dReach'

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

test('the elbow keeps its rings in step where the forearm folds toward the viewer', () => {
  const shape = arm3DShape(model, 100, 50)
  const motion = new Arm3DMotion(shape, false)
  const raised = motion.restPose(shape.rest.s)
  const s = raised.s
  const e: [number, number, number] = [s[0], s[1] + 230, s[2]]
  const elbowFrom = arm3DSleeveMesh(shape, motion.keyPose(0, shape.rest.s), 1, 2).pos.length / 3 - 13 * 37
  // Upper arm straight down, the forearm folded up toward the viewer: straight at them, and a little to one side.
  for (const tilt of [-8, 8]) {
    const t = (tilt * Math.PI) / 180
    const fold = (150 * Math.PI) / 180
    const w: [number, number, number] = [e[0] + 280 * Math.sin(fold) * Math.sin(t), e[1] + 280 * Math.cos(fold), e[2] + 280 * Math.sin(fold) * Math.cos(t)]
    const m = arm3DSleeveMesh(shape, { ...raised, e, w }, 0, 2)
    // Across both arms: the upper arm runs down y, so the hinge lies in x and z.
    const hx = w[2] - e[2]
    const hz = -(w[0] - e[0])
    const hinge = [hx / Math.hypot(hx, hz), 0, hz / Math.hypot(hx, hz)]
    for (let i = 0; i < 12; i += 1) {
      for (let j = 0; j <= 36; j += 1) {
        const a = (elbowFrom + i * 37 + j) * 3
        const b = a + 37 * 3
        const along = m.nrm[a] * m.nrm[b] + m.nrm[a + 1] * m.nrm[b + 1] + m.nrm[a + 2] * m.nrm[b + 2]
        // Not the half drawn in to the hinge's ends (each of its points goes to the end on its own side).
        const atEnd = (k: number) => Math.abs(m.nrm[k] * hinge[0] + m.nrm[k + 1] * hinge[1] + m.nrm[k + 2] * hinge[2]) > 0.999
        if (atEnd(a) || atEnd(b)) continue
        assert.ok(along > 0, `ring ${i} to ${i + 1} at ${j}, tilt ${tilt}: ${along}`)
      }
    }
  }
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

const stanceOf = (du: V3, df: V3, hanging = 0): Arm3DStance => ({ du, df, upper: 300, fore: 280, hand: hand.map(([x, y]) => [x - hand[0]![0], y - hand[0]![1], 0] as V3), handRest: hanging, hanging })
function unit(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2])
  return [v[0] / l, v[1] / l, v[2] / l]
}
const angle = (a: V3, b: V3) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])))

test('an aim gives the two bones that reach it, and the bones give the aim back', () => {
  for (const side of [-1, 1]) {
    for (const aim of [{ out: 0.5, up: 0.4, forward: 0.2, swivel: 0 }, { out: 0.1, up: -0.6, forward: 0.5, swivel: 0.7 }, { out: -0.2, up: 0.3, forward: 0.6, swivel: -0.4 }]) {
      const { du, df } = arm3DAimBones(aim, side, 230, 280)
      const wrist: V3 = [du[0] * 230 + df[0] * 280, du[1] * 230 + df[1] * 280, du[2] * 230 + df[2] * 280]
      assert.ok(Math.hypot(wrist[0] - aim.out * side * 510, wrist[1] + aim.up * 510, wrist[2] - aim.forward * 510) < 1e-6)
      const back = arm3DAimOf(du, df, side, 230, 280)
      for (const k of ['out', 'up', 'forward', 'swivel'] as const) assert.ok(Math.abs(back[k] - aim[k]) < 1e-6, `${k}: ${back[k]} against ${aim[k]}`)
    }
  }
  // Past the arm's reach it goes straight toward the aim, as far as it reaches.
  const far = arm3DAimBones({ out: 2, up: 0, forward: 0 }, 1, 230, 280)
  assert.ok(angle(far.du, [1, 0, 0]) < 0.1 && angle(far.df, [1, 0, 0]) < 0.1)
  // At ease the elbow falls down and a little back, not toward the viewer.
  const eased = arm3DAimBones({ out: 0.5, up: 0, forward: 0.3 }, 1, 230, 280)
  assert.ok(eased.du[1] > 0 && eased.du[2] < eased.df[2])
})

test('a hand reached toward the viewer grows, and turns in the picture as its forearm is seen to turn', () => {
  const drawn = hand.map(([x, y]) => [x - hand[0]![0], y - hand[0]![1], 0] as V3)
  const size = (h: V3[]) => Math.hypot(h[1]![0], h[1]![1])
  const same = arm3DAimHand(drawn, [0, -1, 0], [0, -1, 0], 0, 0)
  assert.ok(Math.abs(size(same.hand) - size(drawn)) < 1e-9 && same.turned === 0)
  const nearer = arm3DAimHand(drawn, [0, -1, 0], [0, -1, 0], 0.6, 0)
  assert.ok(size(nearer.hand) > size(drawn) * 1.15)
  const side = arm3DAimHand(drawn, [0, -1, 0], [1, 0, 0], 0, 0)
  assert.ok(Math.abs(Math.abs(side.turned) - Math.PI / 2) < 1e-9)
  // Pointed at the viewer the forearm shows no turn to follow: the hand stays as drawn.
  const at = arm3DAimHand(drawn, [0, -1, 0], unit([0.05, 0, 1]), 0, 0)
  assert.ok(Math.hypot(at.hand[1]![0] - drawn[1]![0], at.hand[1]![1] - drawn[1]![1]) < 1e-9)
})

test('wanted elsewhere, the arm goes from where it is without a jump, and arrived is exactly what is wanted', () => {
  const transit = new Arm3DTransit()
  const a = stanceOf(unit([-0.9, -0.3, 0.2]), unit([0, -1, 0.2]))
  const b = stanceOf(unit([-0.4, 0.6, 0.5]), unit([0.7, -0.5, 0.5]))
  assert.equal(transit.pose(a, 1 / 60), a)
  assert.ok(transit.idle)
  transit.retarget(b)
  let last = a
  let most = 0
  let arrived = -1
  for (let i = 0; i < 240; i += 1) {
    const now = transit.pose(b, 1 / 60)
    most = Math.max(most, angle(last.du, now.du), angle(last.df, now.df), Math.hypot(now.hand[1]![0] - last.hand[1]![0], now.hand[1]![1] - last.hand[1]![1]) / 100)
    last = now
    if (now === b && arrived < 0) arrived = i
  }
  // No frame turns a bone more than a fast arm would (a jump would be the whole way at once: over a radian).
  assert.ok(most < 0.2, `${most}`)
  assert.ok(arrived > 12 && arrived < 150, `${arrived}`)
  assert.ok(transit.idle)
})

test('caught on the way to one gesture and wanted at another, it turns there from mid-air, never back through hanging', () => {
  const transit = new Arm3DTransit()
  const down = stanceOf(unit([-0.1, 1, 0]), unit([-0.05, 1, 0]), 1)
  const a = stanceOf(unit([-0.9, -0.3, 0.2]), unit([-0.2, -1, 0.2]))
  const b = stanceOf(unit([-0.8, 0.2, 0.3]), unit([0.6, -0.7, 0.4]))
  transit.pose(down, 1 / 60)
  transit.retarget(a)
  for (let i = 0; i < 12; i += 1) transit.pose(a, 1 / 60)
  const caught = transit.pose(a, 1 / 60)
  transit.retarget(b)
  const first = transit.pose(b, 1 / 60)
  assert.ok(angle(caught.du, first.du) < 0.25 && angle(caught.df, first.df) < 0.35)
  let lowest = 0
  for (let i = 0; i < 200; i += 1) lowest = Math.max(lowest, transit.pose(b, 1 / 60).df[1])
  assert.ok(lowest < Math.max(caught.df[1], b.df[1]) + 0.15, `${lowest}`)
  assert.equal(transit.pose(b, 1 / 60), b)
})

test('from raised straight up to hanging the arm comes down in front of the body, not through it', () => {
  const transit = new Arm3DTransit()
  const up = stanceOf([0, -1, 0], [0, -1, 0])
  const down = stanceOf([0, 1, 0], [0, 1, 0], 1)
  transit.pose(up, 1 / 60)
  transit.retarget(down)
  let back = 0
  let front = 0
  for (let i = 0; i < 200; i += 1) {
    const now = transit.pose(down, 1 / 60)
    // Until it is nearly down; there it may swing a little past hanging before it settles.
    if (now.du[1] < 0.9) back = Math.min(back, now.du[2])
    if (now.df[1] < 0.9) back = Math.min(back, now.df[2])
    front = Math.max(front, now.df[2])
  }
  assert.ok(back >= 0 && front > 0.3, `${back} ${front}`)
})

test('a change between gestures of unlike upper arms takes the length across too, no step in it', () => {
  const transit = new Arm3DTransit()
  const a = { ...stanceOf(unit([0.2, 1, 0]), unit([0.9, -0.3, 0.2])), upper: 300 }
  const b = { ...stanceOf(unit([0.6, 0.7, 0.1]), unit([0.1, -1, 0.3])), upper: 340 }
  transit.pose(a, 1 / 60)
  transit.retarget(b)
  let last = 300
  for (let i = 0; i < 240; i += 1) {
    const now = transit.pose(b, 1 / 60).upper
    assert.ok(Math.abs(now - last) < 6, `frame ${i}: ${last} to ${now}`)
    last = now
  }
  assert.equal(last, 340)
})

test('a rise slows into the gesture: the hand is nearly still as it arrives, not stopped from speed', () => {
  const motion = new Arm3DMotion(shape, false)
  const anchor = shape.rest.s
  let t = run(motion, 0, 0.1)
  motion.wanted = true
  let before = motion.pose(anchor).w
  let fastest = 0
  let last = -1
  for (let i = 0; i < 600 && motion.progress < 1; i += 1) {
    motion.step((t += 1 / 60))
    const w = motion.pose(anchor).w
    const moved = Math.hypot(w[0] - before[0], w[1] - before[1])
    fastest = Math.max(fastest, moved)
    if (last < 0 && motion.progress > 0.98) last = moved
    before = w
  }
  assert.ok(fastest > 5, `${fastest}`)
  assert.ok(last >= 0 && last < 0.12 * fastest, `${last} of ${fastest}`)
})

test('a cuff measured where it hangs is closed in to the wrist by rows of its own; another keeps its end as it was', () => {
  const motion = new Arm3DMotion(shape, false)
  const raised = motion.restPose(shape.rest.s)
  const vs = (d: typeof shape) => arm3DSleeveMesh(d, raised, 0, 2).uv.filter((_, i) => i % 2 === 1)
  const plain = vs(shape)
  assert.ok(Math.max(...plain) <= 1.05 + 1e-6)
  const lined = vs({ ...shape, restCuff: 1.1, cuffFrom: 0.8, restFore: 280 })
  assert.ok(Math.abs(Math.max(...lined) - 1.1) < 1e-6)
  assert.ok(lined.some((v) => Math.abs(v - 1.06) < 1e-6))
})

test('an arm of one look has the next gesture\'s hand soon after it leaves, long before its bones are there', () => {
  const far = (s: Arm3DStance) => Math.hypot(...s.hand[1]!)
  const at = (inTime: boolean) => {
    const transit = new Arm3DTransit()
    transit.handInTime = inTime
    const a = stanceOf(unit([-0.1, 1, 0]), unit([-0.05, 1, 0]))
    const b = { ...stanceOf(unit([-0.4, 0.6, 0.5]), unit([0.7, -0.5, 0.5])), hand: a.hand.map((q) => [q[0] * 2, q[1] * 2, 0] as V3) }
    transit.pose(a, 1 / 60)
    transit.retarget(b)
    let now = a
    for (let i = 0; i < 20; i += 1) now = transit.pose(b, 1 / 60)
    assert.ok(!transit.idle)
    return far(now) / far(a)
  }
  assert.ok(Math.abs(at(true) - 2) < 0.02, `${at(true)}`)
  assert.ok(at(false) < 1.95, `${at(false)}`)
})

test('a cuff\'s last rows lose the drawn mouth and keep its trim', () => {
  const w = 2
  const h = 50
  const px = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y += 1) { for (let x = 0; x < w; x += 1) px.set([248, 231, 224, 255], (y * w + x) * 4)
}
  // The mouth's shadow and a gold trim in the last rows of column 0; column 1 all cloth.
  px.set([214, 198, 199, 255], (46 * w) * 4)
  px.set([200, 160, 90, 255], (48 * w) * 4)
  clothCuffMouth(px, w, h)
  assert.deepEqual([...px.slice(46 * w * 4, 46 * w * 4 + 3)], [248, 231, 224])
  assert.deepEqual([...px.slice(48 * w * 4, 48 * w * 4 + 3)], [200, 160, 90])
  assert.deepEqual([...px.slice((46 * w + 1) * 4, (46 * w + 1) * 4 + 3)], [248, 231, 224])
})

test('under a short sleeve the raised arm\'s elbow wears the rows past the sleeve\'s end; hanging, and any other arm, the rows it had', () => {
  const motion = new Arm3DMotion(shape, false)
  const raised = motion.restPose(shape.rest.s)
  const vs = (d: typeof shape, rest: number) => arm3DSleeveMesh(d, raised, rest, 2).uv.filter((_, i) => i % 2 === 1)
  const short = { ...shape, shortSleeve: 0.58 }
  // Raised: nothing of the arm from the elbow's rows back to the sleeve's end but the upper arm's own tube.
  const plain = vs(shape, 0)
  const bare = vs(short, 0)
  assert.equal(bare.length, plain.length)
  const upper = (ARM3D_RINGS / 2 + 1) * (ARM3D_AROUND + 1)
  assert.deepEqual(bare.slice(0, upper), plain.slice(0, upper))
  assert.ok(plain.slice(upper).some((v) => v < 0.62))
  assert.ok(bare.slice(upper).every((v) => v >= 0.63 - 1e-9), `${Math.min(...bare.slice(upper))}`)
  // Hanging it is the arm it was.
  assert.deepEqual(vs(short, 1), vs(shape, 1))
})

test('a short sleeve drawn wider than the arm is that much wider round the raised upper arm, closed on the arm at the elbow; hanging it is the arm', () => {
  const motion = new Arm3DMotion(shape, false)
  const pose = motion.restPose(shape.rest.s)
  const wide = { ...shape, shortSleeve: 0.58, drawnRadius: shape.radius.map((r) => r * 2) }
  const narrow = { ...shape, shortSleeve: 0.58 }
  const upper = (ARM3D_RINGS / 2 + 1) * (ARM3D_AROUND + 1) * 3
  const ring = (ARM3D_AROUND + 1) * 3
  const a = arm3DSleeveMesh(wide, pose, 0, 2).pos
  const b = arm3DSleeveMesh(narrow, pose, 0, 2).pos
  assert.equal(a.length, b.length)
  assert.notDeepEqual([...a.slice(0, upper - ring)], [...b.slice(0, upper - ring)])
  assert.deepEqual([...a.slice(upper - ring)], [...b.slice(upper - ring)])
  assert.deepEqual([...arm3DSleeveMesh(wide, pose, 1, 2).pos], [...arm3DSleeveMesh(narrow, pose, 1, 2).pos])
  // No short sleeve, what was drawn wider changes nothing of the arm.
  assert.deepEqual([...arm3DSleeveMesh({ ...shape, drawnRadius: wide.drawnRadius }, pose, 0, 2).pos], [...arm3DSleeveMesh(shape, pose, 0, 2).pos])
})

test('what hangs off a short sleeve over the skin is taken out of the baked rows past its end, the arm\'s outline left', () => {
  const w = 3
  const h = 100
  const skin = [250, 225, 215]
  const px = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y += 1) {
    px.set(y < 58 ? [40, 44, 60, 255] : [...skin, 255], (y * w) * 4)
    px.set(y < 70 ? [40, 44, 60, 255] : [...skin, 255], (y * w + 1) * 4)
    px.set([30, 20, 20, 255], (y * w + 2) * 4)
  }
  bareBelowSleeve(px, w, h, 0.585, 0.63, skin, [230, 190, 185])
  const at = (x: number, y: number) => [...px.slice((y * w + x) * 4, (y * w + x) * 4 + 3)]
  // The strap in column 1 from the sleeve's end on is skin; the sleeve itself above its end stays.
  assert.deepEqual(at(1, 60), skin)
  assert.deepEqual(at(1, 69), skin)
  assert.deepEqual(at(1, 57), [40, 44, 60])
  assert.deepEqual(at(0, 57), [40, 44, 60])
  // A column with no skin (the outline) is left as it is.
  assert.deepEqual(at(2, 65), [30, 20, 20])
})

test('what a standing figure wears on a short sleeve\'s shoulder is carried flat with the upper arm', () => {
  const motion = new Arm3DMotion(shape, false)
  const hung = motion.keyPose(0, shape.rest.s)
  const worn = { ...shape, restFore: 280, shortSleeve: 0.4, worn: true }
  const piece = (pose: typeof hung) => {
    const m = arm3DSleeveMesh(worn, pose, 1, 2)
    assert.equal(m.tubes, 6)
    return { m, at: [0, 1, 2, 3].map((i) => [m.pos[i * 3]!, m.pos[i * 3 + 1]!] as const) }
  }
  const rest = piece(hung)
  for (let i = 0; i < 4; i += 1) assert.deepEqual([rest.m.uv[i * 2], rest.m.uv[i * 2 + 1]], [1, ARM3D_CAP_V])
  // The tubes after it are a plain sleeve's, and without the mark neither it nor a long sleeve has one.
  assert.equal(rest.m.pos.length - 12, arm3DSleeveMesh({ ...worn, worn: false, restFore: undefined }, hung, 1, 2).pos.length)
  assert.equal(arm3DSleeveMesh({ ...worn, shortSleeve: undefined }, hung, 1, 2).tubes, 0)
  // Hanging it lies along the drawn upper arm, from above the joint to just short of the sleeve's end.
  const axis = [hung.e[0] - hung.s[0], hung.e[1] - hung.s[1]]
  const l = Math.hypot(shape.rest.e[0] - shape.rest.s[0], shape.rest.e[1] - shape.rest.s[1])
  const along = (q: readonly [number, number], s: readonly number[], a: number[]) => ((q[0] - s[0]) * a[0] + (q[1] - s[1]) * a[1]) / Math.hypot(a[0], a[1])
  assert.ok(along(rest.at[0], hung.s, axis) < 0)
  assert.ok(Math.abs(along(rest.at[2], hung.s, axis) - (2 * 0.4 - 0.03) * l) < 1e-6 * l + 0.5)
  // The upper arm turned in the picture's plane, the piece turns with it about the joint, its shape kept.
  const turned = { ...hung, e: [hung.s[0] + axis[1], hung.s[1] - axis[0], hung.e[2]] as [number, number, number] }
  const now = piece(turned)
  const side = (q: readonly [number, number], r: readonly [number, number]) => Math.hypot(q[0] - r[0], q[1] - r[1])
  for (const [i, j] of [[0, 1], [0, 2], [1, 3], [0, 3]]) assert.ok(Math.abs(side(now.at[i], now.at[j]) - side(rest.at[i], rest.at[j])) < 1e-6)
  assert.ok(Math.abs(along(now.at[2], turned.s, [axis[1], -axis[0]]) - along(rest.at[2], hung.s, axis)) < 1e-6)
})

test('a worn piece\'s picture keeps its large pieces and drops the specks about them', () => {
  const w = 40
  const px = new Uint8ClampedArray(w * w * 4)
  const draw = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) px.set([9, 9, 9, 255], (y * w + x) * 4)
  }
  draw(0, 0, 30, 30)
  draw(32, 0, 40, 20)
  draw(35, 35, 37, 37)
  arm3DKeepWhole(px, w, w, 0.02)
  const at = (x: number, y: number) => px[(y * w + x) * 4 + 3]
  assert.equal(at(5, 5), 255)
  assert.equal(at(35, 10), 255)
  // (Dropped, its colour left as it was.)
  assert.equal(at(35, 35), 0)
  assert.equal(px[(35 * w + 35) * 4], 9)
})

test('a worn piece stays in front of the upper sleeve under it, and steps back at its hem as the arm is raised', () => {
  const hung = new Arm3DMotion(shape, false).keyPose(0, shape.rest.s)
  const span = Math.hypot(hung.e[0] - hung.s[0], hung.e[1] - hung.s[1])
  const axis = [(hung.e[0] - hung.s[0]) / span, (hung.e[1] - hung.s[1]) / span]
  const down = (x: number, y: number) => (x - hung.s[0]) * axis[0] + (y - hung.s[1]) * axis[1]
  const ring = ARM3D_AROUND + 1
  for (const shortSleeve of [0.3, 0.4, 0.48]) {
    const worn = { ...shape, restFore: 280, shortSleeve, worn: true }
    let hemWas = Infinity
    for (const rest of [1, 0.9, 0.6, 0.3, 0]) {
      const m = arm3DSleeveMesh(worn, hung, rest, 2)
      const z = (i: number) => m.pos[i * 3 + 2]! - hung.s[2]
      // Vertices 0, 1 above the joint, 2, 3 at the hem; between them it is flat across, straight along.
      const [a0, a2] = [down(m.pos[0]!, m.pos[1]!), down(m.pos[6]!, m.pos[7]!)]
      const quad = (a: number) => z(0) + (z(2) - z(0)) * (a - a0) / (a2 - a0)
      assert.ok(Math.abs(z(0) - z(1)) < 1e-9 && Math.abs(z(2) - z(3)) < 1e-9)
      if (rest === 1) assert.ok(Math.abs(z(2) - z(0)) < 1e-9)
      assert.ok(z(2) < hemWas + 1e-9)
      hemWas = z(2)
      // Every ring of the upper sleeve the piece reaches over is behind it.
      for (let r = 0; r <= ARM3D_RINGS / 2; r += 1) {
        const at = Array.from({ length: ring }, (_, k) => 4 + r * ring + k)
        const a = at.reduce((sum, i) => sum + down(m.pos[i * 3]!, m.pos[i * 3 + 1]!), 0) / ring
        if (a > a2) continue
        for (const i of at) assert.ok(z(i) < quad(a), `rest ${rest}, sleeve ${shortSleeve}, ring ${r}`)
      }
    }
    assert.ok(hemWas < 0.5 * arm3DSleeveMesh(worn, hung, 1, 2).pos[2]!)
    // Past its hem the bare arm is its own width again, as without one.
    const raised = arm3DSleeveMesh(worn, hung, 0, 2)
    const plain = arm3DSleeveMesh({ ...worn, worn: false, restFore: undefined }, hung, 0, 2)
    const width = (mesh: typeof raised, base: number, r: number) => Math.max(...Array.from({ length: ring }, (_, k) => mesh.pos[(base + r * ring + k) * 3 + 2]!)) - hung.s[2]
    for (let r = Math.ceil((shortSleeve - 0.015 + 0.03) / 0.5 * (ARM3D_RINGS / 2)); r <= ARM3D_RINGS / 2; r += 1) {
      assert.ok(Math.abs(width(raised, 4, r) - width(plain, 0, r)) < 1e-6, `sleeve ${shortSleeve}, ring ${r}`)
    }
  }
})

test('a standing figure\'s sleeve begins with a cap about its shoulder, and only a bare shoulder is capped', () => {
  const pose = new Arm3DMotion(shape, false).keyPose(0, shape.rest.s)
  const [sx, sy] = pose.s
  const plain = arm3DSleeveMesh(shape, pose, 1, 2)
  const standing = { ...shape, restFore: 280 }
  const capped = arm3DSleeveMesh(standing, pose, 1, 2)
  // A bust's sleeve is what it was: no cap, its tubes from the first triangle.
  assert.equal(plain.tubes ?? 0, 0)
  assert.ok(plain.uv.every((v, i) => i % 2 === 0 || v >= 0))
  // The cap comes first, marked by its v, flat about the joint; the tubes after it are joined as a bust's are.
  const tubes = capped.tubes ?? 0
  assert.ok(tubes > 0)
  const capPoints = Math.max(...capped.idx.slice(0, tubes)) + 1
  const reach = arm3DCapReach(standing)
  for (let i = 0; i < capPoints; i += 1) {
    assert.equal(capped.uv[i * 2 + 1], ARM3D_CAP_V)
    assert.ok(Math.hypot(capped.pos[i * 3]! - sx, capped.pos[i * 3 + 1]! - sy) <= reach + 1e-6)
    // Straight below the joint it is a ball as wide as the arm: whole inside, nothing past it.
    const below = capped.pos[i * 3 + 1]! - sy
    if (Math.abs(capped.pos[i * 3]! - sx) < 1e-6 && below > 0) {
      if (below >= reach / 1.6 - 1e-6) assert.equal(capped.uv[i * 2], 0)
      if (below <= 0.8 * reach / 1.6 + 1e-6) assert.equal(capped.uv[i * 2], 1)
    }
  }
  assert.ok(capped.uv.slice(capPoints * 2).every((v, i) => i % 2 === 0 || v >= 0))
  assert.equal(capped.pos.length - capPoints * 3, plain.pos.length)
  assert.deepEqual(capped.idx.slice(tubes).map((i) => i - capPoints), [...plain.idx])

  // A round shoulder ends inside the cap; a pauldron drawn into the arm's layer runs on past its rim.
  const picture = (radius: number) => {
    const px = new Uint8ClampedArray(100 * 100 * 4)
    for (let y = 0; y < 100; y += 1) { for (let x = 0; x < 100; x += 1) { if (Math.hypot(x - 50, y - 50) < radius) px[(y * 100 + x) * 4 + 3] = 255
}
}
    return px
  }
  assert.equal(arm3DShoulderIsBare(picture(20), 100, 100, 50, 50, 30), true)
  assert.equal(arm3DShoulderIsBare(picture(45), 100, 100, 50, 50, 30), false)
})
