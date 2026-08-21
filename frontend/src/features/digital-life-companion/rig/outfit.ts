import type {
  CompanionRigManifest,
  RigOutfitProfile,
  RigOutfitTopology,
  RigTransform,
} from './types'
import { RIG_OUTFIT_SAFETY, RIG_SECONDARY_PART_PATTERNS } from './contract'
import { rigBoneIndexes } from './runtimeIndex'
import { semanticBoneIndex } from './semantics'
import { RIG_OUTFIT_TOPOLOGIES } from './types'

export const OUTFIT_TOPOLOGIES: readonly RigOutfitTopology[] =
  RIG_OUTFIT_TOPOLOGIES

interface OutfitSafetyRule {
  torsoTwistScale: number
  secondaryMotionScale: number
}

interface OutfitSafetyIndex {
  torso: readonly { index: number; scalesTranslationX: boolean }[]
}

const OUTFIT_SAFETY_INDEX = new WeakMap<
  CompanionRigManifest,
  OutfitSafetyIndex
>()

/**
 * One policy table owns topology safety. Importers, audits, and authoring tools
 * must build profiles through this module instead of repeating magic numbers.
 */
export const OUTFIT_SAFETY_RULES = RIG_OUTFIT_SAFETY satisfies Readonly<
  Record<RigOutfitTopology, OutfitSafetyRule>
>

export function createOutfitProfile(
  requestedTopologies: readonly RigOutfitTopology[],
  secondaryPartIds: readonly string[] = [],
): RigOutfitProfile {
  const topologies = uniqueInCanonicalOrder(requestedTopologies)
  if (topologies.length === 0) topologies.push('fitted')
  const rules = topologies.map((topology) => OUTFIT_SAFETY_RULES[topology])
  return {
    topologies,
    secondaryPartIds: [...new Set(secondaryPartIds)],
    torsoTwistScale: Math.min(...rules.map((rule) => rule.torsoTwistScale)),
    secondaryMotionScale: Math.min(
      ...rules.map((rule) => rule.secondaryMotionScale),
    ),
  }
}

export function inferOutfitProfileFromPartIds(
  partIds: readonly string[],
): RigOutfitProfile {
  const ids = partIds.map((id) => id.toLowerCase())
  const has = (...patterns: string[]) =>
    ids.some((id) => patterns.some((pattern) => id.includes(pattern)))
  const topologies: RigOutfitTopology[] = []
  if (has('long-skirt', 'maxi-skirt', 'dress-hem')) {
    topologies.push('long-skirt')
  } else if (has('skirt', 'dress')) {
    topologies.push('short-skirt')
  }
  if (has('coat-tail', 'long-coat', 'trench')) topologies.push('long-coat')
  if (has('wide-sleeve', 'kimono-sleeve', 'bell-sleeve')) {
    topologies.push('wide-sleeve')
  }
  if (has('cape', 'cloak')) topologies.push('cape')
  if (has('armor', 'pauldron', 'plate')) topologies.push('armor')
  return createOutfitProfile(
    topologies,
    partIds.filter(isSecondaryMotionPartId),
  )
}

export function isSecondaryMotionPartId(partId: string): boolean {
  const normalized = partId.toLowerCase()
  return RIG_SECONDARY_PART_PATTERNS.some((pattern) =>
    normalized.includes(pattern),
  )
}

/**
 * Applies the stored asset safety envelope to a fully composed pose.
 * Call exactly once, after every authored and procedural motion layer.
 */
export function applyOutfitSafetyEnvelopeInto(
  pose: RigTransform[],
  manifest: CompanionRigManifest,
  activeMask: readonly boolean[],
  amount = 1,
): boolean {
  const profile = manifest.outfitProfile
  if (!profile || amount <= 0) return false
  let hasActiveBone = false
  for (const active of activeMask) {
    if (!active) continue
    hasActiveBone = true
    break
  }
  if (!hasActiveBone) return false
  const safetyIndex = outfitSafetyIndex(manifest)
  const blend = smootherstep(clamp(amount, 0, 1))
  let applied = false
  const torsoScale = lerp(1, profile.torsoTwistScale ?? 1, blend)
  for (const { index, scalesTranslationX } of safetyIndex.torso) {
    if (!activeMask[index]) continue
    pose[index].rotation *= torsoScale
    if (scalesTranslationX) pose[index].translation.x *= torsoScale
    applied = applied || torsoScale < 0.999
  }
  return applied
}

function outfitSafetyIndex(manifest: CompanionRigManifest): OutfitSafetyIndex {
  const cached = OUTFIT_SAFETY_INDEX.get(manifest)
  if (cached) return cached
  const indexes = rigBoneIndexes(manifest)
  const root = semanticBoneIndex(manifest, 'root') ?? -1
  const result = {
    torso: compactTorsoIndexes(
      root,
      semanticBoneIndex(manifest, 'torso') ?? -1,
      indexes.get('chest') ?? -1,
    ),
  }
  OUTFIT_SAFETY_INDEX.set(manifest, result)
  return result
}

function compactTorsoIndexes(
  root: number,
  torso: number,
  chest: number,
): Array<{ index: number; scalesTranslationX: boolean }> {
  const result: Array<{ index: number; scalesTranslationX: boolean }> = []
  if (root >= 0) result.push({ index: root, scalesTranslationX: false })
  if (torso >= 0) result.push({ index: torso, scalesTranslationX: true })
  if (chest >= 0) result.push({ index: chest, scalesTranslationX: true })
  return result
}

function uniqueInCanonicalOrder(
  requested: readonly RigOutfitTopology[],
): RigOutfitTopology[] {
  const selected = new Set(requested)
  return OUTFIT_TOPOLOGIES.filter((topology) => selected.has(topology))
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount
}

function smootherstep(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
