import type { Anime25DSourceReference, RasterLayer } from './anime25dImportTypes'
import { alphaAt, closeMask, components } from './psdRepairMasks'

/** The crown: rows of the face this far down from its top (the eyes sit near half). */
const CROWN_SHARE = 0.4
/** Nothing in front of the face there (the fringe and its locks, a hair ornament). */
const ABOVE_ALPHA = 64
const FACE_ALPHA = 128
const BACK_ALPHA = 128
/**
 * The back hair has to be this much closer to the portrait than the skin (RGB
 * distance). Pale hair against pale skin is only 60-75 apart, under what
 * reconciliation calls a mismatch, so the absolute test passes the skin.
 */
const CLOSER = 12
const CLOSING = 2
/** Pieces smaller than this share of the face's crown rows are noise. */
const MIN_SHARE = 0.01
/** A piece reaches the crown: its top lies within this share of the face's height from the face's top. */
const TOP_REACH = 0.15
/**
 * The cut carries on under the fringe's edge this share of the face's height:
 * the dome there is hidden at rest, but a turn or a nod slides the fringe off
 * it and a sliver of skin shows along the cut.
 */
const UNDER_REACH = 0.04
const SOFT_EDGE = 2
const SOFT_EDGE_ALPHA = 160

/**
 * A decomposition can draw the face as a whole dome up to the top of the
 * skull, under hair the portrait shows there. The back hair is drawn behind
 * the face, so where the fringe does not reach (both sides of the parting),
 * the dome shows at rest as a band of skin across the crown.
 *
 * With the portrait, the face's crown goes where nothing is in front of it
 * and the back hair under it is the closer match: the hair shows, as the
 * portrait has it. A forehead the portrait shows stays, since there the skin
 * is the closer match.
 */
export function revealCrownUnderFace(
  layers: RasterLayer[],
  visibleAtRest: (layer: RasterLayer) => boolean,
  reference: Readonly<Anime25DSourceReference>,
): RasterLayer[] {
  const faceIndex = layers.findIndex((layer) => layer.role === 'face' && visibleAtRest(layer))
  if (faceIndex < 0) return layers
  const face = layers[faceIndex]
  const backs = layers.slice(0, faceIndex).filter((layer) => layer.role === 'back-hair' && visibleAtRest(layer))
  if (backs.length === 0) return layers
  const above = layers.slice(faceIndex + 1).filter(visibleAtRest)
  const width = face.width
  const rows = Math.min(face.height, Math.round(face.height * CROWN_SHARE))
  const mask = new Uint8Array(width * rows)
  for (let localY = 0; localY < rows; localY += 1) {
    const y = face.top + localY
    if (y < 0 || y >= reference.height) continue
    for (let localX = 0; localX < width; localX += 1) {
      const x = face.left + localX
      if (x < 0 || x >= reference.width) continue
      const faceOffset = (localY * width + localX) * 4
      if (face.data[faceOffset + 3] < FACE_ALPHA) continue
      const referenceOffset = (y * reference.width + x) * 4
      if (reference.data[referenceOffset + 3] < 250) continue
      if (above.some((layer) => alphaAt(layer, x, y) >= ABOVE_ALPHA)) continue
      const back = backs.findLast((layer) => alphaAt(layer, x, y) >= BACK_ALPHA)
      if (!back) continue
      const backOffset = ((y - back.top) * back.width + (x - back.left)) * 4
      const skin = distance(face.data, faceOffset, reference.data, referenceOffset)
      const hair = distance(back.data, backOffset, reference.data, referenceOffset)
      if (hair + CLOSER < skin) mask[localY * width + localX] = 1
    }
  }
  const closed = closeMask(mask, width, rows, CLOSING)
  const floor = width * rows * MIN_SHARE
  const reach = face.height * TOP_REACH
  const cut = components(closed, width, rows).filter((members) =>
    members.length >= floor && Math.floor(Math.min(...members) / width) <= reach)
  if (cut.length === 0) return layers
  const covered = (target: number) => {
    const x = face.left + (target % width)
    const y = face.top + Math.floor(target / width)
    return face.data[target * 4 + 3] > 0 && above.some((layer) => alphaAt(layer, x, y) >= ABOVE_ALPHA)
  }
  const under = growUnder(cut.flat(), width, rows, Math.round(face.height * UNDER_REACH), covered)
  const data = new Uint8ClampedArray(face.data)
  for (const members of [...cut, under]) {
    for (const target of members) {
      // The closing bridges between strands; only skin goes.
      const localX = target % width
      const localY = Math.floor(target / width)
      if (face.data[(localY * width + localX) * 4 + 3] === 0) continue
      data[(localY * width + localX) * 4 + 3] = 0
      // The dome's anti-aliased rim would linger as a pale outline.
      for (let dy = -SOFT_EDGE; dy <= SOFT_EDGE; dy += 1) {
        for (let dx = -SOFT_EDGE; dx <= SOFT_EDGE; dx += 1) {
          const nx = localX + dx
          const ny = localY + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= face.height) continue
          const offset = (ny * width + nx) * 4 + 3
          if (data[offset] > 0 && data[offset] < SOFT_EDGE_ALPHA) data[offset] = 0
        }
      }
    }
  }
  const out = layers.slice()
  out[faceIndex] = { ...face, data }
  return out
}

/** Pixels `accept` lets in, up to `reach` steps from the seeds (4-connected), seeds excluded. */
function growUnder(seeds: number[], width: number, rows: number, reach: number, accept: (target: number) => boolean): number[] {
  const steps = new Int32Array(width * rows).fill(-1)
  for (const seed of seeds) steps[seed] = 0
  const queue = [...seeds]
  const grown: number[] = []
  for (let head = 0; head < queue.length; head += 1) {
    const target = queue[head]
    if (steps[target] >= reach) continue
    const x = target % width
    for (const next of [x > 0 ? target - 1 : -1, x < width - 1 ? target + 1 : -1, target - width, target + width]) {
      if (next < 0 || next >= steps.length || steps[next] >= 0 || !accept(next)) continue
      steps[next] = steps[target] + 1
      queue.push(next)
      grown.push(next)
    }
  }
  return grown
}

function distance(a: Uint8ClampedArray, ai: number, b: Uint8ClampedArray, bi: number): number {
  return Math.hypot(a[ai] - b[bi], a[ai + 1] - b[bi + 1], a[ai + 2] - b[bi + 2])
}
