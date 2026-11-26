// What an import produces before it is a package: layer sources, bone handles, the import source.
import type { Anime25DPlaybackV7 } from '@myriad-you/figure-player'
import type { CharacterAssetProfile, RigBone, RigMotionProfile, RigOutfitProfile, RigPoint, RigSemanticAnchor, RigSemantics, RigSize, RigSpatialProfile } from '@myriad-you/figure-player/internals'

export type RigRect = RigPoint & RigSize

export interface RigBoneHandle {
  boneId: string
  start: RigPoint
  end: RigPoint
  falloff: number
}

/** Legacy contour-only sources remain unchanged. */
export interface RigLayerMeshSource {
  vertices: RigPoint[]
  indices: number[]
}

export interface RigLayerSource {
  id: string
  textureId: string
  textureBounds: RigRect
  zIndex: number
  opacity: number
  slot?: string
  variant?: string
  contours: RigPoint[][]
  mesh?: RigLayerMeshSource
  boneHandles: RigBoneHandle[]
}

export interface MeropeRigImportSource {
  rigIrVersion?: number
  characterAssetContractVersion: number
  /** Absent on a bust. */
  profile?: CharacterAssetProfile
  sourceMasterAssetId: string
  sourceGenerationFingerprint?: string
  canvas: RigSize
  atlas: {
    id: string
    width: number
    height: number
  }
  bones: RigBone[]
  layers: RigLayerSource[]
  motionProfile?: RigMotionProfile
  outfitProfile?: RigOutfitProfile
  semanticAnchors?: Record<string, RigSemanticAnchor>
  semantics?: RigSemantics
  spatialProfile?: RigSpatialProfile
  anime25dPlayback?: Anime25DPlaybackV7
}
