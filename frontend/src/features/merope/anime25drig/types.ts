import {
  ANIME25D_COPYRIGHT,
  ANIME25D_LICENSE,
  ANIME25D_PLAYBACK_KIND,
  ANIME25D_PLAYBACK_VERSION,
  ANIME25D_PROJECT_NAME,
  ANIME25D_PROJECT_URL,
} from './credit'

export type Anime25DFade =
  | 'eyeOpen'
  | 'eyeClose'
  | 'eyeDizzy'
  | 'eyeSqueeze'
  | 'eyeCry'
  | 'maniacEyeShadow'
  | 'angerMark'
  | 'speechlessSweat'
  | 'mouthOpen'
  | 'mouthWide'
  | 'mouthRound'
  | 'mouthNarrow'
  | 'mouthClose'
  | 'mouthCry'
  | 'mouthManiac'

export type Anime25DGroup = 'head' | 'body'

export interface Anime25DStrand {
  x: number
  rootY: number
  tipY: number
}

export interface Anime25DPlaybackLayer {
  name: string
  role: string
  /** Draw-order index from Anime2.5DRig (`L.z`). Hair spring phase uses this. */
  z?: number
  depth: number
  group: Anime25DGroup
  phys: 'hair' | null
  fade: Anime25DFade | null
  side: 'L' | 'R' | null
  x: number
  y: number
  w: number
  h: number
  atlas: { x: number; y: number; w: number; h: number }
  strands: Anime25DStrand[]
}

export interface Anime25DEyeAnchor {
  x0: number
  y0: number
  x1: number
  y1: number
  icx: number
  icy: number
  closeY: number
}

export interface Anime25DPlaybackAnchors {
  face: {
    x0: number
    y0: number
    x1: number
    y1: number
    cx: number
    cy: number
  }
  neckPivot: { x: number; y: number }
  neckTop: number
  neckBottom: number
  bodyPivot: { x: number; y: number }
  mouth: {
    x0: number
    y0: number
    x1: number
    y1: number
    cx: number
    cy: number
  }
  faceScale: number
  eyeL?: Anime25DEyeAnchor
  eyeR?: Anime25DEyeAnchor
}

export type Anime25DChestProfileSource =
  'ai-vision' | 'geometry-fallback' | 'gender-policy'

/** Import-time chest region. Runtime consumes this without further AI work. */
export interface Anime25DChestProfile {
  version: 2
  enabled: boolean
  source: Anime25DChestProfileSource
  centerX: number
  centerY: number
  radiusX: number
  radiusY: number
  visibleScale: number
  motionScale: number
  frequencyScale: number
  /** 0 is freely moving; 1 is visually locked to structured support. */
  supportScale: number
  /** Fraction of local soft-tissue motion visible on the outer garment. */
  garmentMotionScale: number
  confidence: number
}

export type Anime25DMouthMaterial =
  | 'mouthClose'
  | 'mouthOpen'
  | 'mouthWide'
  | 'mouthRound'
  | 'mouthNarrow'
  | 'mouthManiac'

export interface Anime25DMouthSilhouette {
  material: Anime25DMouthMaterial
  centerX: number
  centerY: number
  width: number
  height: number
  leftCornerY: number
  rightCornerY: number
  fillRatio: number
  aperture: number
}

export interface Anime25DMouthBridgeTuning {
  first: Anime25DMouthMaterial
  second: Anime25DMouthMaterial
  widthScale: number
  heightScale: number
  neutralization: number
  centerOffsetX: number
  centerOffsetY: number
}

/** Import-time alpha-contour analysis. Runtime performs no image sampling. */
export interface Anime25DMouthProfile {
  version: 1
  source: 'alpha-contour' | 'bounds-fallback'
  silhouettes: Anime25DMouthSilhouette[]
  bridges: Anime25DMouthBridgeTuning[]
}

export interface Anime25DPlayback {
  kind: typeof ANIME25D_PLAYBACK_KIND
  version: number
  engine: typeof ANIME25D_PROJECT_NAME
  engineUrl: typeof ANIME25D_PROJECT_URL
  license: typeof ANIME25D_LICENSE
  copyright: string
  pixelCanvas: { width: number; height: number }
  layers: Anime25DPlaybackLayer[]
  anchors: Anime25DPlaybackAnchors
  mouthProfile: Anime25DMouthProfile
  chestProfile?: Anime25DChestProfile
}

export function anime25DPlaybackSource(): Pick<
  Anime25DPlayback,
  'kind' | 'version' | 'engine' | 'engineUrl' | 'license' | 'copyright'
> {
  return {
    kind: ANIME25D_PLAYBACK_KIND,
    version: ANIME25D_PLAYBACK_VERSION,
    engine: ANIME25D_PROJECT_NAME,
    engineUrl: ANIME25D_PROJECT_URL,
    license: ANIME25D_LICENSE,
    copyright: ANIME25D_COPYRIGHT,
  }
}

export function isAnime25DPlayback(value: unknown): value is Anime25DPlayback {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const canvas = record.pixelCanvas as Record<string, unknown> | undefined
  const chestProfile = record.chestProfile
  const mouthProfile = record.mouthProfile
  return (
    record.kind === ANIME25D_PLAYBACK_KIND &&
    record.version === ANIME25D_PLAYBACK_VERSION &&
    record.engine === ANIME25D_PROJECT_NAME &&
    Array.isArray(record.layers) &&
    record.layers.length > 0 &&
    typeof canvas?.width === 'number' &&
    typeof canvas.height === 'number' &&
    canvas.width > 0 &&
    canvas.height > 0 &&
    Boolean(record.anchors) &&
    typeof record.anchors === 'object' &&
    isAnime25DMouthProfile(mouthProfile, canvas.width, canvas.height) &&
    (chestProfile === undefined ||
      isAnime25DChestProfile(chestProfile, canvas.width, canvas.height))
  )
}

const MOUTH_MATERIALS: readonly Anime25DMouthMaterial[] = [
  'mouthClose',
  'mouthOpen',
  'mouthWide',
  'mouthRound',
  'mouthNarrow',
  'mouthManiac',
]

function isAnime25DMouthProfile(
  value: unknown,
  canvasWidth: number,
  canvasHeight: number,
): value is Anime25DMouthProfile {
  if (!value || typeof value !== 'object') return false
  const profile = value as Record<string, unknown>
  if (
    profile.version !== 1 ||
    (profile.source !== 'alpha-contour' &&
      profile.source !== 'bounds-fallback') ||
    !Array.isArray(profile.silhouettes) ||
    profile.silhouettes.length !== MOUTH_MATERIALS.length ||
    !Array.isArray(profile.bridges) ||
    profile.bridges.length !== 15
  ) {
    return false
  }
  const materials = new Set<Anime25DMouthMaterial>()
  for (const value of profile.silhouettes) {
    if (!value || typeof value !== 'object') return false
    const silhouette = value as Record<string, unknown>
    if (
      !MOUTH_MATERIALS.includes(silhouette.material as Anime25DMouthMaterial) ||
      materials.has(silhouette.material as Anime25DMouthMaterial) ||
      !numberInRange(silhouette.centerX, -canvasWidth, canvasWidth * 2) ||
      !numberInRange(silhouette.centerY, -canvasHeight, canvasHeight * 2) ||
      !numberInRange(silhouette.width, 0.25, canvasWidth) ||
      !numberInRange(silhouette.height, 0.25, canvasHeight) ||
      !numberInRange(silhouette.leftCornerY, -canvasHeight, canvasHeight * 2) ||
      !numberInRange(
        silhouette.rightCornerY,
        -canvasHeight,
        canvasHeight * 2,
      ) ||
      !numberInRange(silhouette.fillRatio, 0, 1) ||
      !numberInRange(silhouette.aperture, 0, 4)
    ) {
      return false
    }
    materials.add(silhouette.material as Anime25DMouthMaterial)
  }
  const pairs = new Set<string>()
  for (const value of profile.bridges) {
    if (!value || typeof value !== 'object') return false
    const bridge = value as Record<string, unknown>
    const first = bridge.first as Anime25DMouthMaterial
    const second = bridge.second as Anime25DMouthMaterial
    if (
      !MOUTH_MATERIALS.includes(first) ||
      !MOUTH_MATERIALS.includes(second) ||
      first === second
    ) {
      return false
    }
    const pair = [first, second].sort().join(':')
    if (
      pairs.has(pair) ||
      !numberInRange(bridge.widthScale, 0.75, 1) ||
      !numberInRange(bridge.heightScale, 0.65, 1) ||
      !numberInRange(bridge.neutralization, 0, 1) ||
      !numberInRange(bridge.centerOffsetX, -canvasWidth / 4, canvasWidth / 4) ||
      !numberInRange(bridge.centerOffsetY, -canvasHeight / 4, canvasHeight / 4)
    ) {
      return false
    }
    pairs.add(pair)
  }
  return materials.size === MOUTH_MATERIALS.length && pairs.size === 15
}

function isAnime25DChestProfile(
  value: unknown,
  canvasWidth: number,
  canvasHeight: number,
): value is Anime25DChestProfile {
  if (!value || typeof value !== 'object') return false
  const profile = value as Record<string, unknown>
  const sources: Anime25DChestProfileSource[] = [
    'ai-vision',
    'geometry-fallback',
    'gender-policy',
  ]
  return (
    profile.version === 2 &&
    typeof profile.enabled === 'boolean' &&
    typeof profile.source === 'string' &&
    sources.includes(profile.source as Anime25DChestProfileSource) &&
    numberInRange(profile.centerX, 0, canvasWidth) &&
    numberInRange(profile.centerY, 0, canvasHeight) &&
    numberInRange(profile.radiusX, 1, canvasWidth / 2) &&
    numberInRange(profile.radiusY, 1, canvasHeight / 2) &&
    numberInRange(profile.visibleScale, 0, 1) &&
    numberInRange(profile.motionScale, 0, 1.25) &&
    numberInRange(profile.frequencyScale, 0.75, 1.25) &&
    numberInRange(profile.supportScale, 0, 1) &&
    numberInRange(profile.garmentMotionScale, 0, 1) &&
    numberInRange(profile.confidence, 0, 1)
  )
}

function numberInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): boolean {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  )
}
