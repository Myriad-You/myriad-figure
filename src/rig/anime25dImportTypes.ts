// What the importer passes between its steps: source references, prepared layers, anchors.
import type { EyeSide, HairStrand, RasterLayer, RigPoint } from '@myriad/figure-player/internals'
import type { RigRect } from './types'

export interface Anime25DSourceReference {
  width: number
  height: number
  data: Uint8ClampedArray
}

export interface PreparedLayer extends RasterLayer {
  bounds: RigRect
  textureBounds: RigRect
  strands: HairStrand[]
}

export type RigCanvasFrame = RigRect

export interface AnimeAnchors {
  face: RigRect
  faceCenter: RigPoint
  neck: RigPoint
  bodyBottom: RigPoint
  eyes: Partial<Record<EyeSide, RigPoint>>
  irises: Partial<Record<EyeSide, RigPoint>>
  mouth: RigPoint | null
}
