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
/** A skirt covers a leg if, this share of the way down it, it is drawn across the middle half of the leg. */
const SKIRT_ROW = 0.9
/** Its width is read in this many rows down its drawing. */
const ROWS = 48
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
    // The run of each pixel row that carries on the one above (the widest, where none does): a strap or a
    // forearm folded back beside the limb is not part of its column. Taken with it, the gap between them was
    // the column's middle and both were squeezed across it; taken by width alone, two alike swapped row by row.
    let keptFrom = -1
    let keptTo = -1
    for (let py = 0; py < art.height; py += 1) {
      let first = -1
      let last = -1
      let most = 0
      let from = -1
      for (let px = 0; px <= art.width; px += 1) {
        const drawn = px < art.width && art.pixels[(py * art.width + px) * 4 + 3] >= DRAWN_ALPHA
        if (drawn && from < 0) from = px
        if (!drawn && from >= 0) {
          // (Its overlap with the run kept above counts before its width.)
          const shared = keptFrom < 0 ? 0 : Math.max(0, Math.min(px, keptTo) - Math.max(from, keptFrom))
          const worth = shared * art.width + (px - from)
          if (worth > most) { most = worth; first = from; last = px }
          from = -1
        }
      }
      if (first < 0) continue
      keptFrom = first
      keptTo = last
      const row = Math.min(rows - 1, Math.floor((py / art.height) * rows))
      left[row] = Math.min(left[row], box.x + (first / art.width) * box.w)
      right[row] = Math.max(right[row], box.x + (last / art.width) * box.w)
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
      const own = ground.hemY === undefined ? LEG_TOP[1] : Math.max(LEG_TOP[2], Math.min(LEG_TOP[1], (ground.hemY - ground.hipY) / span))
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

/**
 * The hem of the skirt over a leg, canvas y; none where the leg's sides show from the hips down (trousers,
 * whose seat comes to a point between the legs; nothing worn on the hips). The lowest lower garment that is
 * drawn across the middle half of the leg near its own foot (SKIRT_ROW).
 */
function skirtHem(
  leg: Readonly<LimbLayer>,
  layers: readonly Readonly<LimbLayer>[],
  art: (layer: Readonly<LimbLayer>) => Parameters<typeof bindFigureColumn>[2],
): number | undefined {
  let hem: number | undefined
  for (const layer of layers) {
    if (layer.role !== 'bottomwear' || isAnime25DLiningPiece(layer.name) || !(layer.w > 1 && layer.h > 1)) continue
    const pixels = art(layer)
    if (!pixels || !(pixels.width > 0 && pixels.height > 0)) continue
    const py = Math.min(pixels.height - 1, Math.floor(pixels.height * SKIRT_ROW))
    const from = Math.floor(((leg.x + leg.w * 0.25 - layer.x) / layer.w) * pixels.width)
    const to = Math.ceil(((leg.x + leg.w * 0.75 - layer.x) / layer.w) * pixels.width)
    if (from < 0 || to > pixels.width || to <= from) continue
    let drawn = 0
    for (let px = from; px < to; px += 1) { if (pixels.pixels[(py * pixels.width + px) * 4 + 3] >= DRAWN_ALPHA) drawn += 1
}
    if (drawn < (to - from) * 0.9) continue
    hem = Math.max(hem ?? -Infinity, layer.y + layer.h)
  }
  return hem
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
  const hemY = source.role === 'legwear' && ground ? skirtHem(source, layers, art) : undefined
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
