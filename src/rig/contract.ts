// The rig contract's versions and limits the importer and the manifest check hold packages to.
import type { CharacterAssetProfile } from '@myriad/figure-player/internals'
import contract from '../../contracts/merope_rig_contract.json' with { type: 'json' }

export const RIG_SCHEMA_VERSION = contract.schemaVersion

export const RIG_IR_VERSION = contract.rigIrVersion

export const MIN_SUPPORTED_RIG_IR_VERSION = contract.minSupportedRigIrVersion

export function isCharacterAssetProfile(
  value: unknown,
): value is CharacterAssetProfile {
  return value === 'bust' || value === 'fullBody'
}

/** Manifests written before the full-body mode carry no profile; they are busts. */
export function characterAssetProfileOf(manifest: {
  profile?: CharacterAssetProfile
}): CharacterAssetProfile {
  return manifest.profile ?? 'bust'
}

export const MAX_RIG_TEXTURES = contract.limits.maxTextures

export const MAX_RIG_VERTICES_PER_PART = contract.limits.maxVerticesPerPart

export const MAX_RIG_TOTAL_VERTICES = contract.limits.maxTotalVertices

export const MAX_RIG_COLLISION_VOLUMES = contract.limits.maxCollisionVolumes

export const RIG_SECONDARY_PART_PATTERNS = contract.secondaryPartPatterns

export const RIG_PRESENTATION_SLOTS = contract.presentationSlots

export const RIG_OUTFIT_SAFETY = contract.outfitSafety
