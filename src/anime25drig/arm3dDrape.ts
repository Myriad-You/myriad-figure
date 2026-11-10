import { smoothstep } from './arm3dMath'

/**
 * A garment's layer where it lies over a figure's hanging upper arm and outward of it (a cape off the shoulder,
 * a pauldron): those of its vertices, how far each goes with the arm, and how far down the cloth each is.
 */
export interface Arm3DDrape {
  idx: Uint32Array
  /** How far the vertex goes with the upper arm (1 on the arm and outward of it, 0 on the body). */
  weight: Float32Array
  /** How far it hangs free of the shoulder (0 at it, 1 at the hem): the hem follows late and swings on. */
  free: Float32Array
}

/**
 * What of a layer's mesh (`rest`, x y pairs on the canvas) rides the upper arm hanging from `s` to `e`, `radius`
 * thick, on the picture's side `side` (-1 its left, 1 its right); null where none of it does.
 */
export function arm3DDrapeOf(rest: Float32Array, s: readonly number[], e: readonly number[], radius: number, side: number): Arm3DDrape | null {
  const length = Math.hypot(e[0] - s[0], e[1] - s[1])
  if (length < 1e-6) return null
  const ax = (e[0] - s[0]) / length
  const ay = (e[1] - s[1]) / length
  // Across the arm, away from the body.
  const flip = -ay * side < 0 ? -1 : 1
  const nx = -ay * flip
  const ny = ax * flip
  const idx: number[] = []
  const weight: number[] = []
  const free: number[] = []
  for (let i = 0; i < rest.length / 2; i += 1) {
    const x = rest[i * 2] - s[0]
    const y = rest[i * 2 + 1] - s[1]
    const along = (x * ax + y * ay) / length
    const out = x * nx + y * ny
    // From the arm's inner edge outward; from a little over the shoulder down to past the elbow (lower, a coat's
    // skirt beside the hand is the body's).
    const w = smoothstep(-1.2 * radius, 0.1 * radius, out) * smoothstep(-0.6, -0.25, along) * (1 - smoothstep(1.3, 1.7, along))
    if (w <= 1e-4) continue
    idx.push(i)
    weight.push(w)
    free.push(smoothstep(0.35, 1.1, Math.hypot(x, y) / length))
  }
  return idx.length ? { idx: Uint32Array.from(idx), weight: Float32Array.from(weight), free: Float32Array.from(free) } : null
}

/** The most the cloth turns with the arm (radians): past it the arm goes on under cloth that hangs. */
const MOST = 1.1
const OMEGA = 2 * Math.PI * 1.4
const ZETA = 0.38

/** The turn the cloth is given as the upper arm turns in the picture: with it near the shoulder, sprung after it at the hem. */
export class Arm3DDrapeTurn {
  /** The arm's turn the cloth takes, and the hem's own. */
  with = 0
  hem = 0
  private v = 0
  private last = 0

  /** `du`, the upper arm now, and `hung`, hanging (their directions in the picture), `dt` on. */
  step(du: readonly number[], hung: readonly number[], dt: number): void {
    const seen = Math.hypot(du[0], du[1])
    let turn = this.last
    if (seen > 1e-3 && Math.hypot(hung[0], hung[1]) > 1e-3) {
      turn = Math.atan2(du[1], du[0]) - Math.atan2(hung[1], hung[0])
      turn += 2 * Math.PI * Math.round((this.last - turn) / (2 * Math.PI))
    }
    this.last = turn
    // An arm pointed at the viewer has no turn in the picture to give.
    this.with = MOST * Math.tanh(turn / MOST) * smoothstep(0.15, 0.5, seen)
    const n = 4
    const h = Math.min(1 / 30, dt) / n
    for (let i = 0; i < n; i += 1) {
      this.v += (OMEGA * OMEGA * (this.with - this.hem) - 2 * ZETA * OMEGA * this.v) * h
      this.hem += this.v * h
    }
  }

  get still(): boolean {
    return Math.abs(this.with) < 1e-5 && Math.abs(this.hem) < 1e-5 && Math.abs(this.v) < 1e-4
  }
}

/** One layer's cloth on the arm, and what was last written of it. */
export interface Arm3DDraped {
  drape: Arm3DDrape
  /** The layer's own vertices this frame, before the cloth is turned. */
  base: Float32Array
  written: Float32Array
  on: boolean
}

export function arm3DDraped(drape: Arm3DDrape): Arm3DDraped {
  return { drape, base: new Float32Array(drape.idx.length * 2), written: new Float32Array(drape.idx.length * 2).fill(NaN), on: false }
}

/**
 * Turns the cloth about the shoulder `s` in `deformed` (the layer's vertices, deformed this frame or left as
 * last written). True where it wrote.
 */
export function turnArm3DDrape(it: Arm3DDraped, deformed: Float32Array, s: readonly number[], turn: Arm3DDrapeTurn): boolean {
  const { idx, weight, free } = it.drape
  // Deformed anew this frame, the vertices are no longer what was written: they are the layer's own again.
  let fresh = false
  for (let k = 0; k < idx.length && !fresh; k += 1) {
    fresh = deformed[idx[k] * 2] !== it.written[k * 2] || deformed[idx[k] * 2 + 1] !== it.written[k * 2 + 1]
  }
  if (fresh) {
    for (let k = 0; k < idx.length; k += 1) {
      it.base[k * 2] = deformed[idx[k] * 2]
      it.base[k * 2 + 1] = deformed[idx[k] * 2 + 1]
    }
  }
  if (turn.still && !it.on) return false
  it.on = !turn.still
  for (let k = 0; k < idx.length; k += 1) {
    const a = it.on ? weight[k] * (turn.with + (turn.hem - turn.with) * free[k]) : 0
    const x = it.base[k * 2] - s[0]
    const y = it.base[k * 2 + 1] - s[1]
    const c = Math.cos(a)
    const sn = Math.sin(a)
    it.written[k * 2] = deformed[idx[k] * 2] = Math.fround(s[0] + x * c - y * sn)
    it.written[k * 2 + 1] = deformed[idx[k] * 2 + 1] = Math.fround(s[1] + x * sn + y * c)
  }
  return true
}
