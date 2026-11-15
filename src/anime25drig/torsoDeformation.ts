import type { ChestSpatialField } from './chestPhysics'
import type {
  Anime25DChestProfile,
  Anime25DPlaybackLayer,
  Anime25DShellProfile,
  Anime25DTorsoShellProfile,
} from './types'
import {
  chestDeformationWeight,
  resolveChestSpatialField,
} from './chestPhysics'

export const HEAD_YAW_SHARE = 0.45
const BODY_YAW_SHARE = 0.1
/**
 * A standing figure turns with its sway: at its rig's full range (`body` = ±1)
 * it is turned about 20 degrees toward the leg it goes over, legs and all,
 * rather than sliding sideways. A look carries its torso round by a share of
 * a bust's follow: its whole cylinder shows the turn, where a bust's shows a
 * quarter of it. Its automatic turn stays within FIGURE_MAX_YAW.
 */
export const FIGURE_BODY_YAW = 0.35
const FIGURE_LOOK_SHARE = 0.2
const FIGURE_MAX_YAW = 0.45
// ~0.4 s to 95% for a held target, with continuous position AND velocity.
const YAW_ANGULAR_FREQUENCY = 12
const MIN_GARMENT_SHAPE_TRANSMISSION = 0.4

export const SLEEVE_TORSO_TRANSMISSION = 0.85

/**
 * A standing figure's trunk, as a drawn turn of the figure shows it: the
 * front of the chest and skirt travels across while the head, the arms and
 * the legs hold near the turn's axis, the way an anime three-quarter view
 * draws the body's middle line over toward its far side. Its cylinder is this
 * deep for its half-width (a bust's guess from the face is shallower); the
 * neck stands this share of the way out to the chest's front. Measured on a
 * drawn 28° turn: chest and skirt +69 px, arms, head and legs +8 to +28.
 * (Its arms and legs are columns of their own about that axis: figureColumns.)
 */
const FIGURE_TORSO_DEPTH = 0.75
const FIGURE_NECK_DEPTH = 0.25
/** A sleeve lies over the body out to this many half-widths, letting go over the last share of it. */
const FIGURE_BODY_EDGE = 1.25
const FIGURE_BODY_EDGE_FADE = 0.3

export const SLEEVE_ANCHOR_LIMIT = 0.8

const CHEST_FIELD_LIMIT = 1.5
const CHEST_FIELD_FEATHER = 0.28

export type Anime25DTorsoShellMode = 'full' | 'collar' | 'sleeve' | 'neck'

export interface Anime25DTorsoYawState {
  value: number
  velocity: number
}

export interface Anime25DTorsoShellRotation {
  active: boolean
  yawCosine: number
  yawSine: number
}

export interface Anime25DTorsoChestShape {
  centerX: number
  centerY: number
  radiusX: number
  radiusY: number
  scale: number
  field: Readonly<ChestSpatialField>
}

export interface Anime25DMutableTorsoPoint {
  x: number
  y: number
}

export function anime25DLayerUsesTorsoShell(
  source: Pick<Anime25DPlaybackLayer, 'group' | 'role'>,
): boolean {
  return anime25DTorsoShellModeForLayer(source) !== null
}

export function anime25DTorsoShellModeForLayer(
  source: Pick<Anime25DPlaybackLayer, 'group' | 'role'>,
): Anime25DTorsoShellMode | null {
  if (source.group !== 'body') return null
  if (source.role === 'neck') return 'neck'
  if (source.role === 'collar-front' || source.role === 'collar-back') {
    return 'collar'
  }
  if (source.role === 'topwear' || source.role === 'bottomwear') {
    return 'full'
  }
  if (source.role === 'handwear') return 'sleeve'
  return null
}

export function anime25DTorsoYawFollow(
  profile: Readonly<Pick<Anime25DTorsoShellProfile, 'yawFollowScale'>>,
  bodyYaw: number,
): number {
  const authored = profile.yawFollowScale
  return (
    clamp(Number.isFinite(authored) ? (authored as number) : 1, 0, 1) *
    clamp(Number.isFinite(bodyYaw) ? bodyYaw : 1, 0, 1)
  )
}

export function stepAnime25DTorsoShellRotation(
  state: Anime25DTorsoYawState,
  angleX: number,
  body: number,
  deltaSeconds: number,
  target: Anime25DTorsoShellRotation,
  yawFollowScale = 1,
  directedTurn = 0,
  directedShare = 0,
  bodyShare = BODY_YAW_SHARE,
): void {
  const follow = Number.isFinite(yawFollowScale)
    ? clamp(yawFollowScale, 0, 1)
    : 1
  const share = clamp(Number.isFinite(directedShare) ? directedShare : 0, 0, 1)
  // Only automatic head/body follow has this spring. The directed contribution
  // already has authority and a continuous response in the composer.
  const figure = bodyShare !== BODY_YAW_SHARE
  const raw = angleX * HEAD_YAW_SHARE * follow * (figure ? FIGURE_LOOK_SHARE : 1) + body * bodyShare
  const yawTarget = figure ? Math.max(-FIGURE_MAX_YAW, Math.min(FIGURE_MAX_YAW, raw)) : raw
  if (Number.isFinite(deltaSeconds) && deltaSeconds > 0 && Number.isFinite(yawTarget)) {
    // Exact critically damped response; see The Orange Duck's Spring-Roll-Call.
    // Carry velocity through a new goal instead of starting another easing.
    const displacement = state.value - yawTarget
    const coefficient = state.velocity + YAW_ANGULAR_FREQUENCY * displacement
    const decay = Math.exp(-YAW_ANGULAR_FREQUENCY * deltaSeconds)
    state.value = yawTarget + (displacement + coefficient * deltaSeconds) * decay
    state.velocity = (state.velocity - YAW_ANGULAR_FREQUENCY * coefficient * deltaSeconds) * decay
  }
  const yaw = state.value * (1 - share)
    + clamp(Number.isFinite(directedTurn) ? directedTurn : 0, -1, 1) * HEAD_YAW_SHARE
  target.active = Math.abs(yaw) > 1e-7
  target.yawCosine = Math.cos(yaw)
  target.yawSine = Math.sin(yaw)
}

/** Adds only rotated-minus-frontal cylinder projection, preserving the rest pose. */
export function deformAnime25DTorsoShellPoint(
  point: Anime25DMutableTorsoPoint,
  profile: Readonly<Anime25DTorsoShellProfile>,
  rotation: Readonly<Anime25DTorsoShellRotation>,
  blend: number,
  chestShape: Readonly<Anime25DTorsoChestShape> | null = null,
  chestSkinWeight = 1,
  chestVolumeScale = 1,
  depthScale = 1,
): void {
  point.x += torsoShellOffsetX(
    point.x,
    point.y,
    profile,
    rotation,
    blend,
    chestShape,
    chestSkinWeight,
    chestVolumeScale,
    depthScale,
  )
}

export function anime25DSleeveAnchorX(
  anchorX: number,
  profile: Readonly<Anime25DTorsoShellProfile>,
): number {
  const radiusX = Math.max(1, profile.radiusX)
  const normalized = (anchorX - profile.centerX) / radiusX
  return (
    profile.centerX +
    clamp(normalized, -SLEEVE_ANCHOR_LIMIT, SLEEVE_ANCHOR_LIMIT) * radiusX
  )
}

/** A standing figure's shell: its trunk FIGURE_TORSO_DEPTH deep, its neck near the axis. */
export function figureShellProfile(profile: Readonly<Anime25DShellProfile>): Anime25DShellProfile {
  const torso = { ...profile.torso, radiusZ: profile.torso.radiusX * FIGURE_TORSO_DEPTH, neckDepth: FIGURE_NECK_DEPTH }
  return { ...profile, torso }
}

/** How far the turn carries the neck, and the head on it, across. */
export function anime25DTorsoNeckOffsetX(
  neckX: number,
  profile: Readonly<Anime25DTorsoShellProfile>,
  rotation: Readonly<Anime25DTorsoShellRotation>,
  blend: number,
): number {
  return torsoShellOffsetX(neckX, 0, profile, rotation, blend, null, 1, 1, profile.neckDepth ?? 1)
}

/**
 * How far out a standing figure's front stands at `restY`, as a share of its
 * trunk's depth: at the neck's foot, only as far as the neck (neckDepth), so
 * the neck, the choker on it and the collar round it turn together; down to
 * the chest's middle it comes out to the whole depth, where the chest turns
 * out the most. 1 for a bust, whose front is all the same depth.
 */
export function figureFrontDepth(
  profile: Readonly<Anime25DTorsoShellProfile>,
  restY: number,
  neckBottom: number,
  chestY: number,
): number {
  const neck = profile.neckDepth
  if (neck === undefined) return 1
  return neck + (1 - neck) * smoothstep((restY - neckBottom) / Math.max(1, chestY - neckBottom))
}

/**
 * Moves a point `share` of the way the torso's cylinder takes it, as a
 * standing figure's (its front standing out by figureFrontDepth); returns
 * the share. For a part turned by its key that gives way to the cylinder
 * where it meets the torso.
 */
export function addTorsoShellShare(
  point: Anime25DMutableTorsoPoint,
  share: number,
  frame: Readonly<{
    torsoProfile: Readonly<Anime25DTorsoShellProfile>
    torsoShellRotation: Readonly<Anime25DTorsoShellRotation>
    torsoShellBlend: number
    chestVolumeScale: number
    neckBottom: number
    chestRegionCenterY: number
  }>,
  restY: number,
): number {
  if (share <= 0) return 0
  const x = point.x
  const y = point.y
  deformAnime25DTorsoShellPoint(point, frame.torsoProfile, frame.torsoShellRotation, frame.torsoShellBlend, null, 1,
    frame.chestVolumeScale, figureFrontDepth(frame.torsoProfile, restY, frame.neckBottom, frame.chestRegionCenterY))
  point.x = x + (point.x - x) * share
  point.y = y + (point.y - y) * share
  return share
}

/** A sleeve drawn behind the body's clothing gives up the body's surface for its own column over this much of the turn's sine. */
const FIGURE_SLEEVE_BEHIND = 0.12

/**
 * A standing figure's sleeve, horizontally: clear of the body it is the arm's
 * own column going round with its shoulder (`column`, how far that takes
 * this point: figureColumns). Over the body it lies on the cylinder like the
 * garment under it, so their seam holds and nothing never drawn shows at its
 * inner edge. But drawn behind the body's clothing (`behindAt`: the middle of
 * such an arm, which says the side it is on), it does so only on the side
 * turned toward the viewer, where the body's front draws away from it: on the
 * far side the front comes over it, and held to that the sleeve was squeezed
 * to half its width instead of going behind.
 */
export function figureSleeveOffsetX(
  restX: number,
  column: number,
  profile: Readonly<Anime25DTorsoShellProfile>,
  rotation: Readonly<Anime25DTorsoShellRotation>,
  blend: number,
  depthScale = 1,
  behindAt?: number,
): number {
  const out = Math.abs(restX - profile.centerX) / Math.max(1, profile.radiusX)
  const clear = clamp((out - (FIGURE_BODY_EDGE - FIGURE_BODY_EDGE_FADE)) / FIGURE_BODY_EDGE_FADE, 0, 1)
  // (The whole arm by the side it is on, not each point by its own: a sleeve reaching across the middle
  // would be torn there. And eased in with the turn, so nothing snaps as the figure turns through the front.)
  const behind = behindAt === undefined ? 0 : smoothstep((Math.sign(behindAt - profile.centerX) * rotation.yawSine) / FIGURE_SLEEVE_BEHIND)
  const own = Math.max(clear, behind)
  if (own >= 1) return column
  const onBody = torsoShellOffsetX(restX, 0, profile, rotation, blend, null, 1, 1, depthScale)
  return onBody + (column - onBody) * own
}

export function anime25DTorsoShellOffsetX(
  pointX: number,
  profile: Readonly<Anime25DTorsoShellProfile>,
  rotation: Readonly<Anime25DTorsoShellRotation>,
  blend: number,
  depthScale = 1,
): number {
  return torsoShellOffsetX(pointX, 0, profile, rotation, blend, null, 1, 1, depthScale)
}

export function resolveAnime25DTorsoChestShape(
  profile: Readonly<Anime25DChestProfile>,
  field: Readonly<ChestSpatialField> = resolveChestSpatialField(profile),
): Anime25DTorsoChestShape | null {
  if (!profile.enabled) return null
  const visible = smoothstep(clamp(profile.visibleScale, 0, 1))
  const garment =
    MIN_GARMENT_SHAPE_TRANSMISSION +
    (1 - MIN_GARMENT_SHAPE_TRANSMISSION) *
      Math.sqrt(clamp(profile.garmentMotionScale, 0, 1))
  const scale = visible * garment
  if (scale <= 1e-6) return null
  return {
    centerX: profile.centerX,
    centerY: profile.centerY,
    radiusX: Math.max(1, profile.radiusX),
    radiusY: Math.max(1, profile.radiusY),
    scale,
    field,
  }
}

function torsoShellOffsetX(
  pointX: number,
  pointY: number,
  profile: Readonly<Anime25DTorsoShellProfile>,
  rotation: Readonly<Anime25DTorsoShellRotation>,
  blend: number,
  chestShape: Readonly<Anime25DTorsoChestShape> | null,
  chestSkinWeight = 1,
  chestVolumeScale = 1,
  depthScale = 1,
): number {
  if (!profile.enabled || blend <= 0 || !rotation.active) return 0
  const x = pointX - profile.centerX
  const normalizedX = x / profile.radiusX
  let z = (profile.neckDepth === undefined
    ? Math.sqrt(Math.max(0, 1 - Math.min(1, normalizedX * normalizedX)))
    : figureRound(Math.abs(normalizedX))) * profile.radiusZ * depthScale
  let silhouetteOffset = 0
  if (chestShape) {
    const normalizedChestX = (pointX - chestShape.centerX) / chestShape.radiusX
    const normalizedChestY = (pointY - chestShape.centerY) / chestShape.radiusY
    const fieldDistance = Math.max(
      Math.abs(normalizedChestX),
      Math.abs(normalizedChestY),
    )
    if (fieldDistance < CHEST_FIELD_LIMIT) {
      const direction = clamp(rotation.yawSine * 4, -1, 1)
      const side = normalizedChestX < 0 ? -1 : 1
      const sideDirection = side * direction
      const fieldFade = smoothstep(
        (CHEST_FIELD_LIMIT - fieldDistance) / CHEST_FIELD_FEATHER,
      )
      const pairedWeight =
        chestDeformationWeight(
          chestShape.field,
          normalizedChestX,
          normalizedChestY,
          chestSkinWeight,
        ) * fieldFade
      const sideGain =
        1 +
        chestShape.field.nearDepthGain * Math.max(0, sideDirection) +
        chestShape.field.farDepthGain * Math.max(0, -sideDirection)
      z +=
        profile.radiusZ *
        chestShape.field.depthRatio *
        chestShape.scale *
        clamp(chestVolumeScale, 0.9, 1.1) *
        pairedWeight *
        sideGain

      const edge =
        smoothstep((Math.abs(normalizedX) - 0.2) / 0.5) *
        smoothstep((1.18 - Math.abs(normalizedX)) / 0.35)
      silhouetteOffset =
        side *
        profile.radiusX *
        chestShape.field.silhouetteRatio *
        chestShape.scale *
        pairedWeight *
        fieldFade *
        Math.max(0, sideDirection) *
        edge
    }
  }
  return (turnedX(x, z, profile, rotation) + silhouetteOffset) * blend
}

/**
 * A standing figure's cylinder falls away to its edge no steeper than it does at FIGURE_EDGE_FROM of its
 * half-width, and on at that slope a little past the edge. A circle's side is upright at its edge: turned
 * the full way of a figure's turn, the clothing drawn there on the far side was carried across faster than
 * it is wide, and folded over itself.
 */
const FIGURE_EDGE_FROM = 0.86
function figureRound(across: number): number {
  const height = Math.sqrt(1 - FIGURE_EDGE_FROM * FIGURE_EDGE_FROM)
  if (across <= FIGURE_EDGE_FROM) return Math.sqrt(1 - across * across)
  return Math.max(0, height - (across - FIGURE_EDGE_FROM) * (FIGURE_EDGE_FROM / height))
}

/** How far across a point `x` from the turn's axis and `z` out toward the viewer shows once turned. */
function turnedX(x: number, z: number, profile: Readonly<Anime25DTorsoShellProfile>, rotation: Readonly<Anime25DTorsoShellRotation>): number {
  const rotatedX = x * rotation.yawCosine + z * rotation.yawSine
  const rotatedZ = -x * rotation.yawSine + z * rotation.yawCosine
  const focalLength = Math.max(1, profile.radiusZ * 6)
  const rotatedScale = focalLength / Math.max(1, focalLength - rotatedZ * 0.5)
  const restScale = focalLength / Math.max(1, focalLength - z * 0.5)
  return rotatedX * rotatedScale - x * restScale
}

/** How much larger (or smaller) what is `x` from the turn's axis shows once turned, for being nearer (or further). */
export function anime25DTurnedScale(x: number, profile: Readonly<Anime25DTorsoShellProfile>, rotation: Readonly<Anime25DTorsoShellRotation>): number {
  if (!profile.enabled || !rotation.active) return 1
  const focalLength = Math.max(1, profile.radiusZ * 6)
  return focalLength / Math.max(1, focalLength + x * rotation.yawSine * 0.5)
}

/**
 * The same for what is not on the torso's cylinder but turns about its axis with it (a limb's column,
 * figureColumns): `x` from the axis, standing `z` out toward the viewer.
 */
export function anime25DTurnedOffsetX(
  x: number,
  z: number,
  profile: Readonly<Anime25DTorsoShellProfile>,
  rotation: Readonly<Anime25DTorsoShellRotation>,
  blend: number,
): number {
  if (!profile.enabled || blend <= 0 || !rotation.active) return 0
  return turnedX(x, z, profile, rotation) * blend
}

function smoothstep(value: number): number {
  const bounded = clamp(value, 0, 1)
  return bounded * bounded * (3 - 2 * bounded)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
