import type { ArmVariantGesture } from '../rig/armVariants'
import type { Anime25DDriver } from './driver'
import type { Anime25DGpuLayer } from './layerGpuBinding'
import type { Anime25DArmLift } from './types'

export type Anime25DArmSide = 'L' | 'R'

/** The driver that raises each gesture arm (directed by the `leftHandWave`… body controls). */
export const ARM_VARIANT_DRIVERS = {
  L: { wave: 'handWaveL', point: 'handPointL', chest: 'handChestL', chin: 'handChinL' },
  R: { wave: 'handWaveR', point: 'handPointR', chest: 'handChestR', chin: 'handChinR' },
} as const satisfies Record<Anime25DArmSide, Record<ArmVariantGesture, keyof Anime25DDriver>>
/** A gesture's driver past this raises it; the strongest one on a side wins. */
const RAISED_AT = 0.5

/**
 * Raises a drawn gesture arm (an `arm-variant` layer) in from below the
 * picture over the portrait's own arm, and puts it back down the same way
 * played backwards. Settled on the real player (2026-11-03, 26 variants):
 *
 * - rising, RISE_SECONDS: the gesture arm is opaque from the first frame and
 *   eases up out of RISE_SHARE of the drop from its top to the canvas floor;
 *   the portrait's arm stays under it until halfway, then fades out by the
 *   end (gone sooner, a white gap shows for two or three frames);
 * - lowering is exactly that backwards: the portrait's arm is back by
 *   halfway, the gesture arm sinks slow then fast and is gone at the floor
 *   (faded on the way down, it dissolves for about three frames);
 * - an arm across the body (`shoulder` lift) stays on its shoulder and lifts
 *   most at the hand, or it shows a second shoulder as it comes up; a hand
 *   raised clear of the body moves whole (weighted, it is squashed).
 *
 * One gesture per side at a time: another one waits for this one to go down.
 */
export const ARM_VARIANT_RISE_SECONDS = 0.3
const RISE_SHARE = 0.35
/** A `shoulder` lift reaches its full shift this share of the arm's length from the shoulder. */
const SHOULDER_REACH = 0.6
/** The shoulder: the top of the portrait's arm, over the rows this close to it. */
const SHOULDER_ROWS = 20

interface BoundVariant {
  layer: Anime25DGpuLayer
  gesture: string
  rise: number
  /** Per-vertex share of the shift (`shoulder` lift); null moves the layer whole. */
  weights: Float32Array | null
}

interface SideState {
  bases: Anime25DGpuLayer[]
  variants: BoundVariant[]
  shown: BoundVariant | null
  phase: 'rising' | 'held' | 'lowering' | null
  since: number
  wanted: string | null
  /** The shift last written into the shown layer's vertices. */
  written: number
}

export class Anime25DArmVariants {
  private sides: Record<Anime25DArmSide, SideState> = { L: emptySide(), R: emptySide() }

  /** Takes the new layers' gesture arms and their portrait arms; drops whatever was raised. */
  bind(layers: readonly Anime25DGpuLayer[], canvasHeight: number): void {
    for (const side of ['L', 'R'] as const) {
      const bases = layers.filter((layer) => layer.source.role === 'handwear' && layer.source.side === side)
      const variants = layers.flatMap((layer) => {
        const variant = layer.source.armVariant
        if (layer.source.role !== 'arm-variant' || !variant || layer.source.side !== side) return []
        if (layer.deformed === layer.rest) layer.deformed = layer.rest.slice()
        return [{
          layer,
          gesture: variant.gesture,
          rise: RISE_SHARE * Math.max(0, canvasHeight - minY(layer.rest)),
          weights: liftWeights(variant.lift, layer.rest, bases),
        }]
      })
      this.sides[side] = { ...emptySide(), bases, variants }
    }
  }

  /** The gestures each side has. */
  gestures(): Record<Anime25DArmSide, string[]> {
    return {
      L: this.sides.L.variants.map((variant) => variant.gesture),
      R: this.sides.R.variants.map((variant) => variant.gesture),
    }
  }

  /** What each side shows or is raising now; null while down or going down. */
  raised(): Record<Anime25DArmSide, string | null> {
    const shown = (side: SideState) => side.phase === 'rising' || side.phase === 'held' ? side.shown?.gesture ?? null : null
    return { L: shown(this.sides.L), R: shown(this.sides.R) }
  }

  /** Raises on each side the gesture whose driver is strongest past RAISED_AT, or puts it down. */
  follow(driver: Readonly<Anime25DDriver>): void {
    for (const side of ['L', 'R'] as const) {
      let best: string | null = null
      let strongest = RAISED_AT
      for (const variant of this.sides[side].variants) {
        const key = (ARM_VARIANT_DRIVERS[side] as Record<string, keyof Anime25DDriver>)[variant.gesture]
        const value = key ? Number(driver[key]) : 0
        if (value >= strongest) {
          strongest = value
          best = variant.gesture
        }
      }
      this.request(side, best)
    }
  }

  /** Raise `gesture` on `side`, or put that side down with null. Unknown gestures put it down. */
  request(side: Anime25DArmSide, gesture: string | null): void {
    const state = this.sides[side]
    state.wanted = gesture && state.variants.some((variant) => variant.gesture === gesture) ? gesture : null
  }

  /**
   * Steps each side to `time` and writes this frame's opacity: the gesture
   * arm shown, the others hidden, the portrait's arm faded under it. Runs
   * after the face frame has written every layer's own opacity.
   */
  applyOpacity(time: number): void {
    for (const side of ['L', 'R'] as const) {
      const state = this.sides[side]
      if (state.variants.length === 0) continue
      step(state, time)
      const x = progress(state, time)
      for (const variant of state.variants) {
        variant.layer.frameOpacity = variant === state.shown && state.phase ? 1 : 0
      }
      const base = state.phase === 'rising'
        ? x < 0.5 ? 1 : Math.max(0, 1 - (x - 0.5) / 0.5)
        : state.phase === 'held'
          ? 0
          : state.phase === 'lowering'
            ? Math.min(1, x / 0.5)
            : 1
      if (base < 1) { for (const layer of state.bases) layer.frameOpacity *= base
}
    }
  }

  /**
   * Moves the shown gesture arm's vertices by this frame's shift. Runs once
   * the layers are deformed; the layer itself only rides its host.
   */
  applyLift(time: number): void {
    for (const side of ['L', 'R'] as const) {
      const state = this.sides[side]
      const variant = state.shown
      if (!variant || !state.phase) continue
      const x = progress(state, time)
      const shift = state.phase === 'rising'
        ? (1 - easeOutCubic(x)) * variant.rise
        : state.phase === 'lowering'
          ? x * x * x * variant.rise
          : 0
      if (shift === state.written) continue
      writeShift(variant, shift)
      state.written = shift
    }
  }
}

function emptySide(): SideState {
  return { bases: [], variants: [], shown: null, phase: null, since: 0, wanted: null, written: 0 }
}

function step(state: SideState, time: number): void {
  const x = progress(state, time)
  if (state.phase === 'rising' && x >= 1) state.phase = 'held'
  if (state.phase === 'lowering' && x >= 1) {
    // Back to rest, hidden, for the next time it comes up.
    if (state.shown && state.written !== 0) writeShift(state.shown, 0)
    state.phase = null
    state.shown = null
    state.written = 0
  }
  const wanted = state.wanted
  if ((state.phase === 'rising' || state.phase === 'held') && state.shown?.gesture !== wanted) {
    // Down from wherever it is now, so the arm never jumps.
    const at = state.phase === 'rising' ? 1 - easeOutCubic(x) : 0
    state.phase = 'lowering'
    state.since = time - Math.cbrt(at) * ARM_VARIANT_RISE_SECONDS
  }
  if (state.phase === null && wanted) {
    state.shown = state.variants.find((variant) => variant.gesture === wanted) ?? null
    if (state.shown) {
      state.phase = 'rising'
      state.since = time
    }
  }
}

function progress(state: SideState, time: number): number {
  return Math.max(0, Math.min(1, (time - state.since) / ARM_VARIANT_RISE_SECONDS))
}

function writeShift(variant: BoundVariant, shift: number): void {
  const { rest, deformed } = variant.layer
  const weights = variant.weights
  for (let i = 0; i < rest.length; i += 2) {
    deformed[i] = rest[i]
    deformed[i + 1] = Math.fround(rest[i + 1] + shift * (weights ? weights[i >> 1] : 1))
  }
  variant.layer.geometryDirty = true
}

function easeOutCubic(x: number): number {
  return 1 - (1 - x) ** 3
}

function minY(rest: Float32Array): number {
  let y = Number.POSITIVE_INFINITY
  for (let i = 1; i < rest.length; i += 2) y = Math.min(y, rest[i])
  return Number.isFinite(y) ? y : 0
}

/**
 * The share of the shift each vertex takes for a `shoulder` lift: none at
 * the shoulder, all of it SHOULDER_REACH of the arm's length away. The
 * shoulder is the top of the portrait's arm; without one, the top of this one.
 */
function liftWeights(
  lift: Anime25DArmLift,
  rest: Float32Array,
  bases: readonly Anime25DGpuLayer[],
): Float32Array | null {
  if (lift !== 'shoulder') return null
  const arm = bases.map((layer) => layer.rest).find((points) => points.length >= 6 && extent(points) > 8) ?? rest
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (let i = 1; i < arm.length; i += 2) {
    top = Math.min(top, arm[i])
    bottom = Math.max(bottom, arm[i])
  }
  let sumX = 0
  let count = 0
  for (let i = 0; i < arm.length; i += 2) {
    if (arm[i + 1] < top + SHOULDER_ROWS) {
      sumX += arm[i]
      count += 1
    }
  }
  const shoulderX = count > 0 ? sumX / count : 0
  const reach = Math.max(1, SHOULDER_REACH * (bottom - top))
  const weights = new Float32Array(rest.length / 2)
  for (let i = 0; i < weights.length; i += 1) {
    const x = Math.min(1, Math.hypot(rest[i * 2] - shoulderX, rest[i * 2 + 1] - top) / reach)
    weights[i] = x * x * (3 - 2 * x)
  }
  return weights
}

function extent(points: Float32Array): number {
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (let i = 1; i < points.length; i += 2) {
    top = Math.min(top, points[i])
    bottom = Math.max(bottom, points[i])
  }
  return bottom - top
}
