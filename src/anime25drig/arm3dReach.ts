import type { V3 } from './arm3dMath'
import { add, carry, cross, dot, len, mul, norm, smoothstep, spin, sub } from './arm3dMath'
import { blendHands } from './arm3dMotion'

/**
 * Where a hand is wanted, from its shoulder, in arm lengths (1 the arm straight): `out` away from the body,
 * `up`, `forward` toward the viewer. `swivel` turns the elbow about the line from shoulder to hand (radians; 0
 * where an arm's elbow falls of itself, down and a little out and back). `hand` names the gesture whose drawn
 * hand it wears; unnamed, the one drawn nearest where the aim began.
 */
export interface Anime25DArmAim {
  out: number
  up: number
  forward: number
  swivel?: number
  hand?: string
}

/** An arm without its shoulder: its bones' directions and lengths, its hand from the wrist. */
export interface Arm3DStance {
  du: V3
  df: V3
  upper: number
  fore: number
  hand: V3[]
  /** How much a figure's hand still is the portrait's drawn one. */
  handRest: number
  hanging: number
}

/** Where an elbow falls of itself, seen from the shoulder: down, a little out, a little back. */
const POLE: V3 = [0.35, 1, -0.5]

/** Across the line to the hand `t`: toward where the elbow falls, and square to that. */
function poleFrame(t: V3, side: number): [V3, V3] {
  const down: V3 = [POLE[0] * side, POLE[1], POLE[2]]
  let p = sub(down, mul(t, dot(down, t)))
  if (len(p) < 1e-4) p = sub([side, 0, 0], mul(t, t[0] * side))
  p = norm(p)
  return [p, cross(t, p)]
}

/** The two bones that put the hand where `aim` wants it (as near as the arm reaches), on the side `side` (1 the picture's right, -1 its left). */
export function arm3DAimBones(aim: Anime25DArmAim, side: number, upper: number, fore: number): { du: V3; df: V3 } {
  const reach = upper + fore
  const t: V3 = [aim.out * side * reach, -aim.up * reach, aim.forward * reach]
  const far = len(t)
  const c = Math.min(reach, Math.max(Math.abs(upper - fore) + reach * 1e-3, far))
  const dir: V3 = far < 1e-6 ? [0, 1, 0] : mul(t, 1 / far)
  const [p, q] = poleFrame(dir, side)
  const sw = aim.swivel ?? 0
  const n = add(mul(p, Math.cos(sw)), mul(q, Math.sin(sw)))
  const cosA = Math.max(-1, Math.min(1, (upper * upper + c * c - fore * fore) / (2 * upper * c)))
  const sinA = Math.sqrt(1 - cosA * cosA)
  const e = add(mul(dir, upper * cosA), mul(n, upper * sinA))
  return { du: norm(e), df: norm(sub(mul(dir, c), e)) }
}

/** The aim that two bones make: `arm3DAimBones` of it gives them back. */
export function arm3DAimOf(du: V3, df: V3, side: number, upper: number, fore: number): Required<Omit<Anime25DArmAim, 'hand'>> {
  const reach = upper + fore
  const e = mul(du, upper)
  const w = add(e, mul(df, fore))
  const far = len(w)
  const dir: V3 = far < 1e-6 ? [0, 1, 0] : mul(w, 1 / far)
  const [p, q] = poleFrame(dir, side)
  const n = sub(e, mul(dir, dot(e, dir)))
  return { out: w[0] * side / reach, up: -w[1] / reach, forward: w[2] / reach, swivel: len(n) < 1e-6 ? 0 : Math.atan2(dot(n, q), dot(n, p)) }
}

/** How far off the viewer stands, in arm lengths: a hand reached toward them grows as if seen from there. */
const VIEWER = 3.5

/**
 * A drawn hand (from its wrist, as its gesture holds it, forearm along `drawn`) on a forearm along `df`: turned
 * in the picture's plane as the forearm is seen to turn (a flat drawing, it has no other side to show; pointed
 * at the viewer it stays as drawn), and larger the nearer it comes (`depth`, arm lengths toward the viewer from
 * where it was drawn). `turned` is the turn it had last, so one past half a turn goes on round.
 */
export function arm3DAimHand(hand: readonly V3[], drawn: V3, df: V3, depth: number, turned: number): { hand: V3[]; turned: number } {
  const seen = Math.hypot(df[0], df[1])
  let turn = turned
  if (seen > 1e-3 && Math.hypot(drawn[0], drawn[1]) > 1e-3) {
    turn = Math.atan2(df[1], df[0]) - Math.atan2(drawn[1], drawn[0])
    turn += 2 * Math.PI * Math.round((turned - turn) / (2 * Math.PI))
  }
  const by = turn * smoothstep(0.2, 0.55, seen)
  const size = Math.min(1.6, Math.max(0.75, VIEWER / (VIEWER - depth)))
  return { hand: hand.map((q) => mul(spin(q, by), size)), turned: turn }
}

/**
 * A modelled hand (from its wrist, as its gesture holds it, forearm along `drawn`) on a forearm along `df`:
 * turned with the forearm as a hand on an arm is, by way of toward the viewer (straight over, a forearm turned
 * right round had no one way to take its hand), and larger the nearer it comes.
 */
export function arm3DCarryHand(hand: readonly V3[], drawn: V3, df: V3, depth: number): V3[] {
  const mid = norm(add(add(drawn, df), [0, 0, 0.6]))
  const size = Math.min(1.6, Math.max(0.75, VIEWER / (VIEWER - depth)))
  return hand.map((q) => mul(carry(carry(q, drawn, mid), mid, df), size))
}

function rotate(v: V3, r: V3): V3 {
  const a = len(r)
  if (a < 1e-12) return v
  const k = mul(r, 1 / a)
  const c = Math.cos(a)
  return add(add(mul(v, c), mul(cross(k, v), Math.sin(a))), mul(k, dot(k, v) * (1 - c)))
}

/**
 * The turn (its axis, as long as its angle) that takes direction a to b: the least, but for near half a turn
 * the way round that passes toward the viewer (an arm goes from raised to hanging in front of the body, not
 * through it).
 */
function turnBetween(a: V3, b: V3): V3 {
  const ax = cross(a, b)
  const sn = len(ax)
  const co = dot(a, b)
  if (sn < 1e-6) {
    if (co > 0) return [0, 0, 0]
    const k = cross(a, [0, 0, 1])
    return mul(len(k) < 1e-6 ? [1, 0, 0] : norm(k), Math.PI)
  }
  const k = mul(ax, 1 / sn)
  const angle = Math.atan2(sn, co)
  if (angle > 2.2 && rotate(a, mul(k, angle / 2))[2] < 0) return mul(k, angle - 2 * Math.PI)
  return mul(k, angle)
}

/** How far a half turn swings out toward the viewer on its way (a share of the bone). */
const FORWARD = 0.9
/** A turn is over within this (radians, and per second). */
const STILL = 2e-4
/** The fastest a bone is taken to be turning as it is caught (radians a second). */
const FASTEST = 14

/** One bone's turn off where it is wanted, dying away like a sprung weight. */
class Turn {
  r: V3 = [0, 0, 0]
  v: V3 = [0, 0, 0]
  private from = 0
  private lift = 0

  constructor(private omega: number, private zeta: number) {}

  set(wanted: V3, now: V3, turning: V3): void {
    this.r = turnBetween(wanted, now)
    const speed = len(turning)
    this.v = speed > FASTEST ? mul(turning, FASTEST / speed) : turning
    this.from = len(this.r)
    this.lift = FORWARD * ((1 - Math.cos(Math.min(Math.PI, this.from))) / 2) ** 2
  }

  step(dt: number): void {
    const n = 4
    const h = dt / n
    for (let i = 0; i < n; i += 1) {
      this.v = add(this.v, mul(add(mul(this.r, -(this.omega ** 2)), mul(this.v, -2 * this.zeta * this.omega)), h))
      this.r = add(this.r, mul(this.v, h))
    }
  }

  on(wanted: V3): V3 {
    const a = len(this.r)
    if (a < 1e-12) return wanted
    const d = rotate(wanted, this.r)
    if (this.lift < 1e-4) return d
    const s = Math.sin(Math.PI * Math.min(1, a / this.from))
    return norm(add(d, [0, 0, this.lift * s * s]))
  }

  /** How much of the turn is left (1 as set). */
  get left(): number {
    return this.from < 0.02 ? 0 : Math.min(1, len(this.r) / this.from)
  }

  get still(): boolean {
    return len(this.r) < STILL && len(this.v) < STILL * 10
  }

  clear(): void {
    this.r = [0, 0, 0]
    this.v = [0, 0, 0]
    this.from = 0
    this.lift = 0
  }
}

/** The least a change takes (seconds): one of the hand alone, the arm where it was. */
const LEAST = 0.15

/**
 * Takes the arm from wherever it is to wherever it is next wanted, with no stop between: what it is asked to
 * be changes at once (another gesture held, an aim, hanging), and how far it stood off that dies away, each bone
 * a sprung weight (the upper arm first, the forearm after it and a little past), the hand turning from the one
 * into the other meanwhile. Arrived, it is out of the way: the arm is exactly what is wanted.
 */
export class Arm3DTransit {
  private upper = new Turn(2 * Math.PI * 1.35, 0.85)
  private fore = new Turn(2 * Math.PI * 1.1, 0.68)
  private from: Arm3DStance | null = null
  private since = 0
  private now: Arm3DStance | null = null
  private turning: { u: V3; f: V3 } = { u: [0, 0, 0], f: [0, 0, 0] }
  /**
   * The hand turns into the next one in its own time, not the bones': an arm of one look for all its gestures
   * kept the last one's hand through the whole of a long way, and changed it only once there.
   */
  handInTime = false

  /** Nothing of an earlier stance left in the arm. */
  get idle(): boolean {
    return this.from === null
  }

  /** How much of what it left is still in the arm (1 just left, 0 arrived). */
  get left(): number {
    if (!this.from) return 0
    return Math.min(1, Math.max(this.upper.left, this.fore.left, 1 - this.since / LEAST))
  }

  /** From now the arm is wanted as `wanted`: it goes there from where it last was. */
  retarget(wanted: Arm3DStance): void {
    const now = this.now
    if (!now) return
    this.upper.set(wanted.du, now.du, this.turning.u)
    this.fore.set(wanted.df, now.df, this.turning.f)
    this.from = now
    this.since = 0
  }

  /** The arm this frame, `dt` on, wanted as `wanted` (given back itself once nothing else is left in it). */
  pose(wanted: Arm3DStance, dt: number): Arm3DStance {
    let out = wanted
    const from = this.from
    if (from) {
      this.upper.step(dt)
      this.fore.step(dt)
      this.since += dt
      if (this.upper.still && this.fore.still && this.since >= LEAST) {
        this.from = null
        this.upper.clear()
        this.fore.clear()
      }
      else {
        const m = smoothstep(0, 1, this.left)
        // In its own time the hand is the next one, carried on the forearm as it now lies (as the last one is).
        const h = this.handInTime ? smoothstep(0, 1, Math.max(0, 1 - this.since / LEAST)) : m
        const df = this.fore.on(wanted.df)
        out = {
          du: this.upper.on(wanted.du),
          df,
          upper: wanted.upper + (from.upper - wanted.upper) * m,
          fore: wanted.fore + (from.fore - wanted.fore) * m,
          hand: blendHands(this.handInTime ? wanted.hand.map((q) => carry(q, wanted.df, df)) : wanted.hand, from.hand.map((q) => carry(q, from.df, df)), h),
          handRest: wanted.handRest + (from.handRest - wanted.handRest) * m,
          hanging: wanted.hanging + (from.hanging - wanted.hanging) * m,
        }
      }
    }
    const last = this.now
    if (last && dt > 0) this.turning = { u: mul(cross(last.du, out.du), 1 / dt), f: mul(cross(last.df, out.df), 1 / dt) }
    this.now = out
    return out
  }
}
