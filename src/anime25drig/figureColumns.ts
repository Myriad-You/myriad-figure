import type { Anime25DTorsoShellRotation } from './torsoDeformation'
import type { Anime25DTorsoShellProfile } from './types'
import { isAnime25DLiningPiece } from '../rig/anime25dLayerSemantics'
import { anime25DTurnedOffsetX, anime25DTurnedScale } from './torsoDeformation'

/**
 * A standing figure's limbs in its turn. The trunk turns as one cylinder
 * (torsoDeformation); an arm or a leg is not a patch of that cylinder but a
 * column of its own beside or below it. Taken as patches of the trunk, the
 * two legs were one flattened sheet: the far one squeezed thin where the
 * trunk's surface falls away, the near one stretched; and the sleeves stayed
 * where they hung while the trunk's sides drew in from under them.
 *
 * So each limb has its own axis (the middle of its drawing at each height)
 * and its own roundness about it. Its axis goes round the body's as the body
 * turns: both shoulders and both hips draw in toward the middle, the near
 * ones coming toward the viewer and showing a little larger, the far ones
 * going away. About its own axis the limb turns as the body does: what is
 * drawn on its front slides across it, its outline staying a column's.
 *
 * A leg stands on its foot: its axis goes round by all of this at the hips
 * and by none of it at the ground, so the feet stay where they stand and
 * turn there, as a figure's do when it turns without stepping.
 */

/** A limb stands this far out from its axis at its middle, for its half-width: nearly round. */
const LIMB_DEPTH = 0.9
/**
 * A column turning shows new surface at the edge it turns away from and hides it at the other; a drawing has
 * neither to give. So its outline is kept, and what is drawn on it slides most at its middle and not at all
 * at its edges: the round depth, eased to nothing there by this power of it. Left round to the edge, the
 * drawing was dragged in from the trailing edge and the limb showed a fifth thinner.
 */
const EDGE_EASE = 3
/**
 * A foot points at the viewer: drawn from the front, the bottom of a shoe is its toe, well out in front of the
 * ankle at its top. Turned with the leg, the toe swings across by its reach while the ankle stays over the
 * spot it stands on: the shoe leans its toe the way the figure faces. Its toe reaches this many of the shoe's
 * half-widths out in front (less than a foot's length: the drawing has no side of the shoe to show for more).
 */
const TOE_REACH = 0.9
/** ...over this many of its widths up from its sole: a boot's shaft above that is the leg's, and stands. */
const TOE_HEIGHT = 1
/**
 * A leg's top is the hips': down to this share of the way from the hips to the ground it goes with the trunk's
 * cylinder, as the skirt over it or the trousers' seat it is cut from does (whose edge fades out over it), and
 * is its own column from the second share down, above the knee. Handed over in a tenth of the leg, a trouser
 * leg's outline was sheared across by half its width just below the hips, an S in its side. Under a skirt that
 * handing over is not seen, and is done by its hem (no sooner than the third share): past the hem the thigh is
 * all its own column, not squeezed for being on the far side.
 */
const LEG_TOP = [0.04, 0.36, 0.1] as const
/**
 * A leg's mesh has this many rows of cells: enough for that handing over to be done where it is meant to be,
 * not a canvas cell further down, on the thigh in view. (Its canvas-sized cells were a dozen down a leg.)
 */
export const FIGURE_LEG_ROWS = 40
/** Its width is read in this many rows down its drawing. */
const ROWS = 48
/** The limb's own drawing starts at the first row at least this share as wide as its widest. */
const START_WIDTH = 0.35
/** A pixel at least this opaque is the limb's drawing. */
const DRAWN_ALPHA = 48

/** A layer of a limb, per vertex of its mesh. */
export interface FigureColumnBinding {
  /** Where its axis is at the vertex's height, canvas x. */
  axis: Float32Array
  /** How far out from the axis its surface stands there, toward the viewer, pixels. */
  depth: Float32Array
  /** How much of its axis' way round the body it goes: all for an arm, falling to none at the ground for a leg. */
  round: Float32Array
  /** An arm drawn behind the body's clothing, which turns over it on the far side (torsoDeformation's figureSleeveOffsetX). */
  whole: boolean
  /** The middle of its drawing, canvas x: which side of the body it is on. */
  middleX: number
  /** A leg: each vertex's share of the trunk's cylinder in place of its column (LEG_TOP). */
  trunk: Float32Array | null
  /** A shoe: how far out in front of its ankle each vertex is (its toe's reach at the bottom, none at the top), pixels. */
  reach: Float32Array | null
}

/**
 * Reads a limb's column off its drawing: in each row its middle and its
 * half-width, smoothed down its length (`art`: the layer's pixels over its
 * box; without them, its box). `ground`: for a leg, its hips and the ground
 * it stands on.
 */
export function bindFigureColumn(
  rest: Float32Array,
  box: Readonly<{ x: number; y: number; w: number; h: number }>,
  art: Readonly<{ width: number; height: number; pixels: Uint8ClampedArray }> | null,
  ground?: Readonly<{ hipY: number; groundY: number; hemY?: number }>,
  whole = false,
  shoe = false,
): FigureColumnBinding | null {
  const count = rest.length / 2
  const top = box.y
  const height = box.h
  if (count < 1 || !(height > 1) || !(box.w > 1)) return null
  const rows = ROWS
  const left = new Float64Array(rows).fill(Infinity)
  const right = new Float64Array(rows).fill(-Infinity)
  if (art && art.width > 0 && art.height > 0) {
    // The run of each pixel row that carries on its neighbour's (the widest, where none does): a strap or a
    // forearm folded back beside the limb is not part of its column. Taken with it, the gap between them was
    // the column's middle and both were squeezed across it; taken by width alone, two alike swapped row by row.
    const run = (py: number, keptFrom: number, keptTo: number): [number, number] => {
      let first = -1
      let last = -1
      let most = 0
      let from = -1
      for (let px = 0; px <= art.width; px += 1) {
        const drawn = px < art.width && art.pixels[(py * art.width + px) * 4 + 3] >= DRAWN_ALPHA
        if (drawn && from < 0) from = px
        if (!drawn && from >= 0) {
          // (Its overlap with the run kept counts before its width.)
          const shared = keptFrom < 0 ? 0 : Math.max(0, Math.min(px, keptTo) - Math.max(from, keptFrom))
          const worth = shared * art.width + (px - from)
          if (worth > most) { most = worth; first = from; last = px }
          from = -1
        }
      }
      return [first, last]
    }
    // Followed down from the first row the limb itself is in, and up from there: a strap drawn above its top
    // (thinner than START_WIDTH of its widest) and on down beside it would be followed in its place.
    let widest = 0
    const widths = new Float64Array(art.height)
    for (let py = 0; py < art.height; py += 1) {
      const [first, last] = run(py, -1, -1)
      widths[py] = last - first
      widest = Math.max(widest, widths[py])
    }
    let start = 0
    while (start < art.height - 1 && widths[start] < widest * START_WIDTH) start += 1
    const keep = (py: number, first: number, last: number) => {
      const row = Math.min(rows - 1, Math.floor((py / art.height) * rows))
      left[row] = Math.min(left[row], box.x + (first / art.width) * box.w)
      right[row] = Math.max(right[row], box.x + (last / art.width) * box.w)
    }
    for (const step of [1, -1]) {
      let keptFrom = -1
      let keptTo = -1
      for (let py = start; py >= 0 && py < art.height; py += step) {
        const [first, last] = run(py, keptFrom, keptTo)
        if (first < 0) continue
        keptFrom = first
        keptTo = last
        if (step > 0 || py !== start) keep(py, first, last)
      }
    }
  }
  // A row with nothing drawn in it takes its neighbours'; a layer that cannot be read, its box.
  for (let row = 1; row < rows; row += 1) {
    if (left[row] > right[row]) { left[row] = left[row - 1]; right[row] = right[row - 1] }
  }
  for (let row = rows - 2; row >= 0; row -= 1) {
    if (left[row] > right[row]) { left[row] = left[row + 1]; right[row] = right[row + 1] }
  }
  if (left[0] > right[0]) { left.fill(box.x); right.fill(box.x + box.w) }
  const middle = new Float64Array(rows)
  const half = new Float64Array(rows)
  for (let row = 0; row < rows; row += 1) {
    // (Over its neighbours, so a ribbon or a cuff standing out of one row does not kink the axis.)
    let l = 0
    let r = 0
    let n = 0
    for (let k = Math.max(0, row - 2); k <= Math.min(rows - 1, row + 2); k += 1) { l += left[k]; r += right[k]; n += 1 }
    middle[row] = (l + r) / (2 * n)
    half[row] = Math.max(1, (r - l) / (2 * n))
  }
  const axis = new Float32Array(count)
  const depth = new Float32Array(count)
  const round = new Float32Array(count)
  const reach = shoe ? new Float32Array(count) : null
  const trunk = ground && !shoe ? new Float32Array(count) : null
  let widest = 0
  for (let row = 0; row < rows; row += 1) widest = Math.max(widest, half[row])
  const span = ground ? Math.max(1, ground.groundY - ground.hipY) : 1
  // (Done a row of its mesh above the hem: the cells from that row to the next would carry it on below.)
  const own = !ground || ground.hemY === undefined
    ? LEG_TOP[1]
    : Math.max(LEG_TOP[2], Math.min(LEG_TOP[1], (ground.hemY - height / FIGURE_LEG_ROWS - ground.hipY) / span))
  for (let v = 0; v < count; v += 1) {
    const x = rest[v * 2]
    const y = rest[v * 2 + 1]
    // Between the rows' middles, so the axis runs smoothly down the limb.
    const at = Math.max(0, Math.min(rows - 1, ((y - top) / height) * rows - 0.5))
    const row = Math.min(rows - 2, Math.floor(at))
    const t = at - row
    const mid = middle[row] + (middle[row + 1] - middle[row]) * t
    const radius = half[row] + (half[row + 1] - half[row]) * t
    const across = Math.max(-1, Math.min(1, (x - mid) / radius))
    axis[v] = mid
    depth[v] = Math.sqrt(1 - across * across) ** EDGE_EASE * radius * LIMB_DEPTH
    round[v] = ground ? Math.max(0, Math.min(1, (ground.groundY - y) / span)) : 1
    if (reach) {
      const band = Math.min(height, widest * 2 * TOE_HEIGHT)
      const down = Math.max(0, Math.min(1, (y - (top + height - band)) / band))
      reach[v] = down * down * (3 - 2 * down) * widest * TOE_REACH
    }
    if (trunk && ground) {
      const below = Math.max(0, Math.min(1, ((y - ground.hipY) / span - LEG_TOP[0]) / (own - LEG_TOP[0])))
      trunk[v] = 1 - below * below * (3 - 2 * below)
    }
  }
  return { axis, depth, round, whole, middleX: box.x + box.w / 2, trunk, reach }
}

/**
 * How far the turn moves a vertex of a limb across, drawn at `restX`: its axis going round the body's, what is
 * drawn on it sliding across it, and the whole of it a little wider or narrower for being nearer or further.
 * (Its own width does not draw in as the trunk's does: a column is as wide from any side.)
 */
export function figureColumnOffsetX(
  restX: number,
  vertex: number,
  column: Readonly<FigureColumnBinding>,
  profile: Readonly<Anime25DTorsoShellProfile>,
  rotation: Readonly<Anime25DTorsoShellRotation>,
  blend: number,
): number {
  const axis = column.axis[vertex]
  const out = (axis - profile.centerX) * column.round[vertex]
  return anime25DTurnedOffsetX(out, column.depth[vertex] + (column.reach?.[vertex] ?? 0), profile, rotation, blend)
    + (restX - axis) * (anime25DTurnedScale(out, profile, rotation) - 1) * blend
}

interface LimbLayer { name: string; role: string; x: number; y: number; w: number; h: number; z?: number }

/** A leg is under the trunk's garments down to the first row of it that less than this share of is covered. */
const HEM_COVER = 0.85
/** Two legs are joined where the gap between them is no more than this share of one's width. */
const JOINED = 0.03
/**
 * A trouser leg's drawing is the seat's own where the seat is over it: pixel for pixel no further from it than
 * the first, of 255, over at least the second share of what is covered of the leg's top rows (the third: a
 * shirt's hem hanging lower than the seat is not the seat). Not by how alike they are on the whole: a black
 * skirt over black tights is as alike, and is a skirt.
 */
const SAME_DRAWING = [4, 0.7, 3] as const

/**
 * The hem a leg comes out from under, canvas y: down to it the garments of the trunk drawn in front of the leg
 * (a skirt, shorts, a coat's tails, a long top) cover it. Read down the leg's own drawing row by row, so a hem
 * cut on a slant, slit or scalloped is found where it is on this leg. None for a leg whose top shows, and none
 * for a leg whose top shows. 'seat' for a trouser leg under its seat: the seat was cut out of the leg's
 * drawing, the same pixels, and the leg's outline runs on out of the seat's. `joined`: just below that hem the
 * leg is not clear of the other one (thighs together; or trousers, still their seat there).
 */
export function legHem(
  leg: Readonly<LimbLayer>,
  layers: readonly Readonly<LimbLayer>[],
  art: (layer: Readonly<LimbLayer>) => Parameters<typeof bindFigureColumn>[2],
): { y: number; joined: boolean } | 'seat' | undefined {
  const own = art(leg)
  if (!own || !(own.width > 0 && own.height > 0) || !(leg.w > 1 && leg.h > 1)) return undefined
  const order = (layer: Readonly<LimbLayer>) => layer.z ?? layers.findIndex((other) => other.name === layer.name)
  const over = layers
    .filter((layer) => (layer.role === 'bottomwear' || layer.role === 'topwear') && !isAnime25DLiningPiece(layer.name)
      && layer.w > 1 && layer.h > 1 && order(layer) > order(leg))
    .map((layer) => ({ layer, pixels: art(layer) }))
    .filter((entry) => entry.pixels && entry.pixels.width > 0 && entry.pixels.height > 0)
  if (!over.length) return undefined
  let hemRow = -1
  let same = 0
  let covered = 0
  let rowsRead = 0
  for (let row = 0; row < ROWS; row += 1) {
    const py = Math.min(own.height - 1, Math.floor(((row + 0.5) / ROWS) * own.height))
    const y = leg.y + ((py + 0.5) / own.height) * leg.h
    let drawn = 0
    let under = 0
    let alike = 0
    for (let px = 0; px < own.width; px += 1) {
      const at = (py * own.width + px) * 4
      if (own.pixels[at + 3] < DRAWN_ALPHA) continue
      drawn += 1
      const x = leg.x + ((px + 0.5) / own.width) * leg.w
      // (Whichever of them is nearest the leg's own pixel there: a seat is the leg's drawing under a shirt's hem too.)
      let differs = Infinity
      for (const { layer, pixels } of over) {
        const qx = Math.floor(((x - layer.x) / layer.w) * pixels!.width)
        const qy = Math.floor(((y - layer.y) / layer.h) * pixels!.height)
        if (qx < 0 || qy < 0 || qx >= pixels!.width || qy >= pixels!.height) continue
        const q = (qy * pixels!.width + qx) * 4
        const cloth = pixels!.pixels
        if (cloth[q + 3] < DRAWN_ALPHA) continue
        differs = Math.min(differs, Math.max(Math.abs(cloth[q] - own.pixels[at]), Math.abs(cloth[q + 1] - own.pixels[at + 1]), Math.abs(cloth[q + 2] - own.pixels[at + 2])))
      }
      if (differs === Infinity) continue
      under += 1
      if (differs <= SAME_DRAWING[0]) alike += 1
    }
    if (drawn === 0) continue
    if (under < drawn * HEM_COVER) break
    hemRow = row
    if (rowsRead < SAME_DRAWING[2]) {
      rowsRead += 1
      covered += under
      same += alike
    }
  }
  if (hemRow < 0) return undefined
  if (same >= covered * SAME_DRAWING[1]) return 'seat'
  // Whether what shows below the hem stands clear of the other leg there.
  const extent = (layer: Readonly<LimbLayer>, pixels: NonNullable<ReturnType<typeof art>>, y: number): [number, number] | null => {
    const py = Math.floor(((y - layer.y) / layer.h) * pixels.height)
    if (py < 0 || py >= pixels.height) return null
    let first = -1
    let last = -1
    for (let px = 0; px < pixels.width; px += 1) {
      if (pixels.pixels[(py * pixels.width + px) * 4 + 3] < DRAWN_ALPHA) continue
      if (first < 0) first = px
      last = px + 1
    }
    return first < 0 ? null : [layer.x + (first / pixels.width) * layer.w, layer.x + (last / pixels.width) * layer.w]
  }
  const others = layers
    .filter((layer) => layer.role === 'legwear' && layer.name !== leg.name && !isAnime25DLiningPiece(layer.name) && layer.w > 1 && layer.h > 1)
    .map((layer) => ({ layer, pixels: art(layer) }))
  let joined = false
  for (let row = hemRow + 1; row <= Math.min(ROWS - 1, hemRow + 2); row += 1) {
    const y = leg.y + ((row + 0.5) / ROWS) * leg.h
    const mine = extent(leg, own, y)
    if (!mine) continue
    for (const { layer, pixels } of others) {
      const its = pixels && pixels.width > 0 && pixels.height > 0 ? extent(layer, pixels, y) : null
      if (its && Math.max(its[0] - mine[1], mine[0] - its[1]) <= (mine[1] - mine[0]) * JOINED) joined = true
    }
  }
  return { y: leg.y + ((hemRow + 1) / ROWS) * leg.h, joined }
}

/**
 * The hem a leg hands its top over by (legHem), settled for the pair of legs as one: trouser legs hand over
 * slowly, both of them, or the seam between them is sheared where one does and the other does not. Trousers
 * are legs any of which is under its own seat, or joined to the other where it comes out from under a hem too
 * high for the handing over to be done under it (trousers under a top, still their seat there). Thighs
 * together under a skirt long enough are thighs.
 */
function pairHem(
  leg: Readonly<LimbLayer>,
  layers: readonly Readonly<LimbLayer>[],
  art: (layer: Readonly<LimbLayer>) => Parameters<typeof bindFigureColumn>[2],
  ground: Readonly<{ hipY: number; groundY: number }>,
): number | undefined {
  const own = legHem(leg, layers, art)
  if (!own || own === 'seat') return undefined
  const span = Math.max(1, ground.groundY - ground.hipY)
  const trousers = (hem: ReturnType<typeof legHem>, of: Readonly<LimbLayer>) =>
    hem === 'seat' || (hem !== undefined && hem.joined && (hem.y - of.h / FIGURE_LEG_ROWS - ground.hipY) / span < LEG_TOP[2])
  if (trousers(own, leg)) return undefined
  for (const other of layers) {
    if (other.role !== 'legwear' || other.name === leg.name || isAnime25DLiningPiece(other.name) || !(other.w > 1 && other.h > 1)) continue
    if (trousers(legHem(other, layers, art), other)) return undefined
  }
  return own.y
}

/** The roles of a standing figure's layers that are limbs. */
const LIMB_ROLES = new Set(['legwear', 'footwear', 'handwear'])

/**
 * A standing figure's layer as a limb's column, for the vertices in `rest` (its own mesh, or an anchor on it
 * for what rides it); null for what is not a limb. `baseRole`: its role with underscores.
 */
export function bindLimbColumn(
  rest: Float32Array,
  source: Readonly<LimbLayer>,
  layers: readonly Readonly<LimbLayer>[],
  /** Reads a layer's pixels (this one's with no argument): asked for a limb only. */
  art: (layer?: Readonly<LimbLayer>) => Parameters<typeof bindFigureColumn>[2],
  ground: Readonly<{ hipY: number; groundY: number }> | undefined,
): FigureColumnBinding | null {
  if (!LIMB_ROLES.has(source.role)) return null
  const arm = source.role === 'handwear'
  const hemY = source.role === 'legwear' && ground ? pairHem(source, layers, art, ground) : undefined
  return bindFigureColumn(rest, source, art(), arm ? undefined : ground && { ...ground, hemY }, arm && drawnBehind(layers, source, 'topwear'), source.role === 'footwear')
}

/**
 * Whether a layer is drawn behind every layer of `role` (none: not). Not counting a garment's lining pieces,
 * which are put behind everything and say nothing of where the garment itself is drawn.
 */
export function drawnBehind(
  layers: readonly Readonly<{ name: string; role: string; z?: number }>[],
  source: Readonly<{ name: string; z?: number }>,
  role: string,
): boolean {
  const order = (layer: Readonly<{ name: string; z?: number }>) => layer.z ?? layers.findIndex((other) => other.name === layer.name)
  const over = layers.filter((layer) => layer.role === role && !isAnime25DLiningPiece(layer.name))
  return over.length > 0 && over.every((layer) => order(layer) > order(source))
}
