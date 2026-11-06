import type { P2 } from './armRaster'
import assert from 'node:assert/strict'
import test from 'node:test'
import { measureArmModel, placeArmModel } from './armModel'
import { area, rings } from './armRaster'

// The working grid, as the cut resamples the portrait to it.
const W = 1152
const H = 1536
const GROUND = [255, 255, 255] as const
const BODY = [200, 200, 212] as const
const SLEEVE = [70, 90, 160] as const
const SKIN = [240, 205, 190] as const

type Rgb = readonly [number, number, number]
type Paint = (x: number, y: number) => Rgb | null

function segmentDistance(c: P2, a: P2, b: P2): number {
  const d = [b[0] - a[0], b[1] - a[1]]
  const t = Math.max(0, Math.min(1, ((c[0] - a[0]) * d[0] + (c[1] - a[1]) * d[1]) / (d[0] ** 2 + d[1] ** 2 || 1)))
  return Math.hypot(c[0] - a[0] - d[0] * t, c[1] - a[1] - d[1] * t)
}
const capsule = (a: P2, b: P2, r: number, color: Rgb): Paint => (x, y) => (segmentDistance([x, y], a, b) <= r ? color : null)
/** Square-ended, as a sleeve is cut off at its cuff. */
function band(a: P2, b: P2, r: number, color: Rgb): Paint {
  const d = [b[0] - a[0], b[1] - a[1]]
  const length = Math.hypot(d[0], d[1])
  return (x, y) => {
    const along = ((x - a[0]) * d[0] + (y - a[1]) * d[1]) / length
    const across = Math.abs((x - a[0]) * d[1] - (y - a[1]) * d[0]) / length
    return along >= 0 && along <= length && across <= r ? color : null
  }
}

// The person's right arm, on the picture's left: hanging in the portrait, waving in the variant.
const SHOULDER: P2 = [420, 620]
const HANG_ELBOW: P2 = [400, 900]
const HANG_WRIST: P2 = [390, 1160]
// The elbow out to the side, the forearm upright.
const ELBOW: P2 = [200, 690]
const WRIST: P2 = [200, 420]
// The sleeve ends 60% of the way up the forearm; past it the forearm is bare.
const CUFF = 0.6
const CUFF_AT: P2 = [ELBOW[0] + (WRIST[0] - ELBOW[0]) * CUFF, ELBOW[1] + (WRIST[1] - ELBOW[1]) * CUFF]
const HAND: P2[] = [
  WRIST,
  [172, 412], [152, 396], [136, 378], [124, 360],
  [170, 350], [167, 318], [165, 293], [163, 270],
  [196, 346], [196, 312], [196, 286], [196, 260],
  [222, 348], [224, 316], [225, 292], [226, 270],
  [246, 356], [250, 332], [252, 314], [254, 296],
]
const FINGERS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]

const torso: Paint = (x, y) => (x >= 470 && x < 720 && y >= 560 ? BODY : null)
const hangingArm = capsule(SHOULDER, HANG_ELBOW, 55, SLEEVE)
const hangingFore = capsule(HANG_ELBOW, HANG_WRIST, 48, SLEEVE)
const raised: Paint[] = [
  capsule(SHOULDER, ELBOW, 55, SLEEVE),
  band(ELBOW, CUFF_AT, 48, SLEEVE),
  band(CUFF_AT, WRIST, 30, SKIN),
  capsule([199, 405], [199, 375], 38, SKIN),
  ...FINGERS.map((chain) => capsule(HAND[chain[0]], HAND[chain[3]], 11, SKIN)),
]

/** Even-odd: whether q lies inside the ring. */
function inside(q: P2, ring: P2[]): boolean {
  let odd = false
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length]
    if ((a[1] > q[1]) !== (b[1] > q[1]) && q[0] < a[0] + ((q[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1])) odd = !odd
  })
  return odd
}

function picture(...paints: Paint[]): Uint8Array {
  const data = new Uint8Array(W * H * 3)
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const color = paints.reduce<Rgb | null>((found, paint) => paint(x, y) ?? found, null) ?? GROUND
      data.set(color, (y * W + x) * 3)
    }
  }
  return data
}

function mask(...paints: Paint[]): Uint8Array {
  const out = new Uint8Array(W * H)
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) out[y * W + x] = paints.some((paint) => paint(x, y)) ? 1 : 0
  }
  return out
}

/** COCO-WholeBody: the right arm 6, 8, 10 and its hand 112–132; the left arm on the picture's right. */
function pose(shoulder: P2, elbow: P2, wrist: P2, hand: P2[] | null): Array<[number, number, number]> {
  const k: Array<[number, number, number]> = Array.from({ length: 133 }, () => [0, 0, 0])
  k[5] = [760, 620, 0.9]
  k[6] = [...shoulder, 0.9]
  k[7] = [790, 900, 0.9]
  k[8] = [...elbow, 0.9]
  k[9] = [800, 1160, 0.9]
  k[10] = [...wrist, 0.9]
  hand?.forEach((q, i) => {
    k[112 + i] = [...q, 0.8]
  })
  return k
}

const portrait = picture(torso, hangingArm, hangingFore)
const variant = picture(torso, ...raised)
const pictures = {
  width: W,
  height: H,
  side: 'left' as const,
  portrait,
  variant,
  changed: mask(...raised),
  ground: Uint8Array.from(mask(torso, ...raised), (drawn) => 1 - drawn),
  difference: Float32Array.from(mask(...raised, hangingArm, hangingFore), (moved) => moved * 255),
  base: mask(hangingArm, hangingFore),
  portraitPose: pose(SHOULDER, HANG_ELBOW, HANG_WRIST, null),
  variantPose: pose(SHOULDER, ELBOW, WRIST, HAND),
}

test('a gesture arm is measured as a 3D arm off the portrait and the variant', () => {
  const model = measureArmModel(pictures)
  assert.ok(model)
  // Bones as long as either picture draws them; drawn shorter, the bone comes toward the viewer.
  const drawnUpper = Math.hypot(ELBOW[0] - SHOULDER[0], ELBOW[1] - SHOULDER[1])
  const hangingUpper = Math.hypot(HANG_ELBOW[0] - SHOULDER[0], HANG_ELBOW[1] - SHOULDER[1])
  assert.equal(model.upper, Math.max(drawnUpper, hangingUpper))
  assert.equal(model.fore, Math.hypot(WRIST[0] - ELBOW[0], WRIST[1] - ELBOW[1]))
  assert.deepEqual(model.raised.shoulder, [...SHOULDER, 0])
  assert.ok(model.raised.elbow[2] > 0)
  assert.ok(Math.abs(Math.hypot(...model.raised.elbow.map((v, i) => v - model.raised.shoulder[i])) - model.upper) < 1e-6)
  // The portrait's arm hangs straight: its forearm goes on the way its upper arm does.
  const hang = [HANG_ELBOW[0] - SHOULDER[0], HANG_ELBOW[1] - SHOULDER[1]]
  const fore = [model.rest.wrist[0] - model.rest.elbow[0], model.rest.wrist[1] - model.rest.elbow[1]]
  assert.ok(Math.abs(hang[0] * fore[1] - hang[1] * fore[0]) < 1e-6 * Math.hypot(...hang) * Math.hypot(...fore))

  // The sleeve: the portrait's arm layer along the upper arm, the variant's forearm to where its sleeve ends.
  assert.equal(model.radius.length, 24)
  for (const r of model.radius.slice(2, 10)) assert.ok(Math.abs(r - 55) <= 3, `upper radius ${r}`)
  // Away from the elbow, where the upper arm joins it.
  for (const r of model.radius.slice(19, 24)) assert.ok(Math.abs(r - 48) <= 3, `forearm radius ${r}`)
  assert.ok(Math.abs(model.cuff - CUFF) <= 0.03, `cuff ${model.cuff}`)
  assert.ok(model.bare !== undefined && Math.abs(model.bare - 30.5) <= 1.5, `bare ${model.bare}`)
  // A plain sleeve is worn all the way down the upper arm.
  assert.equal(model.restEnd, 0.49)
  assert.ok(model.restReach.slice(0, 12).every((o) => o && o[0] > 40 && o[1] > 40))

  // The hand: its fingers drawn 11 wide either side of the bone. The cut's softened edge lies a couple of pixels
  // inside the drawn one; the profile puts its line back.
  assert.equal(model.hand.length, 21)
  for (const w of model.fingers.slice(1)) assert.ok(w >= 7 && w <= 11, `finger ${w}`)
  assert.equal(model.fingerProfile.length, 5)
  for (const profile of model.fingerProfile.slice(1)) {
    assert.equal(profile.length, 9)
    for (const w of profile) assert.ok(Math.abs(w - 11) <= 1.5, `finger profile ${w}`)
  }
  assert.deepEqual(model.hiddenFingers, [])
  assert.equal(model.palmOutline?.length, 24)
  assert.deepEqual(model.skin, [...SKIN])

  // Outlines: the arm as cut (its holes as rings of their own), the hand without the sleeve.
  const armArea = pictures.changed.reduce((sum, v) => sum + v, 0)
  const filled = model.armOutline.reduce((sum, ring) => {
    const depth = model.armOutline.filter((other) => other !== ring && inside(ring[0], other)).length
    return sum + (depth % 2 ? -1 : 1) * Math.abs(area(ring))
  }, 0)
  assert.ok(Math.abs(filled - armArea) / armArea < 0.02, `arm outline ${filled} of ${armArea}`)
  assert.ok(model.handOutline.length >= 1)
  const handTop = Math.min(...model.handOutline.flat().map((q) => q[1]))
  const handBottom = Math.max(...model.handOutline.flat().map((q) => q[1]))
  assert.ok(handTop < 268 && handTop > 250, `hand top ${handTop}`)
  // Down the bare forearm no further than its own cut reaches: the wrist fades out by geometry, not by outline.
  assert.ok(handBottom < CUFF_AT[1], `hand bottom ${handBottom}`)
})

test('without a hand found on the variant there is no 3D arm', () => {
  assert.equal(measureArmModel({ ...pictures, variantPose: pose(SHOULDER, ELBOW, WRIST, null) }), null)
})

test('the hand found at the arm\'s own wrist is taken, whichever the pose model called it', () => {
  const swapped = pose(SHOULDER, ELBOW, WRIST, null)
  HAND.forEach((q, i) => {
    swapped[91 + i] = [...q, 0.8]
    // The other hand, hanging and surer of itself, is not this arm's.
    swapped[112 + i] = [800 + q[0] - WRIST[0], 1160 + q[1] - WRIST[1], 0.95]
  })
  const model = measureArmModel({ ...pictures, variantPose: swapped })
  assert.ok(model)
  assert.ok(Math.hypot(model.hand[0][0] - WRIST[0], model.hand[0][1] - WRIST[1]) < 1)
})

test('a model placed on the document moves its points and scales its lengths', () => {
  const model = measureArmModel(pictures)
  assert.ok(model)
  const placed = placeArmModel(model, 2, 10, -20)
  assert.deepEqual(placed.raised.wrist, [model.raised.wrist[0] * 2 + 10, model.raised.wrist[1] * 2 - 20, model.raised.wrist[2] * 2])
  assert.equal(placed.upper, model.upper * 2)
  assert.equal(placed.radius[5], model.radius[5] * 2)
  assert.deepEqual(placed.hand[8], [model.hand[8][0] * 2 + 10, model.hand[8][1] * 2 - 20])
  assert.deepEqual(placed.handOutline[0][0], [model.handOutline[0][0][0] * 2 + 10, model.handOutline[0][0][1] * 2 - 20])
  // Ratios along the arm and the palm's own frame do not move.
  assert.equal(placed.cuff, model.cuff)
  assert.deepEqual(placed.palmOutline, model.palmOutline)
})

test('rings follow a field\'s edge, holes as rings of their own', () => {
  const w = 40
  const h = 30
  const field = new Float32Array(w * h)
  for (let y = 5; y < 25; y += 1) {
    for (let x = 5; x < 35; x += 1) field[y * w + x] = x >= 15 && x < 25 && y >= 10 && y < 20 ? 0 : 1
  }
  const found = rings(field, w, h, 0.5).map((ring) => Math.abs(area(ring))).sort((a, b) => b - a)
  // Edges half way between pixel centres, corners cut: 30 × 20 less the corners, the hole 10 × 10 grown the same.
  assert.equal(found.length, 2)
  assert.ok(Math.abs(found[0] - 30 * 20) < 2, `outer ${found[0]}`)
  assert.ok(Math.abs(found[1] - 10 * 10) < 2, `hole ${found[1]}`)
})
