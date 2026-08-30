import type {
  Anime25DChestProfile,
  Anime25DPlaybackLayer,
  Anime25DTorsoShellProfile,
} from './types'

const HEAD_YAW_SHARE = 0.45
const BODY_YAW_SHARE = 0.1
const YAW_RESPONSE = 2.5
const CHEST_LOBE_CENTER = 0.58
const CHEST_LOBE_RADIUS = 0.62
const CHEST_CENTER_BRIDGE = 0.58
const CHEST_DEPTH_RATIO = 0.34
const CHEST_NEAR_DEPTH_GAIN = 0.35
const CHEST_FAR_DEPTH_GAIN = 0.15
const CHEST_SILHOUETTE_RATIO = 0.065
const MIN_GARMENT_SHAPE_TRANSMISSION = 0.4
const CHEST_FIELD_LIMIT = 1.5
const CHEST_FIELD_FEATHER = 0.28

export type Anime25DTorsoShellMode = 'full' | 'collar'

export interface Anime25DTorsoYawState {
  value: number
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
  if (source.role === 'collar-front' || source.role === 'collar-back') {
    return 'collar'
  }
  if (source.role === 'topwear' || source.role === 'bottomwear') {
    return 'full'
  }
  return null
}

/** Fork-matched ~0.4s torso follow, evaluated once per player frame. */
export function stepAnime25DTorsoShellRotation(
  state: Anime25DTorsoYawState,
  angleX: number,
  body: number,
  deltaSeconds: number,
  target: Anime25DTorsoShellRotation,
): void {
  const yawTarget = angleX * HEAD_YAW_SHARE + body * BODY_YAW_SHARE
  state.value +=
    (yawTarget - state.value) *
    Math.min(1, Math.max(0, deltaSeconds) * YAW_RESPONSE)
  target.active = Math.abs(state.value) > 1e-7
  target.yawCosine = Math.cos(state.value)
  target.yawSine = Math.sin(state.value)
}

/** Adds only rotated-minus-frontal cylinder projection, preserving the rest pose. */
export function deformAnime25DTorsoShellPoint(
  point: Anime25DMutableTorsoPoint,
  profile: Readonly<Anime25DTorsoShellProfile>,
  rotation: Readonly<Anime25DTorsoShellRotation>,
  blend: number,
  chestShape: Readonly<Anime25DTorsoChestShape> | null = null,
): void {
  point.x += torsoShellOffsetX(
    point.x,
    point.y,
    profile,
    rotation,
    blend,
    chestShape,
  )
}

export function anime25DTorsoShellOffsetX(
  pointX: number,
  profile: Readonly<Anime25DTorsoShellProfile>,
  rotation: Readonly<Anime25DTorsoShellRotation>,
  blend: number,
): number {
  return torsoShellOffsetX(pointX, 0, profile, rotation, blend, null)
}

/** Resolve the import-time profile into one immutable runtime shape. */
export function resolveAnime25DTorsoChestShape(
  profile: Readonly<Anime25DChestProfile>,
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
  }
}

function torsoShellOffsetX(
  pointX: number,
  pointY: number,
  profile: Readonly<Anime25DTorsoShellProfile>,
  rotation: Readonly<Anime25DTorsoShellRotation>,
  blend: number,
  chestShape: Readonly<Anime25DTorsoChestShape> | null,
): number {
  if (!profile.enabled || blend <= 0 || !rotation.active) return 0
  const x = pointX - profile.centerX
  const normalizedX = x / profile.radiusX
  let z =
    Math.sqrt(Math.max(0, 1 - Math.min(1, normalizedX * normalizedX))) *
    profile.radiusZ
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
      const verticalWeight = Math.exp(-normalizedChestY * normalizedChestY)
      const lobeX =
        (Math.abs(normalizedChestX) - CHEST_LOBE_CENTER) / CHEST_LOBE_RADIUS
      const bridgeProgress = smoothstep(
        Math.abs(normalizedChestX) / CHEST_LOBE_CENTER,
      )
      const pairedWeight =
        Math.exp(-(lobeX * lobeX)) *
        (CHEST_CENTER_BRIDGE + (1 - CHEST_CENTER_BRIDGE) * bridgeProgress) *
        verticalWeight *
        fieldFade
      const sideGain =
        1 +
        CHEST_NEAR_DEPTH_GAIN * Math.max(0, sideDirection) +
        CHEST_FAR_DEPTH_GAIN * Math.max(0, -sideDirection)
      z +=
        profile.radiusZ *
        CHEST_DEPTH_RATIO *
        chestShape.scale *
        pairedWeight *
        sideGain

      const edge =
        smoothstep((Math.abs(normalizedX) - 0.2) / 0.5) *
        smoothstep((1.18 - Math.abs(normalizedX)) / 0.35)
      silhouetteOffset =
        side *
        profile.radiusX *
        CHEST_SILHOUETTE_RATIO *
        chestShape.scale *
        verticalWeight *
        fieldFade *
        Math.max(0, sideDirection) *
        edge
    }
  }
  const rotatedX = x * rotation.yawCosine + z * rotation.yawSine
  const rotatedZ = -x * rotation.yawSine + z * rotation.yawCosine
  const focalLength = Math.max(1, profile.radiusZ * 6)
  const rotatedScale = focalLength / Math.max(1, focalLength - rotatedZ * 0.5)
  const restScale = focalLength / Math.max(1, focalLength - z * 0.5)
  return (rotatedX * rotatedScale - x * restScale + silhouetteOffset) * blend
}

function smoothstep(value: number): number {
  const bounded = clamp(value, 0, 1)
  return bounded * bounded * (3 - 2 * bounded)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
