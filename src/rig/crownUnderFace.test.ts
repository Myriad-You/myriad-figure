import type { Anime25DSourceReference, RasterLayer } from './anime25dImportTypes'
import assert from 'node:assert/strict'
import test from 'node:test'
import { revealCrownUnderFace as revealWith } from './crownUnderFace'

const SKIN = [235, 189, 193] as const
// Pale hair, as close to the skin as reconciliation lets pass (about 66 apart).
const HAIR = [240, 235, 246] as const
const FRINGE = [176, 192, 234] as const
const SIZE = 100

const revealCrownUnderFace = (layers: RasterLayer[], reference: Anime25DSourceReference) => revealWith(layers, () => true, reference)

function layer(id: string, role: RasterLayer['role'], box: { left: number; top: number; width: number; height: number }): RasterLayer {
  return { id, role, sourceName: id, order: 0, side: null, group: 'head', ...box, data: new Uint8ClampedArray(box.width * box.height * 4) }
}

function paint(target: { left?: number; top?: number; width: number; data: Uint8ClampedArray }, x0: number, y0: number, x1: number, y1: number, rgba: readonly number[]) {
  const left = target.left ?? 0
  const top = target.top ?? 0
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) target.data.set(rgba, ((y - top) * target.width + x - left) * 4)
  }
}

function alpha(target: RasterLayer, x: number, y: number): number {
  return target.data[((y - target.top) * target.width + x - target.left) * 4 + 3]
}

/**
 * Back hair over the whole head, a face drawn as a dome from y 10, a fringe
 * over the middle (x 40..60) down to the eyes. The portrait shows hair over
 * the crown (y < `hairline`) and skin below it.
 */
function head(hairline: number) {
  const back = layer('back-hair', 'back-hair', { left: 0, top: 0, width: SIZE, height: SIZE })
  paint(back, 0, 0, SIZE, SIZE, [...HAIR, 255])
  const face = layer('face', 'face', { left: 10, top: 10, width: 80, height: 90 })
  paint(face, 10, 10, 90, 100, [...SKIN, 255])
  const fringe = layer('front-hair', 'front-hair', { left: 40, top: 5, width: 20, height: 50 })
  paint(fringe, 40, 5, 60, 55, [...FRINGE, 255])
  const reference = { width: SIZE, height: SIZE, data: new Uint8ClampedArray(SIZE * SIZE * 4) }
  paint(reference, 0, 0, SIZE, SIZE, [...HAIR, 255])
  paint(reference, 10, hairline, 90, 100, [...SKIN, 255])
  paint(reference, 40, 5, 60, 55, [...FRINGE, 255])
  return { layers: [back, face, fringe], reference }
}

test('the dome over hair the portrait shows at the crown goes; the forehead below stays', () => {
  const { layers, reference } = head(30)
  const face = revealCrownUnderFace(layers, reference)[1]
  assert.equal(alpha(face, 20, 15), 0, 'crown beside the fringe')
  assert.equal(alpha(face, 80, 20), 0, 'crown on the other side')
  assert.equal(alpha(face, 20, 40), 255, 'forehead the portrait shows')
  assert.equal(alpha(face, 41, 20), 0, 'just under the fringe edge, which a turn slides off')
  assert.equal(alpha(face, 50, 20), 255, 'under the middle of the fringe, kept for turns')
  assert.equal(alpha(face, 50, 70), 255, 'the face itself')
})

test('a face whose skin the portrait shows to its top is left as it is', () => {
  const { layers, reference } = head(10)
  const out = revealCrownUnderFace(layers, reference)
  assert.equal(out[1], layers[1])
})

test('skin the portrait shows lower down is never taken, even where hair matches it better', () => {
  // Hair over the cheeks in the portrait, below the crown rows: not this step's to judge.
  const { layers, reference } = head(10)
  paint(reference, 10, 60, 30, 90, [...HAIR, 255])
  const out = revealCrownUnderFace(layers, reference)
  assert.equal(out[1], layers[1])
})
