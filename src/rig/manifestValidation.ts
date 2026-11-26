import type { MeropeRigManifest } from '@myriad/figure-player'
import type { RigBone, RigMotionProfile, RigOutfitProfile, RigOutfitTopology, RigPoint, RigSemantics, RigSize, RigSpatialProfile, RigVertex } from '@myriad/figure-player/internals'
import { isAnime25DPlayback } from '@myriad/figure-player'
import { CHARACTER_ASSET_PROFILES, everyItem, MAX_RIG_BONES, MAX_RIG_PARTS, RIG_OUTFIT_TOPOLOGIES, RIG_SEMANTIC_BONE_ROLES, RIG_SEMANTIC_CHAIN_ROLES } from '@myriad/figure-player/internals'
import { fringeFits } from '../anime25drig/playbackValidation'
import { characterAssetProfileOf, isCharacterAssetProfile, MAX_RIG_COLLISION_VOLUMES, MAX_RIG_TEXTURES, MAX_RIG_TOTAL_VERTICES, MAX_RIG_VERTICES_PER_PART, MIN_SUPPORTED_RIG_IR_VERSION, RIG_IR_VERSION, RIG_PRESENTATION_SLOTS, RIG_SCHEMA_VERSION } from './contract'

/** Ids come from a PSD's layer names, which hold 255 characters, with a few put before and after. */
const MAX_IDENTIFIER = 512
const MAX_URL = 2048
/** What the server writes where a preview's atlas would be: the page holds that picture itself and loads no address. */
const PREVIEW_ATLAS_URL = 'preview://rig-atlas'
/** The server's own limit on a slot's and a variant's name, and on an anchor's. */
const MAX_TAG = 64
const MAX_SEMANTIC_ANCHORS = 128
const MAX_EDGE = 16_384
/** A place on the canvas or in a texture: far past any canvas, and whole in a Float32Array. */
const MAX_COORDINATE = 65_536
/** A mesh of n vertices has fewer than 2n triangles. */
const MAX_INDICES_PER_PART = MAX_RIG_VERTICES_PER_PART * 6

export function isLiveMeropeManifest(
  value: unknown,
): value is MeropeRigManifest {
  return (
    isRigManifest(value) &&
    value.quality === 'layered-2d' &&
    isAnime25DPlayback(value.anime25dPlayback)
  )
}

/** Same atlas + contract → keep the mounted player instead of tearing WebGL down. */
export function sameLiveFaceRuntime(
  current: MeropeRigManifest | null | undefined,
  next: MeropeRigManifest | null | undefined,
): boolean {
  if (current === next) return true
  if (!current || !next) return false
  return (
    current.textures[0]?.url === next.textures[0]?.url &&
    current.sourceMasterAssetId === next.sourceMasterAssetId &&
    characterAssetProfileOf(current) === characterAssetProfileOf(next) &&
    current.characterAssetContractVersion ===
      next.characterAssetContractVersion
  )
}

export function isRigManifest(value: unknown): value is MeropeRigManifest {
  if (!isRecord(value)) return false
  if (
    value.schemaVersion !== RIG_SCHEMA_VERSION ||
    value.quality !== 'layered-2d' ||
    !isPositiveSize(value.canvas) ||
    !Array.isArray(value.textures) ||
    !Array.isArray(value.bones) ||
    !Array.isArray(value.parts) ||
    value.clips != null ||
    value.defaultClip != null ||
    value.standardClipLibraryVersion != null ||
    value.bones.length === 0 ||
    value.bones.length > MAX_RIG_BONES ||
    value.textures.length === 0 ||
    value.textures.length > MAX_RIG_TEXTURES ||
    value.parts.length === 0 ||
    value.parts.length > MAX_RIG_PARTS
  ) {
    return false
  }
  if (
    value.rigIrVersion !== undefined &&
    (typeof value.rigIrVersion !== 'number' ||
      !Number.isInteger(value.rigIrVersion) ||
      value.rigIrVersion < MIN_SUPPORTED_RIG_IR_VERSION ||
      value.rigIrVersion > RIG_IR_VERSION)
  ) {
    return false
  }
  if (value.profile !== undefined && !isCharacterAssetProfile(value.profile)) {
    return false
  }
  if (
    value.characterAssetContractVersion !== undefined &&
    value.characterAssetContractVersion !==
      CHARACTER_ASSET_PROFILES[value.profile ?? 'bust'].contractVersion
  ) {
    return false
  }
  if (
    value.sourceMasterAssetId !== undefined &&
    (typeof value.sourceMasterAssetId !== 'string' ||
      value.sourceMasterAssetId.trim() === '' ||
      value.sourceMasterAssetId.length > MAX_IDENTIFIER)
  ) {
    return false
  }
  if (
    value.sourceGenerationFingerprint !== undefined &&
    (typeof value.sourceGenerationFingerprint !== 'string' ||
      !/^[0-9a-f]{64}$/iu.test(value.sourceGenerationFingerprint))
  ) {
    return false
  }
  if (
    value.motionProfile !== undefined &&
    !isMotionProfile(value.motionProfile)
  ) {
    return false
  }
  if (
    value.outfitProfile !== undefined &&
    !isOutfitProfile(value.outfitProfile, value.parts)
  ) {
    return false
  }
  const playback = value.anime25dPlayback
  if (playback !== undefined && !isAnime25DPlayback(playback)) return false
  const textures = value.textures
  const bones = value.bones
  const parts = value.parts
  const textureIds = new Set<string>()
  for (const texture of textures) {
    if (
      !isRecord(texture) ||
      !addIdentifier(textureIds, texture.id) ||
      !isOwnTextureUrl(texture.url) ||
      !isPositiveSize(texture)
    ) {
      return false
    }
  }
  if (
    playback !== undefined &&
    !textures.every((texture) => fringeFits(playback.layers, texture))
  ) {
    return false
  }
  const boneIds = new Set<string>()
  for (const bone of bones) {
    if (
      !isRecord(bone) ||
      !addIdentifier(boneIds, bone.id) ||
      !(bone.parent === null || typeof bone.parent === 'string') ||
      !isPoint(bone.pivot)
    ) {
      return false
    }
  }
  if (
    bones.some((bone) => bone.parent !== null && !boneIds.has(bone.parent)) ||
    hasBoneCycle(bones)
  ) {
    return false
  }
  if (
    value.semanticAnchors !== undefined &&
    (!isRecord(value.semanticAnchors) ||
      Object.keys(value.semanticAnchors).length > MAX_SEMANTIC_ANCHORS ||
      Object.entries(value.semanticAnchors).some(
        ([name, anchor]) =>
          name.length === 0 ||
          name.length > MAX_TAG ||
          !isRecord(anchor) ||
          typeof anchor.boneId !== 'string' ||
          !boneIds.has(anchor.boneId) ||
          !isPoint(anchor.offset),
      ))
  ) {
    return false
  }
  if (
    value.semantics !== undefined &&
    !isRigSemantics(value.semantics, bones)
  ) {
    return false
  }
  if (
    value.spatialProfile !== undefined &&
    !isSpatialProfile(value.spatialProfile, boneIds, value.canvas)
  ) {
    return false
  }
  if (
    value.rigIrVersion !== undefined &&
    (value.semantics === undefined || value.spatialProfile === undefined)
  ) {
    return false
  }
  const partIds = new Set<string>()
  const variantsBySlot = new Map<string, Set<string>>()
  let totalVertices = 0
  for (const part of parts) {
    if (
      !isRecord(part) ||
      !addIdentifier(partIds, part.id) ||
      typeof part.textureId !== 'string' ||
      !textureIds.has(part.textureId) ||
      !isCoordinate(part.zIndex) ||
      !isUnitNumber(part.opacity) ||
      (part.slot !== undefined && !isTag(part.slot)) ||
      (part.variant !== undefined && !isTag(part.variant)) ||
      (part.slot === undefined) !== (part.variant === undefined) ||
      !Array.isArray(part.vertices) ||
      !Array.isArray(part.indices) ||
      part.vertices.length < 3 ||
      part.vertices.length > MAX_RIG_VERTICES_PER_PART ||
      part.indices.length < 3 ||
      part.indices.length > MAX_INDICES_PER_PART ||
      part.indices.length % 3 !== 0
    ) {
      return false
    }
    if (
      value.rigIrVersion === RIG_IR_VERSION &&
      part.slot !== undefined &&
      part.variant !== undefined
    ) {
      // Its own slots only: 'constructor' names something on every object.
      const definition = Object.hasOwn(RIG_PRESENTATION_SLOTS, part.slot)
        ? (
            RIG_PRESENTATION_SLOTS as Record<
              string,
              { fallback: string; variants: readonly string[] }
            >
          )[part.slot]
        : undefined
      if (!definition || !definition.variants.includes(part.variant)) {
        return false
      }
      const variants = variantsBySlot.get(part.slot) ?? new Set<string>()
      variants.add(part.variant)
      variantsBySlot.set(part.slot, variants)
    }
    const vertices = part.vertices
    const indices = part.indices
    totalVertices += vertices.length
    if (totalVertices > MAX_RIG_TOTAL_VERTICES) return false
    if (
      !everyItem(vertices, (vertex) => isVertex(vertex, bones.length)) ||
      !everyItem(
        indices,
        (index) =>
          typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < vertices.length,
      )
    ) {
      return false
    }
  }
  for (const [slot, variants] of variantsBySlot) {
    const definition = (
      RIG_PRESENTATION_SLOTS as Record<string, { fallback: string }>
    )[slot]
    if (!variants.has(definition.fallback)) return false
  }
  return true
}

function isMotionProfile(value: unknown): value is RigMotionProfile {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.seed) ||
    (value.seed as number) < 0 ||
    (value.seed as number) > 4_294_967_295 ||
    !isRecord(value.breath) ||
    !isRecord(value.blink) ||
    !isRecord(value.secondary)
  ) {
    return false
  }
  const breath = value.breath
  const blink = value.blink
  const secondary = value.secondary
  return (
    isNumberInRange(breath.minFrequencyHz, 0.05, 2) &&
    isNumberInRange(
      breath.maxFrequencyHz,
      breath.minFrequencyHz as number,
      2,
    ) &&
    isNumberInRange(breath.amplitude, 0, 0.05) &&
    isNumberInRange(blink.minIntervalSeconds, 0.5, 30) &&
    isNumberInRange(
      blink.maxIntervalSeconds,
      blink.minIntervalSeconds as number,
      30,
    ) &&
    isNumberInRange(blink.durationSeconds, 0.05, 1) &&
    isUnitNumber(blink.doubleChance) &&
    typeof secondary.enabled === 'boolean' &&
    isNumberInRange(secondary.frequencyHz, 0.1, 12) &&
    isNumberInRange(secondary.dampingRatio, 0.05, 3) &&
    isNumberInRange(secondary.response, 0, 2)
  )
}

function isRigSemantics(
  value: unknown,
  bones: RigBone[],
): value is RigSemantics {
  if (
    !isRecord(value) ||
    !isRecord(value.bones) ||
    !isRecord(value.chains) ||
    !Array.isArray(value.secondaryBoneIds)
  ) {
    return false
  }
  const boneIds = new Set(bones.map((bone) => bone.id))
  const roles = new Set<string>(RIG_SEMANTIC_BONE_ROLES)
  const chainRoles = new Set<string>(RIG_SEMANTIC_CHAIN_ROLES)
  if (
    Object.entries(value.bones).some(
      ([role, boneId]) =>
        !roles.has(role) || typeof boneId !== 'string' || !boneIds.has(boneId),
    ) ||
    Object.entries(value.chains).some(
      ([role, chain]) =>
        !chainRoles.has(role) ||
        !Array.isArray(chain) ||
        chain.length < 2 ||
        chain.length > bones.length ||
        new Set(chain).size !== chain.length ||
        !everyItem(
          chain,
          (boneId) => typeof boneId === 'string' && boneIds.has(boneId),
        ) ||
        !isConnectedBoneChain(chain as string[], bones),
    ) ||
    value.secondaryBoneIds.length > bones.length ||
    new Set(value.secondaryBoneIds).size !== value.secondaryBoneIds.length ||
    !everyItem(
      value.secondaryBoneIds,
      (boneId) => typeof boneId === 'string' && boneIds.has(boneId),
    )
  ) {
    return false
  }
  return true
}

function isConnectedBoneChain(chain: string[], bones: RigBone[]): boolean {
  const parents = new Map(bones.map((bone) => [bone.id, bone.parent]))
  return chain.slice(1).every((boneId, index) => {
    const previous = chain[index]
    return parents.get(boneId) === previous || parents.get(previous) === boneId
  })
}

function isSpatialProfile(
  value: unknown,
  boneIds: Set<string>,
  canvas: RigSize,
): value is RigSpatialProfile {
  if (!isRecord(value) || !Array.isArray(value.collisionVolumes)) return false
  if (value.collisionVolumes.length > MAX_RIG_COLLISION_VOLUMES) return false
  const ids = new Set<string>()
  return everyItem(
    value.collisionVolumes,
    (volume) =>
      isRecord(volume) &&
      addIdentifier(ids, volume.id) &&
      typeof volume.boneId === 'string' &&
      boneIds.has(volume.boneId) &&
      isPoint(volume.offset) &&
      isPoint(volume.radius) &&
      volume.radius.x > 0 &&
      volume.radius.y > 0 &&
      volume.radius.x <= canvas.width &&
      volume.radius.y <= canvas.height &&
      Math.abs(volume.offset.x) <= canvas.width * 2 &&
      Math.abs(volume.offset.y) <= canvas.height * 2 &&
      isNumberInRange(volume.padding, 0, Math.max(canvas.width, canvas.height)),
  )
}

function isOutfitProfile(
  value: unknown,
  parts: unknown[],
): value is RigOutfitProfile {
  if (!isRecord(value)) return false
  const topologies = new Set<RigOutfitTopology>(RIG_OUTFIT_TOPOLOGIES)
  const partIds = new Set(
    parts.flatMap((part) =>
      isRecord(part) && typeof part.id === 'string' ? [part.id] : [],
    ),
  )
  return (
    Array.isArray(value.topologies) &&
    value.topologies.length > 0 &&
    value.topologies.length <= topologies.size &&
    new Set(value.topologies).size === value.topologies.length &&
    everyItem(
      value.topologies,
      (topology) =>
        typeof topology === 'string' &&
        topologies.has(topology as RigOutfitTopology),
    ) &&
    Array.isArray(value.secondaryPartIds) &&
    value.secondaryPartIds.length <= MAX_RIG_PARTS &&
    new Set(value.secondaryPartIds).size === value.secondaryPartIds.length &&
    everyItem(
      value.secondaryPartIds,
      (partId) => typeof partId === 'string' && partIds.has(partId),
    ) &&
    (value.torsoTwistScale === undefined ||
      isNumberInRange(value.torsoTwistScale, 0.25, 1)) &&
    (value.secondaryMotionScale === undefined ||
      isNumberInRange(value.secondaryMotionScale, 0.2, 1))
  )
}

function hasBoneCycle(bones: RigBone[]): boolean {
  const parents = new Map(bones.map((bone) => [bone.id, bone.parent]))
  const complete = new Set<string>()
  const active = new Set<string>()
  const visit = (boneId: string): boolean => {
    if (complete.has(boneId)) return false
    if (active.has(boneId)) return true
    active.add(boneId)
    const parent = parents.get(boneId)
    if (parent && visit(parent)) return true
    active.delete(boneId)
    complete.add(boneId)
    return false
  }
  return bones.some((bone) => visit(bone.id))
}

function isVertex(value: unknown, boneCount: number): value is RigVertex {
  if (
    !isRecord(value) ||
    !isPoint(value.position) ||
    !isPoint(value.uv) ||
    !isTuple4(value.joints) ||
    !isTuple4(value.weights)
  ) {
    return false
  }
  if (
    !value.joints.every(
      (joint) => Number.isInteger(joint) && joint >= 0 && joint < boneCount,
    ) ||
    !value.weights.every(isUnitNumber)
  ) {
    return false
  }
  return (
    Math.abs(value.weights.reduce((sum, weight) => sum + weight, 0) - 1) <=
    0.002
  )
}

function isPositiveSize(value: unknown): value is RigSize {
  return (
    isRecord(value) &&
    isPositiveNumber(value.width) &&
    isPositiveNumber(value.height) &&
    value.width <= MAX_EDGE &&
    value.height <= MAX_EDGE
  )
}

/**
 * The site's own picture, by a path from its root, or one this page holds
 * itself. The server writes such a path into every manifest it hands out; any
 * other address would have each page showing her load, and tell, some other
 * host. A path that climbs out of where it starts is none of the site's either.
 */
function isOwnTextureUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_URL) return false
  if (value === PREVIEW_ATLAS_URL) return true
  // A URL parser drops tabs and line ends and reads a backslash as a slash: what is checked must be what is fetched.
  if (/[\u0000-\u0020\u007F\\]/u.test(value)) return false
  if (value.startsWith('blob:')) return true
  if (!value.startsWith('/')) return false
  try {
    const path = decodeURIComponent(value.split(/[?#]/u, 1)[0])
    // Nothing to resolve: an empty step or a dotted one comes out as `//host`, or above where the path starts.
    return (
      !path.includes('\\') &&
      path.slice(1).split('/').every((step) => step !== '' && step !== '.' && step !== '..')
    )
  } catch {
    return false
  }
}

function isPoint(value: unknown): value is RigPoint {
  return isRecord(value) && isCoordinate(value.x) && isCoordinate(value.y)
}

function isTag(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim() !== '' &&
    value.length <= MAX_TAG
  )
}

function isCoordinate(value: unknown): value is number {
  return isNumberInRange(value, -MAX_COORDINATE, MAX_COORDINATE)
}

function isTuple4(value: unknown): value is [number, number, number, number] {
  return (
    Array.isArray(value) && value.length === 4 && everyItem(value, isFiniteNumber)
  )
}

function addIdentifier(ids: Set<string>, value: unknown): boolean {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > MAX_IDENTIFIER ||
    ids.has(value)
  ) {
    return false
  }
  ids.add(value)
  return true
}

function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0
}

function isNumberInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return isFiniteNumber(value) && value >= minimum && value <= maximum
}

function isUnitNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
