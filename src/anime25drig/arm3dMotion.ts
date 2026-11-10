import type { V3 } from './arm3dMath'
import type { Anime25DArmModel } from './types'
import { add, bspline, carry, HAND_CHAINS, len, lerp, mul, norm, slerp, smoothstep, spin, sub } from './arm3dMath'

/** A gesture arm's model on the playback canvas: the archive's, moved from its layer's corner. */
export interface Arm3DShape extends Omit<Anime25DArmModel, 'rest' | 'raised' | 'hand' | 'restHand' | 'handOutline' | 'armOutline' | 'ground'> {
  rest: { s: V3; e: V3; w: V3 }
  raised: { s: V3; e: V3; w: V3 }
  /** The gesture's drawn hand, 21 points. */
  hand: Array<[number, number]>
  /** A standing figure's drawn hanging hand, 21 points; absent on a bust. */
  restHand?: Array<[number, number]>
}

/** Pose space over which a figure's drawn hand turns into the gesture's. */
const HAND_TURNS = [0.25, 0.7] as const

export interface Arm3DPose { s: V3; e: V3; w: V3; hand: V3[] }

/** What the view draws of one arm this frame. */
export interface Arm3DFrame {
  pose: Arm3DPose
  /** How much of the modelled arm is shown over the figure (a standing figure's fades in and out where it hangs). */
  presence: number
  /** How much a figure's hand still is the portrait's drawn one. */
  handRest: number
  hanging: number
  /** 1 with the arm where it hangs (its wrist), 0 once well away from it. */
  restNear: number
  /** How far the sleeve's own line is held off yet, as the hand first leaves hanging (1 hanging). */
  unlined: number
  view: { width: number; height: number }
  /** The picture's foot on the playback canvas, left to right: nothing of the arm below it. */
  foot: Array<[number, number]>
  /** The picture's left and right edges where they cut it (±Infinity where not): nothing of the arm past them. */
  sides: [number, number]
  /** The gesture layer's mesh as drawn this frame (canvas), its texture places, and how near the arm is held to the drawing. */
  held?: { pos: Float32Array; uv: Float32Array; idx: ArrayLike<number>; near: number; exact: number; toDrawn: [number, number, number, number, number, number] | null }
  /** Near its rest, the portrait's arm (`restArm`, laid under the tube, which falls short of it) carried to where the arm is now (its rect's corners), and how much of it; null away from it. */
  rest: { corners: number[]; alpha: number } | null
}

export function arm3DShape(model: Anime25DArmModel, x: number, y: number): Arm3DShape {
  const at = (p: V3): V3 => [p[0] + x, p[1] + y, p[2]]
  const joints = (j: Anime25DArmModel['rest']) => ({ s: at(j.shoulder), e: at(j.elbow), w: at(j.wrist) })
  const { handOutline: _hand, armOutline: _arm, ground: _ground, ...rest } = model
  return {
    ...rest,
    rest: joints(model.rest),
    raised: joints(model.raised),
    hand: model.hand.map(([hx, hy]) => [hx + x, hy + y]),
    ...(model.restHand ? { restHand: model.restHand.map(([hx, hy]) => [hx + x, hy + y] as [number, number]) } : {}),
  }
}

/**
 * The drawn hand as 3D offsets from its wrist: a finger the drawing hides
 * goes back behind the hand (toward the viewer, it stood in front of the
 * palm drawn over it), and runs no longer than a finger beside its hand.
 * The hand's root where the drawing has it, not the detected wrist.
 */
function handOffsets(shape: Arm3DShape): V3[] {
  const h = shape.hand
  const w = shape.raised.w
  const hidden = shape.hiddenFingers
  const pts: V3[] = Array.from({ length: 21 })
  pts[0] = [h[0][0] - w[0], h[0][1] - w[1], 0]
  const size = Math.hypot(h[9][0] - h[0][0], h[9][1] - h[0][1])
  for (const [ci, chain] of HAND_CHAINS.entries()) {
    let total = 0
    for (let i = 1; i < chain.length; i += 1) {
      total += Math.hypot(h[chain[i]][0] - h[chain[i - 1]][0], h[chain[i]][1] - h[chain[i - 1]][1])
    }
    const hid = hidden.includes(ci)
    const sc = hid ? Math.min(1, size * (ci === 0 ? 0.85 : 1) / Math.max(1e-6, total)) : 1
    for (let i = 1; i < chain.length; i += 1) {
      const a = h[chain[i - 1]]
      const b = h[chain[i]]
      const l = Math.hypot(b[0] - a[0], b[1] - a[1])
      const prev = pts[chain[i - 1]]
      pts[chain[i]] = [prev[0] + (b[0] - a[0]) * sc, prev[1] + (b[1] - a[1]) * sc, prev[2] + (hid ? -l * 0.35 * sc : 0)]
    }
  }
  return pts
}

class Spring {
  v = 0
  constructor(public x: number, private omega: number, private zeta: number) {}
  step(target: number, dt: number): void {
    const n = 4
    const h = dt / n
    for (let i = 0; i < n; i += 1) {
      this.v += (-(this.omega ** 2) * (this.x - target) - 2 * this.zeta * this.omega * this.v) * h
      this.x += this.v * h
    }
  }
}

/**
 * Where the modelled arm is: from hanging (the portrait) up to the gesture
 * along a curve near the drawn poses, held with the wave or a sway, and let
 * go straight down to hanging. Settled in the 11-03..11-06 trials.
 */
export class Arm3DMotion {
  private dirsU: V3[]
  private dirsF: V3[]
  private hands: V3[][]
  // A hand raised to the chest or chin takes a person about half a second: stiffer, it springs up.
  private p = new Spring(0, 2 * Math.PI * 1.25, 0.72)
  private flick = new Spring(0, 2 * Math.PI * 3.6, 0.38)
  private held = 0
  /** How much of the held motion (wave, idle sway) is on: eases in when held, out when let go. */
  private sway = 0
  private last: number | null = null
  /** How much the arm follows the straight way between hanging and the gesture instead of the curve (lowering). */
  private direct = 0
  /** How far the forearm leads the upper arm down (1 let go from raised, 0 raised or at rest); eased, so raising mid-fall never snaps. */
  private fall = 0
  private walkF: number[] = [0]
  private walkA: number[] = [0]
  wanted = false

  private readonly figure: boolean

  constructor(private d: Arm3DShape, private wave: boolean) {
    this.figure = Boolean(d.restHand)
    const all = [d.rest, d.raised]
    // Every pose hangs from the portrait's shoulder, its elbow where the picture drew it and as deep as the
    // bone needs: each picture's shoulder is found a little off the portrait's, and the arm turned from there
    // carried the cuff and hand short of the picture by as much.
    const s0 = d.rest.s
    this.dirsU = all.map((k) => {
      const x = k.e[0] - s0[0]
      const y = k.e[1] - s0[1]
      const z = Math.sqrt(Math.max(0, d.upper * d.upper - x * x - y * y))
      return norm([x, y, k.e[2] - k.s[2] < 0 ? -z : z])
    })
    this.dirsF = all.map((k) => norm(sub(k.w, k.e)))
    // A bust's portrait has no hand hanging (it is out of frame): it is the gesture's. A figure's is drawn: it
    // hangs as drawn, flat in the picture, about where the portrait's wrist has it.
    const hand = handOffsets(d)
    const drawn = d.restHand
    this.hands = [drawn ? drawn.map(([x, y]) => [x - d.rest.w[0], y - d.rest.w[1], 0] as V3) : hand, hand]
    // Progress runs along the way the hand travels as it is seen, not evenly in pose: a stretch going mostly
    // toward the viewer crept on screen where the next shot across it (a twitch).
    const STEPS = 64
    const points = (f: number): V3[] => {
      const q = this.shape(f)
      return [0, 9, 4, 8, 12, 16, 20].map((j) => add(q.w, q.hand[j]))
    }
    let prev = points(0)
    for (let i = 1; i <= STEPS; i += 1) {
      const f = i / STEPS
      const q = points(f)
      const step = q.reduce((acc, p, j) => acc + Math.hypot(p[0] - prev[j][0], p[1] - prev[j][1]), 0) / q.length
      this.walkF.push(f)
      this.walkA.push(this.walkA[i - 1] + step + 1e-3)
      prev = q
    }
    const walked = this.walkA[this.walkA.length - 1]
    this.walkA = this.walkA.map((x) => x / walked)
  }

  /** Pose space (0 hanging, 1 the gesture) at progress x along the hand's way. */
  private keyAt(x: number): number {
    const t = Math.max(0, Math.min(1, x))
    const a = this.walkA
    let lo = 0
    let hi = a.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (a[mid] <= t) lo = mid
      else hi = mid
    }
    return this.walkF[lo] + (this.walkF[hi] - this.walkF[lo]) * (t - a[lo]) / Math.max(1e-9, a[hi] - a[lo])
  }

  /** How much a figure's hand still is the portrait's drawn one (1 at rest), before it turns into the gesture's. */
  get handRest(): number {
    if (!this.figure) return 0
    // Between the curve's pose space and the straight way's, as far as the arm follows each: switched at once,
    // the drawn hand's picture jumped as a raise was asked again on the way down.
    const along = this.keyAt(this.p.x)
    const straight = Math.max(0, Math.min(1, this.p.x)) ** (1 + 0.8 * this.fall)
    const f = along + (straight - along) * this.direct
    // Over the hand's turn: gone sooner, the drawn picture went in a frame or two of a quick rise.
    return 1 - smoothstep(HAND_TURNS[0] - 0.05, HAND_TURNS[1], f)
  }

  /** How near hanging the arm is (1 hanging): the sleeve takes the portrait's outline there. */
  get hanging(): number {
    const t = Math.min(1, Math.max(0, this.p.x / 0.7))
    return 1 - t * t * (3 - 2 * t)
  }

  get progress(): number {
    return this.p.x
  }

  /** 1 while the arm is let go (on its straight way down), 0 while raised. */
  get lowering(): number {
    return this.direct
  }

  /** Back at hanging and still: nothing left to move. */
  get resting(): boolean {
    return !this.wanted && Math.abs(this.p.x) < 0.002 && Math.abs(this.p.v) < 0.01 && this.sway < 0.01 && Math.abs(this.flick.x) < 1e-3
  }

  /**
   * Put at the gesture, held, or at hanging, at once and still: the arm's way there from wherever it was is
   * another's to make (`Arm3DTransit`).
   */
  snap(raised: boolean): void {
    this.wanted = raised
    this.p.x = raised ? 1 : 0
    this.p.v = 0
    this.flick.x = 0
    this.flick.v = 0
    this.direct = raised ? 0 : 1
    this.fall = 0
    this.sway = 0
    this.held = 0
  }

  step(time: number): void {
    const dt = this.last === null ? 0 : Math.min(1 / 30, Math.max(0, time - this.last))
    this.last = time
    const before = this.p.x
    this.p.step(this.wanted ? 1 : 0, dt)
    // Let go, the arm comes straight down from where it is to hanging: back along the curve it played the
    // gesture backward, not how anyone lowers a hand.
    this.direct += ((this.wanted ? 0 : 1) - this.direct) * Math.min(1, dt / 0.08)
    this.fall += ((!this.wanted && this.p.x > 0.05 ? 1 : 0) - this.fall) * Math.min(1, dt / 0.08)
    // The held motion's clock keeps running while it eases out, so letting go never snaps the arm.
    const holding = this.wanted && this.p.x > 0.9
    this.sway += ((holding ? 1 : 0) - this.sway) * Math.min(1, dt / (holding ? 0.35 : 0.12))
    this.held = holding || this.sway > 0.01 ? this.held + dt : 0
    const speed = dt > 0 ? (this.p.x - before) / dt : 0
    this.flick.step(Math.max(-0.5, Math.min(0.5, -0.1 * speed)), dt)
  }

  /** The gesture exactly as drawn: no run past it, no wave. */
  restPose(anchor: V3): Arm3DPose {
    return this.keyPose(1, anchor)
  }

  /** The forearm's length at pose space f: a figure's as each picture draws it, between them. */
  private foreAt(f: number): number {
    const r = this.d.restFore
    const t = Math.max(0, Math.min(1, f))
    return r === undefined ? this.d.fore : r + (this.d.fore - r) * t
  }

  /** Pose i (0 hanging, 1 the gesture) exactly as drawn. */
  keyPose(i: number, anchor: V3): Arm3DPose {
    const e = add(anchor, mul(this.dirsU[i], this.d.upper))
    const w = add(e, mul(this.dirsF[i], this.foreAt(i)))
    return { s: anchor, e, w, hand: this.hands[i].map((o) => add(w, o)) }
  }

  /** The arm's directions and the hand (from its wrist) at pose space f, before any wave or turn. */
  private shape(f: number): { du: V3; df: V3; w: V3; hand: V3[] } {
    const u = Math.max(0, Math.min(1, f))
    // Near the poses, not through each; the ends exact.
    const way = (get: (i: number) => V3): V3 => {
      const P = (i: number): V3 => (i < 0 ? sub(mul(get(0), 2), get(1)) : i > 1 ? sub(mul(get(1), 2), get(0)) : get(i))
      return norm(bspline(P(-1), P(0), P(1), P(2), u))
    }
    const du = way((i) => this.dirsU[i])
    const df = way((i) => this.dirsF[i])
    // A figure's drawn hand first goes up as drawn, carried by the forearm (it wears the portrait's picture
    // there), and turns into the gesture's only on the way.
    const h = this.figure ? smoothstep(HAND_TURNS[0], HAND_TURNS[1], u) : u
    const hands = this.figure ? [this.hands[0].map((q) => carry(q, this.dirsF[0], df)), this.hands[1]] : this.hands
    const along = (get: (i: number) => V3): V3 => {
      const P = (i: number): V3 => (i < 0 ? sub(mul(get(0), 2), get(1)) : i > 1 ? sub(mul(get(1), 2), get(0)) : get(i))
      return norm(bspline(P(-1), P(0), P(1), P(2), h))
    }
    // The hand by its bones, not its points: each bone turns along a smooth curve and keeps its length.
    const hand: V3[] = Array.from({ length: 21 })
    hand[0] = lerp(hands[0][0], hands[1][0], h)
    for (const chain of HAND_CHAINS) {
      for (let j = 1; j < chain.length; j += 1) {
        const a = chain[j - 1]
        const b = chain[j]
        const bone = (q: V3[]) => sub(q[b], q[a])
        const dir = along((i) => norm(bone(hands[i])))
        const l = len(bone(hands[0])) * (1 - h) + len(bone(hands[1])) * h
        hand[b] = add(hand[a], mul(dir, l))
      }
    }
    return { du, df, w: add(mul(du, this.d.upper), mul(df, this.foreAt(u))), hand }
  }

  /**
   * One end's direction to the other's through in front of the body, the way a hand is lowered (the
   * shortest turn from a raised forearm to a hanging one could take it through the body).
   */
  private way(a: V3, b: V3, f: number): V3 {
    const m = norm(add(add(a, b), [0, 0, 1.2 * (1 - (a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) / 2]))
    return slerp(slerp(a, m, f), slerp(m, b, f), f)
  }

  /** Pose i's hand carried with the forearm along the straight way, a step at a time (never twisting about it). */
  private carried(i: number, from: number, to: number): V3[] {
    let h = this.hands[i]
    let at = this.way(this.dirsF[0], this.dirsF[1], from)
    for (let k = 1; k <= 12; k += 1) {
      const next = this.way(this.dirsF[0], this.dirsF[1], from + (to - from) * k / 12)
      h = h.map((q) => carry(q, at, next))
      at = next
    }
    return h
  }

  private straight(f: number, fall: number): { du: V3; df: V3; hand: V3[] } {
    // Let go, the forearm falls ahead of the upper arm: level, it came down last, pointing at the viewer (its
    // sleeve end a round ring) just where the arm slows into hanging. Not raised from it (the start of a raise).
    const ff = f ** (1 + 0.8 * fall)
    const a = this.carried(0, 0, ff)
    const b = this.carried(1, 1, ff)
    const t = this.figure ? smoothstep(HAND_TURNS[0], HAND_TURNS[1], ff) : smoothstep(0.05, 0.3, ff)
    return { du: this.way(this.dirsU[0], this.dirsU[1], f), df: this.way(this.dirsF[0], this.dirsF[1], ff), hand: blendHands(a, b, t) }
  }

  pose(anchor: V3): Arm3DPose {
    let { du, hand, df } = this.shape(this.keyAt(this.p.x))
    if (this.direct > 0.001) {
      const g = this.straight(Math.max(0, Math.min(1, this.p.x)), this.fall)
      const t = this.direct
      du = slerp(du, g.du, t)
      df = slerp(df, g.df, t)
      hand = blendHands(hand, g.hand, t)
    }
    // Past the gesture the forearm runs on a little; held, it waves about the elbow.
    const ramp = this.sway
    let turn = Math.max(0, this.p.x - 1) * -0.9
    if (this.wave) turn += ramp * 0.2 * Math.sin(this.held * 2 * Math.PI * 1.6)
    else turn += ramp * 0.025 * Math.sin(this.held * 2 * Math.PI * 0.4)
    df = spin(df, turn)
    const s = anchor
    const e = add(s, mul(du, this.d.upper))
    const w = add(e, mul(df, this.foreAt(this.p.x)))
    const wristTurn = turn + this.flick.x + (this.wave ? -ramp * 0.12 * Math.sin(this.held * 2 * Math.PI * 1.6 - 0.9) : 0)
    return { s, e, w, hand: hand.map((o) => add(w, spin(o, wristTurn))) }
  }
}

/** Two hands bone by bone: each bone's direction turned between theirs, its length between theirs. */
export function blendHands(a: V3[], b: V3[], t: number): V3[] {
  const hand: V3[] = Array.from({ length: 21 })
  hand[0] = lerp(a[0], b[0], t)
  for (const chain of HAND_CHAINS) {
    for (let j = 1; j < chain.length; j += 1) {
      const p = chain[j - 1]
      const q = chain[j]
      const ba = sub(a[q], a[p])
      const bb = sub(b[q], b[p])
      hand[q] = add(hand[p], mul(slerp(norm(ba), norm(bb), t), len(ba) * (1 - t) + len(bb) * t))
    }
  }
  return hand
}

/** How far the wrist lies over the upper arm on screen (0–1), and the upper arm's radius there. */
export function wristOverUpper(d: Arm3DShape, pose: Arm3DPose) {
  const se = sub(pose.e, pose.s)
  const l2 = se[0] * se[0] + se[1] * se[1]
  const t = Math.max(0, Math.min(1, ((pose.w[0] - pose.s[0]) * se[0] + (pose.w[1] - pose.s[1]) * se[1]) / Math.max(1e-6, l2)))
  const ru = d.radius[Math.round(t * (d.radius.length / 2 - 1))]
  const off = Math.hypot(pose.w[0] - (pose.s[0] + se[0] * t), pose.w[1] - (pose.s[1] + se[1] * t))
  return { se, t, ru, over: 1 - smoothstep(ru, ru * 1.5, off) }
}

/**
 * Folded back up over the upper arm, the forearm lies in front of it, as a bent arm's does: the pictures say
 * nothing of their depths there, and the upper sleeve came through the forearm and hand. Only where the
 * wrist is over the upper arm on screen, and only toward the viewer, so nothing moves on screen.
 */
export function liftForearm(d: Arm3DShape, pose: Arm3DPose): Arm3DPose {
  const { se, t, ru, over } = wristOverUpper(d, pose)
  const lift = over * Math.max(0, ru * 1.1 - (pose.w[2] - (pose.s[2] + se[2] * t)))
  if (lift <= 0) return pose
  return { s: pose.s, e: pose.e, w: [pose.w[0], pose.w[1], pose.w[2] + lift], hand: pose.hand.map((q) => [q[0], q[1], q[2] + lift] as V3) }
}
