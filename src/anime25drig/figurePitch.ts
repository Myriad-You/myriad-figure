import type { BoneTransform, FigureRest } from './figureSkeleton'
import type { Anime25DPlaybackAnchors, Anime25DTorsoShellProfile } from './types'
import { figureFrontDepth } from './torsoDeformation'

/**
 * A standing figure leaning toward the viewer or away: its bones' third
 * dimension. The abdomen turns about the hips and the chest on about the
 * waist, in the plane the figure faces along; everything drawn on the trunk
 * has a depth there (the torso's cylinder) and turns with them, then is seen
 * through one camera that stands still. So the shoulders come nearer and
 * grow more than the waist, and the trunk shows shorter, because it turned.
 *
 * What does not turn with the trunk hangs from it and stays upright: the
 * head on the neck (it keeps facing the viewer, and grows about its chin as
 * it nears: its jaw stays on the neck) and the arms from the shoulders
 * (down and nearer with them, but beside the trunk all the way down).
 *
 * Below the hips nothing is still either. A standing body keeps its weight
 * over its feet: as the trunk leans in the hips go back, and forward as it
 * leans back, the legs leaning the other way from the ankles and carrying
 * the trunk with them. Only the feet stay where they stand. All that is
 * drawn below the hips goes with the legs there, whatever it is: a skirt
 * over them, a coat's hem down to the ankles.
 *
 * So the trunk and the legs are one field over all their layers by where
 * they were drawn, as the turn's cylinder is: layers taken each their own
 * way part where one was cut along another's edge (a skirt under an open
 * cardigan, a belt drawn with the shirt above it, a thigh inside a skirt),
 * and the background, or what one of them was painted in with, shows
 * between them.
 *
 * Turned to a side, the lean goes the way the figure faces: across the
 * picture by the turn's sine, toward the camera by its cosine.
 *
 * A bust has no bones and none of this (its shader's posture is its own).
 */

/**
 * The lean at `bodyPitch` = +1 (toward the viewer) and −1 (away), radians. Further either way the hands hang
 * lower and the legs lean more than reads as standing at ease; a drawing made upright also has no top of the
 * head or underside of the chin to show, though with the head kept on the viewer neither is missed.
 */
export const FIGURE_PITCH_FORWARD = (25 * Math.PI) / 180
export const FIGURE_PITCH_BACK = (20 * Math.PI) / 180
/** Of the lean, the hips take this share; the waist the rest. */
const HIP_SHARE = 0.5
/**
 * A standing figure's legs lean the other way from the ankles by this share
 * of the lean: at a full lean in, the hips go back, away from the viewer, by
 * about a twenty-fifth of the figure's height, as a person's do bowing that
 * far. A floating figure has no weight to keep over its feet, and none.
 */
const LEG_COUNTER = 0.25
/**
 * The camera stands this many trunk lengths (hips to the neck's foot) away,
 * level with the waist, as a whole figure is framed: what hangs low then
 * drops by little more than the shoulders it hangs from did.
 */
const CAMERA_DISTANCE = 4
/**
 * The head shows how far it leans out over the hips this many times over: a
 * rigger scales a head leaning in by about a fifth where the camera alone
 * would give a tenth, and a drawn lean does the same.
 */
const HEAD_NEARNESS = 2.35
/**
 * ...and the trunk itself this many times: what the camera alone gives a body leaning in (shoulders a fiftieth
 * wider) does not read as coming nearer. It grows about the middle of its shoulder line, so the shoulders
 * widen where they are and what is below them comes down further.
 */
const TRUNK_NEARNESS = 2.3
/** The trunk's front stands this share of its turning cylinder's depth out from the spine. */
const FRONT_DEPTH = 0.6
/** Bones blend across the hips and the waist over this share of the bones meeting there (figureSkeleton's). */
const JOINT_BLEND = 0.18
/** An arm hangs from its shoulder, this share of the chest's front out from the spine. */
const SHOULDER_DEPTH = 0.3

/**
 * A lean is not taken by the whole body at once. The legs move as they are asked, taking the hips back from
 * under a trunk about to come forward. The trunk turns at the hips after them, the chest at the waist after
 * that, and the head on it; the arms after the chest again, the hands last. Each comes on a soft spring
 * (Hz, damping ratio) after the one before: a little late, a little past where it is going, then back.
 * Held stiff as one piece, a figure arrived in its lean all at the same instant and stood there: a pose
 * changed, not a body moved.
 */
const HIP_FOLLOW = { frequency: 2.6, damping: 0.7 } as const
const CHEST_FOLLOW = { frequency: 1.7, damping: 0.4 } as const
const ARM_FOLLOW = { frequency: 1.25, damping: 0.42 } as const
/** The springs' longest integration step: frames are split so every frame rate moves alike. */
const FOLLOW_STEP = 1 / 240
/** A lean this small (radians: a hundredth of a pixel on a figure), or a spring this near its rest with nothing asked, is none. */
const FOLLOW_REST = 1e-5

/** Recruited by a nod alone (no directed lean), the trunk leans at most this far, radians. */
const NOD_LEAN = 0.18

/** The lean, in radians toward the viewer, at a directed `bodyPitch` and a recruited one (−1…1 each). */
export function figurePitchAngle(directed: number, recruited: number): number {
  const angle = directed * (directed >= 0 ? FIGURE_PITCH_FORWARD : FIGURE_PITCH_BACK) + recruited * NOD_LEAN
  return Math.max(-FIGURE_PITCH_BACK, Math.min(FIGURE_PITCH_FORWARD, angle))
}

/**
 * The neck under a chin come down over it is pressed no shorter than this share of its drawn length: past
 * that the chin slides on over it, or a short neck would fold up through itself.
 */
const NECK_SHORTEST = 0.45

/** How a layer takes the lean. */
export type FigurePitchKind =
  /** The head and all on it: upright on the top of the neck. */
  | 'head'
  /** The neck and what is worn on it: on the chest, its top going with the head. */
  | 'neck'
  /** The trunk, the legs and all worn on them: on the trunk's front, and below the hips on the legs' line. */
  | 'trunk'
  /** An arm and its sleeve: hanging from the shoulder, sewn to the trunk at its top. */
  | 'arm'

export interface FigurePitchBinding {
  kind: FigurePitchKind
}

/** Where the lean puts a point: p' = scale · p + (x, y). */
export interface FigureCarry {
  scale: number
  x: number
  y: number
}

/** A rigid motion in the plane the figure leans in: (height above the hips, depth toward its front). */
interface Sagittal {
  hh: number
  hd: number
  dh: number
  dd: number
  h: number
  d: number
}

/** A figure's measures for leaning, in canvas pixels. */
export interface FigurePitchRest {
  centerX: number
  hipsY: number
  waistY: number
  neckBottom: number
  chestY: number
  /** Where the head rides: the skull's foot, level with the eyes. */
  headY: number
  /** Where the chin ends: what the head grows about, and above it the neck goes with the head. */
  chinY: number
  /** The line the arms hang from. */
  shoulderY: number
  /** The ankles: the legs lean from here, and below it the feet stand still. */
  ankleY: number
  /** The share of the lean its legs lean the other way: LEG_COUNTER standing, none floating. */
  counter: number
  torso: Readonly<Anime25DTorsoShellProfile>
  /** The camera: its distance and the point it looks at. */
  focal: number
  eyeX: number
  eyeY: number
}

export function figurePitchRest(
  rest: Readonly<FigureRest>,
  torso: Readonly<Anime25DTorsoShellProfile>,
  face: Readonly<{ y0: number; y1: number; cy: number }>,
  chestY: number,
  eyes: readonly (Readonly<{ icy: number }> | undefined)[] = [],
  shoulders: readonly (Readonly<{ y: number }> | undefined)[] = [],
  /** Standing on the ground rather than floating over it. */
  standing = true,
): FigurePitchRest {
  const trunk = Math.max(1, rest.hips.y - rest.neckBase.y)
  const seen = eyes.filter((eye): eye is { icy: number } => Boolean(eye) && Number.isFinite(eye!.icy))
  const eyeY = seen.length ? seen.reduce((sum, eye) => sum + eye.icy, 0) / seen.length : face.cy
  const found = shoulders.filter((joint): joint is { y: number } => Boolean(joint) && Number.isFinite(joint!.y))
  const usual = rest.neckBase.y + trunk * 0.12
  const shoulderY = found.length
    ? Math.max(rest.neckBase.y, Math.min(rest.neckBase.y + trunk * 0.3, found.reduce((sum, joint) => sum + joint.y, 0) / found.length))
    : usual
  return {
    centerX: rest.neckBase.x,
    hipsY: rest.hips.y,
    waistY: rest.waist.y,
    neckBottom: rest.neckBase.y,
    chestY: Math.max(shoulderY + 1, Math.min(rest.waist.y, chestY)),
    headY: eyeY,
    chinY: face.y1,
    shoulderY,
    ankleY: Math.max(rest.hips.y + 1, Math.min(rest.groundY, (rest.legs.L.ankle.y + rest.legs.R.ankle.y) / 2)),
    counter: standing ? LEG_COUNTER : 0,
    torso,
    focal: trunk * CAMERA_DISTANCE,
    eyeX: rest.neckBase.x,
    eyeY: rest.waist.y,
  }
}

/** A figure's lean, measured on its package: its eyes and shoulders, its trunk's depth, its chest, its stance. */
export function figurePitchOf(
  rest: Readonly<FigureRest>,
  anchors: Readonly<Anime25DPlaybackAnchors>,
  torso: Readonly<Anime25DTorsoShellProfile>,
  chestY: number,
  standing = true,
): FigurePitch {
  const joints = anchors.skeleton?.joints
  return new FigurePitch(figurePitchRest(rest, torso, anchors.face, chestY, [anchors.eyeL, anchors.eyeR],
    [joints?.shoulderL, joints?.shoulderR], standing))
}

function smoothstep(value: number): number {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}

function across(y: number, at: number, band: number): number {
  return smoothstep((y - (at - band)) / Math.max(1e-6, 2 * band))
}

const IDENTITY_CARRY: Readonly<FigureCarry> = { scale: 1, x: 0, y: 0 }

/** This frame's lean of a standing figure. */
export class FigurePitch {
  /** The lean in radians, positive toward the viewer. */
  angle = 0
  readonly head: FigureCarry = { ...IDENTITY_CARRY }
  /** What hangs from the shoulders: the arms, at the shoulders. */
  readonly hung: FigureCarry = { ...IDENTITY_CARRY }
  /** The same where the arms have got to, coming after the chest: what the hands take. */
  private readonly late: FigureCarry = { ...IDENTITY_CARRY }
  private readonly abdomen: Sagittal = { hh: 1, hd: 0, dh: 0, dd: 1, h: 0, d: 0 }
  private readonly chest: Sagittal = { hh: 1, hd: 0, dh: 0, dd: 1, h: 0, d: 0 }
  /** The chest as it would be with the lean the arms have got to. */
  private readonly lateChest: Sagittal = { hh: 1, hd: 0, dh: 0, dd: 1, h: 0, d: 0 }
  /** The lean the hip joint, the chest and the arms have each got to (HIP_FOLLOW…), once they are loose. */
  private readonly hipLean = { value: 0, velocity: 0 }
  private readonly chestLean = { value: 0, velocity: 0 }
  private readonly armLean = { value: 0, velocity: 0 }
  private loose = false
  /** Of the lean, what they come after: all of it but a body's own answer to a nod, which has its spring already. */
  private asked = 0
  private hipAt = 0
  private chestAt = 0
  private armsAt = 0
  private yawSine = 0
  private yawCosine = 1
  /** Where the chin is before the lean carries it: what the head grows about. */
  private readonly chin = { x: 0, y: 0 }
  /** Where the middle of the shoulder line is carried to: what the trunk grows about (TRUNK_NEARNESS). */
  private readonly shoulders = { x: 0, y: 0 }
  /** How far the legs' counter-lean has moved the hips, and the trunk on them. */
  private readonly hips = { up: 0, forward: 0 }
  private readonly moved = { up: 0, forward: 0 }
  /** Of `moved.forward`, what the legs under that point gave it: the rest is its lean out over them. */
  private stood = 0
  private readonly scratch: FigureCarry = { ...IDENTITY_CARRY }
  private readonly part: FigureCarry = { ...IDENTITY_CARRY }
  /** The arms' scale as the camera alone shows it, before they grow with the trunk. */
  private hungSeen = 1
  private lateSeen = 1

  constructor(readonly rest: FigurePitchRest) {}

  get active(): boolean {
    return this.angle !== 0 || this.hipAt !== 0 || this.chestAt !== 0 || this.armsAt !== 0
  }

  /**
   * A lean taken in turn is under way or held (not one a nod alone recruits, which throws nothing more than
   * its nod did): what hangs free on the figure is thrown by it.
   */
  get thrown(): boolean {
    return this.asked !== 0 || this.hipLean.value !== 0 || this.chestLean.value !== 0 || this.armLean.value !== 0
  }

  /** How far across the picture such a lean has the hips: what a skirt's hem trails behind (standing). */
  get hipsAcross(): number {
    return this.asked === 0 ? 0 : (this.rest.ankleY - this.rest.hipsY) * Math.sin(-this.asked * this.rest.counter) * this.yawSine
  }

  /**
   * Lets the trunk, the chest and the arms come after the lean last asked: once each step of the physics,
   * after it is posed (the frame drawn is posed again after this). Not `dynamic` (physics off), they are held
   * where it is asked.
   */
  follow(dt: number, dynamic: boolean): void {
    const springs = [this.hipLean, this.chestLean, this.armLean] as const
    if (!dynamic || !(dt > 0) || !this.loose) {
      for (const spring of springs) { spring.value = this.asked; spring.velocity = 0 }
      this.loose = dynamic && dt > 0
      return
    }
    const steps = Math.ceil(dt / FOLLOW_STEP - 1e-9)
    const h = dt / steps
    for (let i = 0; i < steps; i += 1) {
      chase(this.hipLean, this.asked, HIP_FOLLOW, h)
      chase(this.chestLean, this.hipLean.value, CHEST_FOLLOW, h)
      chase(this.armLean, this.chestLean.value, ARM_FOLLOW, h)
    }
    if (this.asked === 0 && springs.every((spring) => Math.abs(spring.value) < FOLLOW_REST && Math.abs(spring.velocity) < FOLLOW_REST)) {
      for (const spring of springs) spring.value = spring.velocity = 0
    }
  }

  /**
   * Poses the lean: `angle` radians toward the viewer, the figure turned by
   * the torso's yaw, its head riding the chest bone where the sway has it.
   * `own`: of that angle, the body's own answer to a nod, taken by the whole trunk as it is.
   */
  step(angle: number, yawSine: number, yawCosine: number, chest: Readonly<BoneTransform>, own = 0): void {
    if (!Number.isFinite(angle)) angle = 0
    if (!Number.isFinite(own)) own = 0
    const hipAt = this.loose ? this.hipLean.value + own : angle
    const chestAt = this.loose ? this.chestLean.value + own : angle
    const armsAt = this.loose ? this.armLean.value + own : angle
    if (angle === 0 && hipAt === 0 && chestAt === 0 && armsAt === 0 && !this.active) return
    this.angle = angle
    // (A lean dying away never quite reaches nothing: past where it could be seen, there is none to come after.)
    this.asked = Math.abs(angle - own) < FOLLOW_REST ? 0 : angle - own
    this.hipAt = hipAt
    this.chestAt = chestAt
    this.armsAt = armsAt
    this.yawSine = yawSine
    this.yawCosine = yawCosine
    const rest = this.rest
    // The legs take the lean as it is asked; the trunk turns at the hips, and the chest on about the waist, by what each has got to.
    const counter = -angle * rest.counter
    const leg = rest.ankleY - rest.hipsY
    this.hips.forward = leg * Math.sin(counter)
    this.hips.up = -leg * (1 - Math.cos(counter))
    const hip = hipAt * HIP_SHARE
    const a = this.abdomen
    a.hh = Math.cos(hip); a.hd = -Math.sin(hip); a.dh = Math.sin(hip); a.dd = Math.cos(hip); a.h = 0; a.d = 0
    this.turnChest(chestAt - chestAt * HIP_SHARE, this.chest)
    this.turnChest(armsAt - armsAt * HIP_SHARE, this.lateChest)
    // The head, upright on the skull's foot, which the chest carries: it goes where that goes (seen level) and,
    // nearer, grows about its chin, where it sits on the neck. Grown about its eyes its top stood still and its
    // jaw came down over the neck and the collar: a head sunk between the shoulders, not one leaning in.
    this.onChest(rest.hipsY - rest.headY, 0)
    this.carryOf(this.moved.up, this.moved.forward, this.head, rest.headY)
    const chinX = this.chin.x = chest.a * rest.centerX + chest.c * rest.chinY + chest.tx
    const chinY = this.chin.y = chest.b * rest.centerX + chest.d * rest.chinY + chest.ty
    const grown = this.grown(this.head.scale, this.moved.forward, HEAD_NEARNESS)
    const atX = this.head.scale * chinX + this.head.x
    const atY = this.head.scale * chinY + this.head.y
    this.head.x = atX + (this.head.x - atX) * grown
    this.head.y = atY + (this.head.y - atY) * grown
    this.head.scale *= grown
    this.onTrunk(rest.shoulderY, this.front(rest.centerX, rest.shoulderY))
    const middle = this.carryOf(this.moved.up, this.moved.forward, this.part)
    // (Where the sway has it, like the head's own point: grown about where it was drawn, a swayed trunk slid under its head.)
    this.shoulders.x = middle.scale * (chest.a * rest.centerX + chest.c * rest.shoulderY + chest.tx) + middle.x
    this.shoulders.y = middle.scale * (chest.b * rest.centerX + chest.d * rest.shoulderY + chest.ty) + middle.y
    const shoulderDepth = this.front(rest.centerX, rest.chestY) * SHOULDER_DEPTH
    this.onChest(rest.hipsY - rest.shoulderY, shoulderDepth)
    this.hungSeen = this.carryOf(this.moved.up, this.moved.forward, this.hung).scale
    this.grow(this.hung)
    this.onChest(rest.hipsY - rest.shoulderY, shoulderDepth, this.lateChest)
    this.lateSeen = this.carryOf(this.moved.up, this.moved.forward, this.late).scale
    this.grow(this.late)
  }

  /** The chest turned on about the waist by `waist` radians, then going with the abdomen. */
  private turnChest(waist: number, k: Sagittal): void {
    const a = this.abdomen
    const c = Math.cos(waist)
    const s = Math.sin(waist)
    const at = this.rest.hipsY - this.rest.waistY
    const th = at * (1 - c)
    const td = -s * at
    k.hh = a.hh * c + a.hd * s; k.hd = -a.hh * s + a.hd * c
    k.dh = a.dh * c + a.dd * s; k.dd = -a.dh * s + a.dd * c
    k.h = a.hh * th + a.hd * td; k.d = a.dh * th + a.dd * td
  }

  /** The trunk's front at a rest point: how far it stands out from the spine. */
  private front(x: number, y: number): number {
    const torso = this.rest.torso
    const across = (x - torso.centerX) / Math.max(1, torso.radiusX)
    return Math.sqrt(Math.max(0, 1 - Math.min(1, across * across))) * torso.radiusZ * FRONT_DEPTH
      * figureFrontDepth(torso, y, this.rest.neckBottom, this.rest.chestY)
  }

  /** How far the chest (`k`: as it is, or as the arms have it) moves a point on it, at height `h` over the hips and depth `d`. */
  private onChest(h: number, d: number, k: Readonly<Sagittal> = this.chest): void {
    this.moved.up = k.hh * h + k.hd * d + k.h - h + this.hips.up
    this.moved.forward = k.dh * h + k.dd * d + k.d - d + this.hips.forward
    this.stood = this.hips.forward
  }

  /**
   * How far a point drawn at height `y`, `d` out from the spine, is moved: by the trunk's bones over the hips,
   * and by the legs under it, which lean straight from the ankles to the hips they moved (all of that at the
   * hips and above, less down the leg, none below the ankle: the feet stand).
   */
  private onTrunk(y: number, d: number): void {
    const rest = this.rest
    const h = rest.hipsY - y
    const legs = Math.max(0, Math.min(1, (rest.ankleY - y) / (rest.ankleY - rest.hipsY)))
    const belowWaist = across(y, rest.waistY, Math.max(1, (rest.waistY - rest.neckBottom) * JOINT_BLEND))
    const belowHips = across(y, rest.hipsY, Math.max(1, (rest.hipsY - rest.waistY) * JOINT_BLEND))
    const onChest = 1 - belowWaist
    const onAbdomen = belowWaist * (1 - belowHips)
    const k = this.chest
    const a = this.abdomen
    this.stood = this.hips.forward * legs
    this.moved.up = onChest * (k.hh * h + k.hd * d + k.h - h) + onAbdomen * (a.hh * h + a.hd * d - h) + this.hips.up * legs
    this.moved.forward = onChest * (k.dh * h + k.dd * d + k.d - d) + onAbdomen * (a.dh * h + a.dd * d - d) + this.stood
  }

  /**
   * How much more than the camera's `scale` a part gone `forward` grows to show its lean `times` over: the
   * lean out over the legs, whichever way they went under it (`stood`, from the same point's travel).
   */
  private grown(scale: number, forward: number, times: number): number {
    const rest = this.rest
    const out = rest.focal / Math.max(rest.focal * 0.25, rest.focal - (forward - this.stood) * this.yawCosine)
    return (scale + (times - 1) * (out - 1)) / scale
  }

  /** Where the trunk's bones and the camera put its front at a rest point, grown as it nears (TRUNK_NEARNESS). */
  private onFront(x: number, y: number, out: FigureCarry): FigureCarry {
    this.onTrunk(y, this.front(x, y))
    return this.grow(this.carryOf(this.moved.up, this.moved.forward, out))
  }

  /** Grows a carry of the trunk (its travel still in `moved`) about the carried middle of the shoulder line. */
  private grow(out: FigureCarry): FigureCarry {
    const grown = this.grown(out.scale, this.moved.forward, TRUNK_NEARNESS)
    out.x = out.x * grown + this.shoulders.x * (1 - grown)
    out.y = out.y * grown + this.shoulders.y * (1 - grown)
    out.scale *= grown
    return out
  }

  /** A point moved `up` and `forward` in the figure's own plane, as the camera (level with `eyeY`) then sees it. */
  private carryOf(up: number, forward: number, out: FigureCarry, eyeY = this.rest.eyeY): FigureCarry {
    const rest = this.rest
    const scale = rest.focal / Math.max(rest.focal * 0.25, rest.focal - forward * this.yawCosine)
    out.scale = scale
    out.x = rest.eyeX * (1 - scale) + forward * this.yawSine * scale
    out.y = eyeY * (1 - scale) - up * scale
    return out
  }

  /** Where the lean puts what was drawn at (`x`, `y`) of a layer bound as `binding`. */
  carryAt(binding: FigurePitchBinding, x: number, y: number, out: FigureCarry): FigureCarry {
    const rest = this.rest
    if (binding.kind === 'head') return copy(this.head, out)
    this.onFront(x, y, out)
    if (binding.kind === 'neck') {
      // Under the chin the neck is the head's; at its foot the chest's. How far the chin comes down on that
      // foot, in this column, against how short the neck may be pressed (NECK_SHORTEST).
      const foot = this.onFront(x, rest.neckBottom, this.part)
      const pressed = (this.head.scale * rest.chinY + this.head.y) - rest.chinY - ((foot.scale * rest.neckBottom + foot.y) - rest.neckBottom)
      const most = (1 - NECK_SHORTEST) * Math.max(1, rest.neckBottom - rest.chinY)
      const share = pressed > most ? most / pressed : 1
      return mix(out, this.head, share * smoothstep((rest.neckBottom - y) / Math.max(1, rest.neckBottom - rest.chinY)))
    }
    if (binding.kind === 'arm') {
      // It drops and grows with its shoulder but stays beside the trunk at every height: hung free from a
      // shoulder gone forward, a turned figure's far arm stood off its side (nothing drawn between them) and
      // its near one went behind the trunk it is drawn under.
      // Down its length it comes after its shoulder (ARM_FOLLOW): the hand, by the hips, is last into a lean.
      const after = smoothstep((y - rest.chestY) / Math.max(1, rest.hipsY - rest.chestY))
      const seen = this.hungSeen + (this.lateSeen - this.hungSeen) * after
      const hung = this.part
      hung.scale = this.hung.scale + (this.late.scale - this.hung.scale) * after
      hung.y = this.hung.y + (this.late.y - this.hung.y) * after
      // (Across, the trunk's travel at this height as the arm's own camera scale shows it, then grown as the arm is.)
      const grown = hung.scale / seen
      hung.x = (rest.eyeX * (1 - seen) + this.moved.forward * this.yawSine * seen) * grown + this.shoulders.x * (1 - grown)
      return mix(out, hung, smoothstep((y - rest.shoulderY) / Math.max(1, rest.chestY - rest.shoulderY)))
    }
    return out
  }

  /**
   * A point of the head as carried, put back where it would be had the head moved as far and not grown. What
   * swings from the head (its hair) is thrown by how the head travels; that it shows larger for being nearer
   * moves no lock, and taken for travel it blew the hair out sideways whenever she leaned in.
   */
  headTravel(point: { x: number; y: number }): void {
    const { scale, x, y } = this.head
    if (scale === 1) return
    const grown = (scale - 1) / scale
    point.x -= grown * (point.x - x - scale * this.chin.x)
    point.y -= grown * (point.y - y - scale * this.chin.y)
  }

  /** Moves a point done with everything else, drawn at (`restX`, `restY`). */
  carryPoint(point: { x: number; y: number }, binding: FigurePitchBinding, restX: number, restY: number): void {
    const carry = this.carryAt(binding, restX, restY, this.scratch)
    point.x = carry.scale * point.x + carry.x
    point.y = carry.scale * point.y + carry.y
  }

  /** The same for a layer carried whole (column-major 3×3), as drawn at its middle; `out` may be `m`. */
  carryAffine(m: Float32Array, binding: FigurePitchBinding, restX: number, restY: number): void {
    const carry = this.carryAt(binding, restX, restY, this.scratch)
    m[0] *= carry.scale; m[1] *= carry.scale
    m[3] *= carry.scale; m[4] *= carry.scale
    m[6] = m[6] * carry.scale + carry.x
    m[7] = m[7] * carry.scale + carry.y
  }
}

/** One step of a damped spring toward `goal`. */
function chase(spring: { value: number; velocity: number }, goal: number, tuning: Readonly<{ frequency: number; damping: number }>, h: number): void {
  const omega = 2 * Math.PI * tuning.frequency
  spring.velocity += (-omega * omega * (spring.value - goal) - 2 * tuning.damping * omega * spring.velocity) * h
  spring.value += spring.velocity * h
}

function copy(from: Readonly<FigureCarry>, out: FigureCarry): FigureCarry {
  out.scale = from.scale
  out.x = from.x
  out.y = from.y
  return out
}

function mix(out: FigureCarry, to: Readonly<FigureCarry>, share: number): FigureCarry {
  out.scale += (to.scale - out.scale) * share
  out.x += (to.x - out.x) * share
  out.y += (to.y - out.y) * share
  return out
}

/** How a layer of a figure takes its lean. */
export function bindFigurePitch(
  baseRole: string,
  layer: Readonly<{ group?: string | null }>,
): FigurePitchBinding {
  if (layer.group === 'head') return { kind: 'head' }
  if (baseRole === 'handwear') return { kind: 'arm' }
  if (NECK_ROLES.has(baseRole)) return { kind: 'neck' }
  if (HEAD_ROLES.has(baseRole)) return { kind: 'head' }
  return { kind: 'trunk' }
}

/** A collar is the chest's: only the neck's skin and what is worn on it go up under the chin with the head. */
const NECK_ROLES = new Set(['neck', 'neckwear'])
/** Parts of the head a package may list with the body. */
const HEAD_ROLES = new Set(['hair', 'front-hair', 'back-hair', 'earwear', 'headwear'])
