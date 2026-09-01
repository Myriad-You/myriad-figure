import type { Anime25DDriver } from './driver'

export interface Anime25DMotionEnvelopeProfile {
  highCollar: boolean
  armMotion: boolean
}

export interface Anime25DMotionEnvelopeResult {
  clippedEnergy: number
  transferredEnergy: number
}

/**
 * Projects the composed pose into an asset-safe joint envelope. Energy that a
 * high collar cannot safely carry as pitch is moved into yaw, roll, gaze,
 * torso and available sleeve motion instead of globally damping the gesture.
 */
export function projectAnime25DMotionEnvelope(
  target: Anime25DDriver,
  profile: Readonly<Anime25DMotionEnvelopeProfile>,
  result: Anime25DMotionEnvelopeResult,
): Anime25DMotionEnvelopeResult {
  result.clippedEnergy = 0
  result.transferredEnergy = 0
  const pitchStart = profile.highCollar ? 0.56 : 0.82
  const pitchLimit = profile.highCollar ? 0.8 : 1
  const originalPitch = finite(target.angleY)
  const safePitch = softLimitSigned(originalPitch, pitchStart, pitchLimit)
  const residual = originalPitch - safePitch
  target.angleY = safePitch
  result.clippedEnergy = Math.abs(residual)
  if (Math.abs(residual) <= 1e-6) return result

  const side = preferredSide(target)
  const amount = Math.abs(residual)
  target.angleX = clamp(target.angleX + side * amount * 0.34, -1, 1)
  target.angleZ = clamp(target.angleZ + side * amount * 0.2, -1, 1)
  target.eyeX = clamp(target.eyeX + side * amount * 0.16, -1, 1)
  target.eyeY = clamp(target.eyeY + Math.sign(residual) * amount * 0.12, -1, 1)
  target.body = clamp(target.body + Math.sign(residual) * amount * 0.26, -1, 1)
  if (profile.armMotion) {
    target.armY = clamp(target.armY + amount * 0.24, -1, 1)
    target.armPos = clamp(target.armPos + side * amount * 0.18, -1, 1)
  }
  result.transferredEnergy = amount
  return result
}

function preferredSide(target: Readonly<Anime25DDriver>): -1 | 1 {
  const hint = target.angleZ * 0.7 + target.angleX * 0.3
  return hint < 0 ? -1 : 1
}

function softLimitSigned(value: number, startsAt: number, limit: number): number {
  const sign = value < 0 ? -1 : 1
  const amount = Math.abs(value)
  if (amount <= startsAt) return value
  const headroom = Math.max(1e-6, limit - startsAt)
  const excess = amount - startsAt
  const compressed = (excess * headroom) / (excess + headroom)
  return sign * Math.min(limit, startsAt + compressed)
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
