/**
 * Typed contract of Anime2.5DRig's upstream `lib/rigger.js` boundary.
 *
 * Keep this contract independent from Myriad's post-processing types: it is the
 * compatibility seam used to prove that the TypeScript port still emits the
 * original rigger result before Myriad applies its intentional replacements.
 */

export type UpstreamPixelArray =
  | Uint8ClampedArray
  | Uint8Array
  | Uint16Array
  | Float32Array

export interface UpstreamPixelImage {
  width: number
  height: number
  data: UpstreamPixelArray
}

export interface UpstreamRgbaImage extends UpstreamPixelImage {
  data: Uint8ClampedArray
}

export interface UpstreamPsdLayer {
  name?: string
  left?: number
  top?: number
  right?: number
  bottom?: number
  imageData?: UpstreamPixelImage
  canvas?: unknown
}

export interface UpstreamPsd {
  width: number
  height: number
  children?: UpstreamPsdLayer[]
}

export interface UpstreamGenericParts {
  eyeL?: UpstreamRgbaImage | null
  eyeR?: UpstreamRgbaImage | null
  mouth?: UpstreamRgbaImage | null
}

export interface UpstreamGenericPartsApi {
  get: (key: string) => UpstreamRgbaImage | null
}

export interface UpstreamRiggerOptions {
  generic?: UpstreamGenericParts
}

export type UpstreamLayerGroup = 'head' | 'body'
export type UpstreamLayerPhysics = 'hair' | null
export type UpstreamLayerSide = 'L' | 'R' | null
export type UpstreamLayerFade =
  | 'eyeOpen'
  | 'eyeClose'
  | 'mouthOpen'
  | 'mouthClose'
  | null

export interface UpstreamHairStrand {
  x: number
  rootY: number
  tipY: number
}

export interface UpstreamRigLayer {
  name: string
  x: number
  y: number
  w: number
  h: number
  z: number
  depth: number
  group: UpstreamLayerGroup
  phys: UpstreamLayerPhysics
  fade: UpstreamLayerFade
  side: UpstreamLayerSide
  strands: UpstreamHairStrand[] | null
  synthetic?: true
  img: UpstreamRgbaImage
}

export interface UpstreamFaceAnchor {
  cx: number
  cy: number
  x0: number
  x1: number
  y0: number
  y1: number
}

export interface UpstreamEyeAnchor {
  x0: number
  x1: number
  y0: number
  y1: number
  icx: number
  icy: number
  closeY: number
}

export interface UpstreamMouthAnchor {
  x0: number
  x1: number
  y0: number
  y1: number
  cx: number
  cy: number
}

export interface UpstreamRigAnchors {
  face: UpstreamFaceAnchor
  eyeL?: UpstreamEyeAnchor
  eyeR?: UpstreamEyeAnchor
  mouth: UpstreamMouthAnchor
  neckPivot: { cx: number; cy: number }
  neckTop: number
  neckBottom: number
  bodyPivot: { cx: number; cy: number }
  faceScale: number
  hairRootY: number
}

export interface UpstreamRig {
  canvas: { w: number; h: number }
  layers: UpstreamRigLayer[]
  anchors: UpstreamRigAnchors
  warnings: string[]
  synth: { eye: boolean; mouth: boolean }
}

export interface UpstreamCleanStats {
  noisy: number
  layers: number
}

export interface UpstreamComponentLabels {
  lab: Int32Array
  count: number
  sizes: number[]
  sumX: number[]
}

export interface UpstreamPeak {
  x: number
  prom: number
}

export interface UpstreamRiggerInternals {
  findPeaks: (
    values: ArrayLike<number>,
    minDist: number,
    minProm: number,
  ) => UpstreamPeak[]
  detectStrands: (
    alpha: Uint8Array,
    width: number,
    height: number,
    minSep: number,
    wanted: number,
  ) => UpstreamHairStrand[]
  labelComponents: (
    alpha: Uint8Array,
    width: number,
    height: number,
    threshold: number,
  ) => UpstreamComponentLabels
  cleanAlpha: (
    alpha: Uint8Array,
    width: number,
    height: number,
    minPixels: number,
  ) => Uint8Array
}

export interface UpstreamRiggerApi {
  buildRig: (psd: UpstreamPsd, options?: UpstreamRiggerOptions) => UpstreamRig
  cleanPsdLayers: (psd: UpstreamPsd) => UpstreamCleanStats
  normName: (value: string) => string
  baseName: (value: string) => string
  flattenPsdToImg: (psd: UpstreamPsd) => UpstreamRgbaImage | null
  splitImgLR: (
    image: UpstreamRgbaImage,
  ) => { l: UpstreamRgbaImage; r: UpstreamRgbaImage } | null
  _internals: UpstreamRiggerInternals
}
