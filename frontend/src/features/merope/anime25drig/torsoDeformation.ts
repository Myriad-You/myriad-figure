import type { Anime25DPlaybackLayer, Anime25DTorsoShellProfile } from './types'

const HEAD_YAW_SHARE = 0.45
const BODY_YAW_SHARE = 0.1
const YAW_RESPONSE = 2.5

export type Anime25DTorsoShellMode = 'full' | 'collar'

export interface Anime25DTorsoYawState {
  value: number
}

export interface Anime25DTorsoShellRotation {
  active: boolean
  yawCosine: number
  yawSine: number
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
): void {
  point.x += anime25DTorsoShellOffsetX(point.x, profile, rotation, blend)
}

export function anime25DTorsoShellOffsetX(
  pointX: number,
  profile: Readonly<Anime25DTorsoShellProfile>,
  rotation: Readonly<Anime25DTorsoShellRotation>,
  blend: number,
): number {
  if (!profile.enabled || blend <= 0 || !rotation.active) return 0
  const x = pointX - profile.centerX
  const normalizedX = x / profile.radiusX
  const z =
    Math.sqrt(Math.max(0, 1 - Math.min(1, normalizedX * normalizedX))) *
    profile.radiusZ
  const rotatedX = x * rotation.yawCosine + z * rotation.yawSine
  const rotatedZ = -x * rotation.yawSine + z * rotation.yawCosine
  const focalLength = Math.max(1, profile.radiusZ * 6)
  const rotatedScale = focalLength / Math.max(1, focalLength - rotatedZ * 0.5)
  const restScale = focalLength / Math.max(1, focalLength - z * 0.5)
  return (rotatedX * rotatedScale - x * restScale) * blend
}
