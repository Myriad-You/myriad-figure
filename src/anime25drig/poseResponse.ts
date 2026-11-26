// How fast a performed pose is let move: the response scale from the behaviours that move it.
import type { BehaviorQuality } from '../motion/behavior'
import { MAX_RESPONSE_SCALE, MIN_RESPONSE_SCALE } from '@myriad-you/figure-player/internals'

export function poseResponseScale(
  quality: Readonly<BehaviorQuality>,
): number {
  const tempo = clamp(finiteOr(quality.tempo, 1), 0.45, 1.7)
  const directness = clamp(finiteOr(quality.directness, 0.72), 0.2, 1.4)
  const fluidity = clamp(finiteOr(quality.fluidity, 0.8), 0.2, 1.4)
  const power = clamp(finiteOr(quality.power, 1), 0.2, 1.6)
  return clamp(
    1 +
      (tempo - 1) * 0.34 +
      (directness - 0.72) * 0.3 +
      (power - 1) * 0.16 -
      (fluidity - 0.8) * 0.28,
    MIN_RESPONSE_SCALE,
    MAX_RESPONSE_SCALE,
  )
}

export interface PoseResponseCandidate {
  weight: number
  quality: Readonly<BehaviorQuality> | null
}

/** The response filter runs on the blended result, so it cannot take a manner per source. */
export function resolvePoseResponseScale(
  candidates: readonly PoseResponseCandidate[],
): number {
  let total = 0
  let weighted = 0
  for (const candidate of candidates) {
    if (!candidate.quality) continue
    const weight = clamp(finiteOr(candidate.weight, 0), 0, 1)
    if (weight <= 0) continue
    total += weight
    weighted += weight * poseResponseScale(candidate.quality)
  }
  if (total <= 0) return 1
  // Sources never sum to the whole pose
  const share = Math.min(1, total)
  return 1 + (weighted / total - 1) * share
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum
  return Math.max(minimum, Math.min(maximum, value))
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
