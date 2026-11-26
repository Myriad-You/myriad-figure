import type { RasterLayer } from '@myriad/figure-player/internals'
import type { Anime25DSourceReference } from './anime25dImportTypes'
import type { Anime25DPsdAnalysis } from './psdReconciliation'
import type { RecoveredPiece } from './psdRepairLayers'
import { MATCH_DISTANCE, rgbDistance } from './psdReconciliation'
import { alphaAt, closeMask, components, fringe } from './psdRepairMasks'

type GarmentRole = 'bottomwear' | 'legwear'

/**
 * What a garment hides where it was dropped: drawn there by the
 * decomposition (it paints what lies behind a garment too), shown in its
 * place. Back hair falls behind a skirt; legs and shoes go under it.
 */
const HIDDEN_BY: Record<GarmentRole, ReadonlySet<string>> = {
  bottomwear: new Set(['back-hair', 'legwear', 'footwear']),
  legwear: new Set(['back-hair']),
}

/**
 * A garment-sized part of the portrait no layer drew, below the head: the
 * garment it is, or null when no garment explains it. Where it touches the
 * lower garment or the legs and its colours carry on across the seam, it is
 * the rest of that garment, drawn only in part, and joins that layer (legs
 * hanging from a skirt touch it too, but change colour there). Otherwise,
 * below the top's middle it is the lower garment, below the lower garment the
 * legs'. Most of it must lie over nothing or over what that garment hides, so
 * a print the top missed stays a reported mismatch.
 */
export function droppedGarment(
  analysis: Readonly<Anime25DPsdAnalysis>,
  shown: readonly number[],
  visible: readonly RasterLayer[],
  reference: Readonly<Anime25DSourceReference>,
): Pick<RecoveredPiece, 'group' | 'neighbour' | 'owner' | 'role'> | null {
  const { bounds } = analysis
  const top = spanOf(visible, 'topwear')
  if (!top) return null
  const middle =
    bounds.y0 + shown.reduce((sum, target) => sum + Math.floor(target / bounds.width), 0) / shown.length
  if (middle < (top.top + top.bottom) / 2) return null
  const continued = continuedLayers(analysis, shown, visible, reference)
  const lower = spanOf(visible, 'bottomwear')
  const role: GarmentRole = continued.bottomwear >= 0
    ? 'bottomwear'
    : continued.legwear >= 0 || (lower && middle > lower.bottom)
      ? 'legwear'
      : 'bottomwear'
  const hidden = HIDDEN_BY[role]
  const over = shown.filter((target) => {
    const index = analysis.top[target]
    return index < 0 || hidden.has(visible[index].role)
  }).length
  if (over * 2 < shown.length) return null
  const owner = continued[role]
  return {
    group: 'body',
    neighbour: owner >= 0 ? owner : visible.findLastIndex((layer) => layer.role === 'topwear'),
    owner,
    role,
  }
}

/** How far across the seam a dropped part is compared with the layer it may continue. */
const GARMENT_TOUCH = 3

/** What the outfit is made of: a dropped piece touching one of these may be the rest of it. */
const WORN = new Set(['topwear', 'bottomwear', 'legwear', 'handwear', 'footwear'])

/**
 * The garment layer a dropped piece carries on: of the layers it touches
 * whose roles `of` accepts, the one it touches most along its rim where the
 * portrait's colours either side of the seam match on average. -1 for none.
 */
function carriedOn(
  analysis: Readonly<Anime25DPsdAnalysis>,
  shown: readonly number[],
  visible: readonly RasterLayer[],
  reference: Readonly<Anime25DSourceReference>,
  of: (role: string) => boolean,
): number {
  const { bounds } = analysis
  const pixel = (target: number) => {
    const x = bounds.x0 + (target % bounds.width)
    const y = bounds.y0 + Math.floor(target / bounds.width)
    return (y * reference.width + x) * 4
  }
  const inside = new Set(shown)
  const seams = new Map<number, { pairs: number; distance: number }>()
  for (const [target, member] of fringe(shown, bounds.width, bounds.height, GARMENT_TOUCH)) {
    const index = analysis.top[target]
    if (inside.has(target) || index < 0 || !of(visible[index].role)) continue
    const from = pixel(member)
    const color = [reference.data[from], reference.data[from + 1], reference.data[from + 2]] as const
    const seam = seams.get(index) ?? { pairs: 0, distance: 0 }
    seam.pairs += 1
    seam.distance += rgbDistance(reference.data, pixel(target), color)
    seams.set(index, seam)
  }
  let best = -1
  let pairs = 0
  for (const [index, seam] of seams) {
    if (seam.distance / seam.pairs > MATCH_DISTANCE || seam.pairs <= pairs) continue
    best = index
    pairs = seam.pairs
  }
  return best
}

/** Of each garment kind, the layer the part carries on (carriedOn), or -1. */
function continuedLayers(
  analysis: Readonly<Anime25DPsdAnalysis>,
  shown: readonly number[],
  visible: readonly RasterLayer[],
  reference: Readonly<Anime25DSourceReference>,
): Record<GarmentRole, number> {
  return {
    bottomwear: carriedOn(analysis, shown, visible, reference, (role) => role === 'bottomwear'),
    legwear: carriedOn(analysis, shown, visible, reference, (role) => role === 'legwear'),
  }
}

/**
 * A small piece no layer drew that carries on a garment it touches: its
 * frayed edge where a decomposition stopped short (notches along a hakama
 * the importer had lifted as loose objects that moved on their own). It
 * joins that garment; null when it carries on none.
 */
export function garmentEdge(
  analysis: Readonly<Anime25DPsdAnalysis>,
  shown: readonly number[],
  visible: readonly RasterLayer[],
  reference: Readonly<Anime25DSourceReference>,
): Pick<RecoveredPiece, 'group' | 'neighbour' | 'owner' | 'role'> | null {
  const owner = carriedOn(analysis, shown, visible, reference, (role) => WORN.has(role))
  if (owner < 0) return null
  return { group: visible[owner].group, neighbour: owner, owner, role: visible[owner].role }
}

function spanOf(visible: readonly RasterLayer[], role: string): { top: number; bottom: number } | null {
  const layers = visible.filter((layer) => layer.role === role)
  if (layers.length === 0) return null
  return {
    top: Math.min(...layers.map((layer) => layer.top)),
    bottom: Math.max(...layers.map((layer) => layer.top + layer.height)),
  }
}

/**
 * Hair hanging over a lifted garment leaves strand-shaped gaps in it, up to
 * twice this across. A strand of a layer drawn under the garment (the back
 * hair) shows through its gap only at rest: once either moves, the gap shows
 * the backdrop. So the garment takes what the portrait has there, the strand
 * drawn on it. Under a layer drawn over the garment (a front lock hanging
 * down) the gap is the garment's own hidden part, filled with its colours, so
 * the lock can swing off it.
 */
const GARMENT_GAP = 12

/**
 * Closes the gaps hair leaves in a lifted garment, adding to `pixels` (keyed
 * by canvas index). `under` is the last of `visible` drawn under the garment.
 */
export function closeGarmentGaps(
  analysis: Readonly<Anime25DPsdAnalysis>,
  shown: readonly number[],
  under: number,
  reference: Readonly<Anime25DSourceReference>,
  pixels: Map<number, readonly [number, number, number, number]>,
): void {
  const { bounds } = analysis
  const mask = new Uint8Array(bounds.width * bounds.height)
  for (const target of shown) mask[target] = 1
  const closed = closeMask(mask, bounds.width, bounds.height, GARMENT_GAP)
  const hidden: number[] = []
  for (let target = 0; target < closed.length; target += 1) {
    if (!closed[target] || mask[target]) continue
    const x = bounds.x0 + (target % bounds.width)
    const y = bounds.y0 + Math.floor(target / bounds.width)
    const offset = (y * reference.width + x) * 4
    if (reference.data[offset + 3] < 250) continue
    const key = y * reference.width + x
    if (analysis.top[target] <= under) {
      pixels.set(key, [reference.data[offset], reference.data[offset + 1], reference.data[offset + 2], 255])
    } else {
      hidden.push(key)
    }
  }
  fillFromNeighbours(hidden, reference.width, pixels)
}

/** Grows the known colours into `keys`, a ring at a time, each the mean of its known neighbours. */
function fillFromNeighbours(
  keys: readonly number[],
  width: number,
  pixels: Map<number, readonly [number, number, number, number]>,
): void {
  let left = keys.filter((key) => !pixels.has(key))
  while (left.length > 0) {
    const ring: Array<[number, readonly [number, number, number, number]]> = []
    const rest: number[] = []
    for (const key of left) {
      let red = 0
      let green = 0
      let blue = 0
      let count = 0
      for (const next of [key - 1, key + 1, key - width, key + width]) {
        const known = pixels.get(next)
        if (!known) continue
        red += known[0]
        green += known[1]
        blue += known[2]
        count += 1
      }
      if (count === 0) rest.push(key)
      else ring.push([key, [Math.round(red / count), Math.round(green / count), Math.round(blue / count), 255]])
    }
    if (ring.length === 0) break
    for (const [key, rgba] of ring) pixels.set(key, rgba)
    left = rest
  }
}

/**
 * A hole is read this far in from its edge, past the line art's anti-aliasing:
 * a narrow gap between an arm and the body has no inside, so it stays a gap.
 */
const ENCLOSED_INSET = 2
/**
 * Inside, a hole this far off the backdrop's colour on average (RGB) is drawn
 * art, not a gap showing the page, when it is shaded: neighbouring pixels
 * differ by ENCLOSED_GRAIN (summed over RGB) on average. A page shaded a few
 * steps off its border, or running in a gradient, is flat; at ENCLOSED_CLEAR_TINT
 * the tint alone tells it.
 */
const ENCLOSED_TINT = 6
const ENCLOSED_GRAIN = 0.3
const ENCLOSED_CLEAR_TINT = 20
/** Of a hole's rim, at least this share is the garment it is filled into. */
const ENCLOSED_RIM_SHARE = 0.4
/** A garment drawn under the one filled, along this share of the hole's rim, is filled beneath it too. */
const ENCLOSED_SEAM_SHARE = 0.1
const ENCLOSED_OPAQUE = 0.5
/**
 * The filled garment runs on this far under what covers its rim (the neck
 * over an open hood's chest), its colour carried on from the hole, so a part
 * moving off it on a turn uncovers garment, not the page. Under the body's
 * other layers it runs on only where they are drawn over it.
 */
const ENCLOSED_UNDER = 32

/**
 * White drawn on a white page a decomposition left out whole (a sleeve's
 * white panel, the chest in an open hood): a hole no layer covers, enclosed by
 * the outfit (not the open backdrop), below the chin, where the portrait is
 * near enough the backdrop to pass for it pixel by pixel (art standing off it
 * is recovered as missing) but tinted off it as a whole. It is taken from the
 * portrait into the garment that holds most of its rim. Returns the pixels per
 * garment (keyed y * reference width + x) and the targets the portrait gave.
 */
export function enclosedGarments(
  analysis: Readonly<Anime25DPsdAnalysis>,
  visible: readonly RasterLayer[],
  reference: Readonly<Anime25DSourceReference>,
  chin: number,
): { pixels: Map<number, Map<number, readonly [number, number, number, number]>>; filled: Set<number> } {
  const pixels = new Map<number, Map<number, readonly [number, number, number, number]>>()
  const filled = new Set<number>()
  const { bounds, alpha, outside, top, background } = analysis
  if (!outside) return { pixels, filled }
  const { width, height } = bounds
  const shownAt = (target: number) =>
    ((bounds.y0 + Math.floor(target / width)) * reference.width + bounds.x0 + (target % width)) * 4
  const keyOf = (target: number) => (bounds.y0 + Math.floor(target / width)) * reference.width + bounds.x0 + (target % width)
  const neighbours = (target: number) => {
    const x = target % width
    const y = Math.floor(target / width)
    return [x > 0 ? target - 1 : -1, x < width - 1 ? target + 1 : -1, y > 0 ? target - width : -1, y < height - 1 ? target + width : -1]
  }
  const mask = new Uint8Array(width * height)
  for (let target = 0; target < mask.length; target += 1) {
    const offset = shownAt(target)
    // Only what passes for the page (art standing off it is recovered as missing).
    if (alpha[target] < ENCLOSED_OPAQUE && !outside[target] && reference.data[offset + 3] >= 250 && rgbDistance(reference.data, offset, background.color) < MATCH_DISTANCE) mask[target] = 1
  }
  for (const members of components(mask, width, height)) {
    if (members.length < analysis.minArea) continue
    let rows = 0
    for (const target of members) rows += Math.floor(target / width)
    if (bounds.y0 + rows / members.length < chin) continue
    let inside = members
    for (let step = 0; step < ENCLOSED_INSET; step += 1) {
      const kept = new Set(inside)
      inside = inside.filter((target) => neighbours(target).every((next) => next >= 0 && kept.has(next)))
    }
    if (inside.length === 0) continue
    let tint = 0
    let grain = 0
    for (const target of inside) {
      const offset = shownAt(target)
      tint += rgbDistance(reference.data, offset, background.color)
      // Its right-hand neighbour is in the hole too: it is inside.
      for (let channel = 0; channel < 3; channel += 1) grain += Math.abs(reference.data[offset + channel] - reference.data[offset + 4 + channel])
    }
    tint /= inside.length
    grain /= inside.length
    if (tint < ENCLOSED_TINT || (tint < ENCLOSED_CLEAR_TINT && grain < ENCLOSED_GRAIN)) continue
    const rim = new Map<number, number>()
    let around = 0
    for (const target of members) {
      for (const next of neighbours(target)) {
        if (next < 0 || mask[next] || alpha[next] < ENCLOSED_OPAQUE) continue
        around += 1
        const index = top[next]
        if (index >= 0 && WORN.has(visible[index].role)) rim.set(index, (rim.get(index) ?? 0) + 1)
      }
    }
    let owner = -1
    for (const [index, n] of rim) {
      if (owner < 0 || n > rim.get(owner)!) owner = index
    }
    if (owner < 0 || rim.get(owner)! < ENCLOSED_RIM_SHARE * around) continue
    const garment = visible[owner]
    const into = pixels.get(owner) ?? new Map<number, readonly [number, number, number, number]>()
    pixels.set(owner, into)
    const colour = new Map<number, readonly [number, number, number, number]>()
    for (const target of members) {
      const offset = shownAt(target)
      const rgba = [reference.data[offset], reference.data[offset + 1], reference.data[offset + 2], 255] as const
      colour.set(target, rgba)
      into.set(keyOf(target), rgba)
      filled.add(target)
    }
    // A garment drawn under it along its rim runs on beneath it too: hidden at rest, it
    // keeps the seam closed when the two move apart (a sleeve's panel off the torso on a turn).
    for (const [index, n] of rim) {
      if (index >= owner || n < ENCLOSED_SEAM_SHARE * around) continue
      const under = pixels.get(index) ?? new Map<number, readonly [number, number, number, number]>()
      pixels.set(index, under)
      for (const target of members) under.set(keyOf(target), colour.get(target)!)
    }
    // On under what covers the rim, carrying the nearest colour.
    let front = [...members]
    for (let step = 0; step < ENCLOSED_UNDER && front.length > 0; step += 1) {
      const next: number[] = []
      for (const target of front) {
        for (const beside of neighbours(target)) {
          // Under the head's parts (they move off it on a turn), and under what is drawn over
          // the garment; not over the rest of the body drawn under it, where it would show.
          const cover = beside < 0 ? -1 : top[beside]
          if (beside < 0 || cover < 0 || colour.has(beside) || alpha[beside] < ENCLOSED_OPAQUE || cover === owner) continue
          if (cover < owner && visible[cover].group !== 'head' && visible[cover].role !== 'neck') continue
          const x = bounds.x0 + (beside % width)
          const y = bounds.y0 + Math.floor(beside / width)
          if (alphaAt(garment, x, y) > 0) continue
          colour.set(beside, colour.get(target)!)
          into.set(keyOf(beside), colour.get(target)!)
          next.push(beside)
        }
      }
      front = next
    }
  }
  return { pixels, filled }
}
