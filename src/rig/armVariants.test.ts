import type { Anime25DSourceReference, RasterLayer } from './anime25dImportTypes'
import type { ArmVariantReference } from './armVariants'
import assert from 'node:assert/strict'
import test from 'node:test'
import { cutArmVariantLayers } from './armVariants'

// A 1152-wide portrait on a document twice its size: the cut works at the portrait's own scale.
const SCALE = 2
const W = 1152 * SCALE
const H = 1536 * SCALE
const GROUND = [255, 255, 255] as const
const BODY = [90, 110, 170] as const
const SKIN = [240, 210, 196] as const

type Rgb = readonly [number, number, number]
type Paint = (x: number, y: number) => Rgb | null

// In portrait pixels: a torso, the left arm hanging at its side, and the
// same arm raised beside the head in the variant.
const torso: Paint = (x, y) => (x >= 420 && x < 760 && y >= 700 ? BODY : null)
const hangingArm: Paint = (x, y) => (x >= 330 && x < 420 && y >= 760 ? BODY : null)
const raisedArm: Paint = (x, y) =>
  x >= 280 && x < 380 && y >= 340 && y < 420 ? SKIN : x >= 300 && x < 360 && y >= 420 && y < 760 ? BODY : null

function picture(...paints: Paint[]): Anime25DSourceReference {
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const color = paints.reduce<Rgb | null>((found, paint) => paint(x / SCALE, y / SCALE) ?? found, null) ?? GROUND
      const i = (y * W + x) * 4
      data[i] = color[0]
      data[i + 1] = color[1]
      data[i + 2] = color[2]
      data[i + 3] = 255
    }
  }
  return { width: W, height: H, data }
}

function layerOf(paint: Paint, role: RasterLayer['role'], side: RasterLayer['side']): RasterLayer {
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const color = paint(x / SCALE, y / SCALE)
      if (!color) continue
      const i = (y * W + x) * 4
      data.set([...color, 255], i)
    }
  }
  return { id: `${role}-${side}`, role, sourceName: role, order: 0, side, group: 'body', left: 0, top: 0, width: W, height: H, data }
}

const portrait = picture(torso, hangingArm)
const variant = picture(torso, raisedArm)
const reference: ArmVariantReference = {
  ...variant,
  gesture: 'wave',
  side: 'left',
  placement: { x: 0, y: 0, width: W, height: H },
  hand: [[330 * SCALE, 380 * SCALE]],
}
const layers = [layerOf(torso, 'topwear', null), layerOf(hangingArm, 'handwear', 'left')]

function alphaAt(layer: RasterLayer, x: number, y: number): number {
  const lx = x * SCALE - layer.left
  const ly = y * SCALE - layer.top
  if (lx < 0 || ly < 0 || lx >= layer.width || ly >= layer.height) return 0
  return layer.data[(ly * layer.width + lx) * 4 + 3]
}

test('a gesture arm is cut whole, with the bare ground its own arm leaves, as one hidden layer', () => {
  const [arm, ...rest] = cutArmVariantLayers(layers, portrait, [reference])
  assert.equal(rest.length, 0)
  assert.ok(arm)
  assert.equal(arm.role, 'arm-variant')
  assert.equal(arm.side, 'left')
  assert.deepEqual(arm.armVariant, { gesture: 'wave', lift: 'whole' })
  assert.match(arm.id, /^arm-variant-wave-left/)
  // The raised hand and forearm are in it.
  assert.equal(alphaAt(arm, 330, 380), 255)
  assert.equal(alphaAt(arm, 330, 600), 255)
  // Where the hanging arm was, the variant shows ground: nothing to cover there.
  assert.equal(alphaAt(arm, 375, 1000), 0)
  // The torso both pictures share stays out.
  assert.equal(alphaAt(arm, 600, 1000), 0)
})

test('an arm the variant draws the same as the portrait is carried with the cut', () => {
  // The variant keeps the upper arm where it hung and raises only the forearm:
  // that upper arm is bare once the portrait's arm hides, so the layer covers it.
  const upper: Paint = (x, y) => (x >= 330 && x < 420 && y >= 760 && y < 900 ? BODY : null)
  const forearm: Paint = (x, y) => (x >= 300 && x < 360 && y >= 420 && y < 760 ? SKIN : null)
  const bent = { ...reference, ...picture(torso, upper, forearm), hand: [[330 * SCALE, 500 * SCALE]] as const }
  const [arm] = cutArmVariantLayers(layers, portrait, [bent])
  assert.ok(arm)
  assert.equal(alphaAt(arm, 375, 820), 255)
  assert.equal(alphaAt(arm, 330, 600), 255)
})

test('a variant with no change at its hand, or the wrong size, gives no layer', () => {
  assert.deepEqual(cutArmVariantLayers(layers, portrait, [{ ...reference, ...portrait }]), [])
  assert.deepEqual(cutArmVariantLayers(layers, portrait, [{ ...reference, hand: [[100, 100]] }]), [])
  const small = { ...reference, width: 10, height: 10, data: new Uint8ClampedArray(400) }
  assert.deepEqual(cutArmVariantLayers(layers, portrait, [small]), [])
  assert.deepEqual(cutArmVariantLayers(layers, undefined, [reference]), [])
})

test('the same gesture on the same side is cut once; shoulder gestures stay on the shoulder', () => {
  const chest = { ...reference, gesture: 'chest' as const }
  const cut = cutArmVariantLayers(layers, portrait, [reference, reference, chest])
  assert.deepEqual(cut.map((layer) => layer.armVariant), [
    { gesture: 'wave', lift: 'whole' },
    { gesture: 'chest', lift: 'shoulder' },
  ])
  assert.notEqual(cut[0].id, cut[1].id)
})

test('with the pose model\'s joints on both pictures the arm is measured in 3D too, in the layer\'s own pixels', () => {
  // COCO-WholeBody in document pixels: the person's right arm (6, 8, 10, hand 112–132) on the picture's left.
  const pose = (arm: ReadonlyArray<readonly [number, number]>, hand: ReadonlyArray<readonly [number, number]> = []) => {
    const k: Array<[number, number, number]> = Array.from({ length: 133 }, () => [0, 0, 0])
    k[5] = [800 * SCALE, 760 * SCALE, 0.9]
    ;[6, 8, 10].forEach((index, i) => {
      k[index] = [arm[i][0] * SCALE, arm[i][1] * SCALE, 0.9]
    })
    hand.forEach(([x, y], i) => {
      k[112 + i] = [x * SCALE, y * SCALE, 0.9]
    })
    return k
  }
  const hand = [
    [330, 415], [305, 405], [295, 390], [288, 375], [284, 360],
    [300, 382], [299, 368], [298, 356], [297, 346],
    [320, 380], [320, 366], [320, 354], [320, 344],
    [340, 380], [341, 366], [342, 354], [343, 346],
    [360, 384], [362, 372], [363, 362], [364, 354],
  ] as const
  const skeleton = { model: 'test', keypoints: pose([[375, 760], [375, 1100], [375, 1400]]) }
  const measured = { ...reference, keypoints: pose([[400, 780], [330, 760], [330, 420]], hand) }
  const [arm, whole] = cutArmVariantLayers(layers, portrait, [measured], skeleton)
  const model = arm?.armVariant?.model
  assert.ok(model)
  // Joints from the layer's own top-left corner, lengths in document pixels.
  assert.ok(Math.abs(model.raised.wrist[0] + arm.left - 330 * SCALE) < 1e-6)
  assert.ok(Math.abs(model.raised.wrist[1] + arm.top - 420 * SCALE) < 1e-6)
  assert.ok(Math.abs(model.rest.shoulder[0] + arm.left - 375 * SCALE) < 1e-6)
  assert.ok(Math.abs(model.fore - 340 * SCALE) < 1e-6)
  assert.ok(model.armOutline.flat().every(([x, y]) => x >= -1 && y >= -1 && x <= arm.width + 1 && y <= arm.height + 1))
  // The drawn hand whole beside it, opaque, about the hand's points: the modelled hand wears it held as drawn.
  assert.equal(whole?.role, 'arm-variant-hand')
  assert.equal(whole.id, `arm-variant-hand-${arm.id.slice('arm-variant-'.length)}`)
  assert.ok(hand.every(([x, y]) => x * SCALE >= whole.left && y * SCALE >= whole.top && x * SCALE < whole.left + whole.width && y * SCALE < whole.top + whole.height))
  assert.ok(whole.data.every((v, i) => i % 4 !== 3 || v === 255))
  // Without the portrait's joints it is raised in flat, as before, and has no hand of its own.
  const flat = cutArmVariantLayers(layers, portrait, [measured])
  assert.equal(flat[0]?.armVariant?.model, undefined)
  assert.equal(flat.length, 1)
})
