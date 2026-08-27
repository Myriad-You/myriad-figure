import type { Layer, PixelData, Psd } from 'ag-psd'
import type { Anime25DRiggerAnchors } from '../anime25drig/playback'
import type { Anime25DLayerRole } from './anime25d'
import type { MouthExpressionKind } from './mouthExpression'
import type {
  MeropeRigImportSource,
  RigBone,
  RigBoneHandle,
  RigLayerMeshSource,
  RigLayerSource,
  RigPoint,
  RigRect,
} from './types'
import { currentCopy } from '../../../i18n/localeCopy'
import { analyzeAnime25DMouthProfile } from '../anime25drig/mouthProfile'
import {
  buildAnime25DPlayback,
  remapRiggerAnchors,
} from '../anime25drig/playback'
import { ANIME25D_LAYER_DEPTH } from './anime25d'
import { compensateSyntheticClosedEyeAngles } from './closedEyeCompensation'
import {
  CHARACTER_ASSET_CONTRACT_VERSION,
  MAX_RIG_BONES,
  MAX_RIG_PARTS,
  PORTRAIT_CANVAS,
  RIG_IR_VERSION,
} from './contract'
import { createCryEyeBitmap, cryEyeGeneratedSize } from './cryEye'
import {
  createDizzyEyeBitmap,
  dizzyEyeGeneratedSize,
  sampleDizzyEyeTint,
} from './dizzyEye'
import {
  createAngerMarkBitmap,
  createSpeechlessSweatBitmap,
  expressionSymbolGeneratedSizes,
} from './expressionSymbols'
import {
  createMouthExpressionBitmap,
  mouthExpressionGeneratedSizes,
  sampleMouthExpressionPalette,
} from './mouthExpression'
import {
  createManiacEyeShadowBitmap,
  maniacEyeShadowGeneratedSize,
} from './maniacEyeShadow'
import { inferOutfitProfileFromPartIds } from './outfit'
import { createSqueezeEyeBitmap, squeezeEyeGeneratedSize } from './squeezeEye'
import '../anime25drig/vendor/genericparts.js'
import '../anime25drig/vendor/rigger.js'

const Rigger = (
  globalThis as unknown as {
    Rigger: {
      buildRig: (
        psd: { width: number; height: number; children?: unknown[] },
        opts?: { generic?: unknown },
      ) => {
        layers: Array<{
          name: string
          x: number
          y: number
          w: number
          h: number
          z: number
          group: 'head' | 'body'
          side: 'L' | 'R' | null
          strands: Array<{ x: number; rootY: number; tipY: number }> | null
          synthetic?: boolean
          img: { width: number; height: number; data: Uint8ClampedArray }
        }>
        anchors: Anime25DRiggerAnchors
      }
      cleanPsdLayers: (psd: unknown) => unknown
    }
  }
).Rigger

const GenericParts = (
  globalThis as unknown as {
    GenericParts: {
      get: (key: string) => {
        width: number
        height: number
        data: Uint8ClampedArray
      } | null
    }
  }
).GenericParts

function genericCloseParts() {
  if (!GenericParts) return undefined
  const eyeL = GenericParts.get('eyeL')
  const eyeR = GenericParts.get('eyeR')
  const mouth = GenericParts.get('mouth')
  if (!eyeL && !mouth) return undefined
  return { eyeL, eyeR, mouth }
}

export { ANIME25D_LAYER_DEPTH, type Anime25DLayerRole } from './anime25d'

const ATLAS_PADDING = 8
const MAX_ATLAS_EDGE = 8192
const MIN_ATLAS_EDGE = 256
const ALPHA_COMPONENT_THRESHOLD = 16
const HIGH_COLLAR_MIN_COVERAGE = 0.88
const HIGH_COLLAR_MIN_UPPER_COVERAGE = 0.78
const HIGH_COLLAR_UPPER_FRACTION = 0.35
const COLLAR_COLOR_CLUSTER_COUNT = 5
const COLLAR_COLOR_ITERATIONS = 8
const COLLAR_COLOR_MIN_LIGHTNESS_GAP = 0.035
const COLLAR_COLOR_SEED_FRACTION = 0.18
const COLLAR_COLOR_MAX_REAR_FRACTION = 0.48
const COLLAR_STANDALONE_MIN_LIGHTNESS_GAP = 0.018
const COLLAR_STANDALONE_MIN_SEED_FRACTION = 0.12
const COLLAR_STANDALONE_MIN_GEOMETRY = 0.08
const COLLAR_REFERENCE_SAMPLE_TARGET = 4096
const COLLAR_REFERENCE_MATCH_DISTANCE = 40 * 40 * 7
const COLLAR_REFERENCE_MIN_LAYER_SAMPLES = 64
const COLLAR_REFERENCE_MIN_AGREEMENT = 0.38
const COLLAR_REFERENCE_REAR_CONFIDENCE = 0.08
const COLLAR_REFERENCE_FRONT_CONFIDENCE = 0.15
const COLLAR_REFERENCE_REAR_MATCH_DISTANCE = 32 * 32 * 7
const COLLAR_REFERENCE_FRONT_MATCH_DISTANCE = 48 * 48 * 7
const COLLAR_REFERENCE_REAR = 1
const COLLAR_REFERENCE_FRONT = 2
const COLLAR_BOUNDARY_CENTER = 0.78
const COLLAR_BOUNDARY_SIDE = 0.3
const COLLAR_BOUNDARY_CURVE = 1.35
const COLLAR_BOUNDARY_FEATHER = 3

type EyeSide = 'left' | 'right'

interface RasterLayer {
  id: string
  role: Anime25DLayerRole | 'unknown'
  sourceName: string
  order: number
  side: EyeSide | null
  group: 'head' | 'body'
  left: number
  top: number
  width: number
  height: number
  data: Uint8ClampedArray
  synthetic?: boolean
  slot?: 'eye-left' | 'eye-right' | 'mouth'
  variant?:
    | 'open'
    | 'closed'
    | 'wide'
    | 'round'
    | 'narrow'
    | 'dizzy'
    | 'squeeze'
    | 'cry'
    | 'maniac'
  documentStrands?: HairStrand[]
}

export interface Anime25DSourceReference {
  width: number
  height: number
  data: Uint8ClampedArray
}

interface CollarColorSample {
  x: number
  y: number
  lightness: number
  chromaA: number
  chromaB: number
}

interface CollarColorComponent {
  pixels: number[]
  span: number
  score: number
}

interface CollarColorMask {
  left: number
  top: number
  width: number
  height: number
  data: Uint8Array
}

type CollarReferenceMask = CollarColorMask

interface PreparedLayer extends RasterLayer {
  bounds: RigRect
  textureBounds: RigRect
  strands: HairStrand[]
}

interface HairStrand {
  x: number
  rootY: number
  tipY: number
}

type RigCanvasFrame = RigRect

interface AnimeAnchors {
  face: RigRect
  faceCenter: RigPoint
  neck: RigPoint
  bodyBottom: RigPoint
  eyes: Partial<Record<EyeSide, RigPoint>>
  irises: Partial<Record<EyeSide, RigPoint>>
  mouth: RigPoint | null
}

export interface PreparedAnime25DRigImport {
  atlas: Blob
  analysisReference: Blob
  source: MeropeRigImportSource
  partCount: number
}

const SEE_THROUGH_LAYER_ALIASES: Readonly<Record<string, string>> = {
  hair: 'front-hair',
  hairf: 'front-hair',
  hairb: 'back-hair',
  eyes: 'eyelash',
  eyer: 'eyelash-r',
  eyel: 'eyelash-l',
  browr: 'eyebrow-r',
  browl: 'eyebrow-l',
  earr: 'ears-r',
  earl: 'ears-l',
  eyebg: 'eyewhite',
}

const UPPER_BODY_IGNORED_LAYERS = new Set(['legwear', 'footwear'])

export function normalizeAnime25DLayerName(value: string | undefined): string {
  let name = canonicalAnime25DLayerName(value)
  if (name === 'eyelash-c') name = 'eye-close'
  if (name === 'mouth-c') name = 'mouth-close'
  if (name === 'mouth' || /^mouth-?\d+$/.test(name)) name = 'mouth-open'
  if (name === 'レイヤー-1') name = 'facedetail'
  return SEE_THROUGH_LAYER_ALIASES[name] || name
}

function canonicalAnime25DLayerName(value: string | undefined): string {
  return (value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s*(?:のコピー|copy)(?:\s*\d+)?$/u, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
}

export function anime25DBaseRole(
  normalizedName: string,
): Anime25DLayerRole | null {
  const candidate = normalizedName.replace(/-(?:\d+|l|r|left|right)$/, '')
  return Object.hasOwn(ANIME25D_LAYER_DEPTH, candidate)
    ? (candidate as Anime25DLayerRole)
    : null
}

function anime25DLayerSide(normalizedName: string): EyeSide | null {
  const suffix = normalizedName.match(/-(l|r|left|right)$/)?.[1]
  if (suffix === 'l' || suffix === 'left') return 'left'
  if (suffix === 'r' || suffix === 'right') return 'right'
  return null
}

export function isAnime25DDocument(psd: Psd): boolean {
  const names = flattenVisibleLayers(psd.children || []).map((layer) =>
    normalizeAnime25DLayerName(layer.name),
  )
  return names.some((name) => anime25DBaseRole(name) === 'face')
}

export async function prepareAnime25DRigPsd(
  psd: Psd,
  sourceMasterAssetId: string,
  onStage?: (stage: 'validated' | 'packing') => void,
  sourceGenerationFingerprint?: string,
  sourceReference?: Anime25DSourceReference,
): Promise<PreparedAnime25DRigImport> {
  if (!isAnime25DDocument(psd)) {
    throw new Error(currentCopy().merope.anime25dMissingFace)
  }
  const staticSeeThroughMouth = hasStaticSeeThroughMouth(psd)
  const working = flattenPsdForRigger(psd)
  Rigger.cleanPsdLayers(working)
  const rig = Rigger.buildRig(working, { generic: genericCloseParts() })
  compensateSyntheticClosedEyeAngles(rig.layers)
  onStage?.('validated')
  const usedIds = new Set<string>()
  let layers = rig.layers.map((part) => rasterFromRiggerPart(part, usedIds))
  if (staticSeeThroughMouth) layers = preserveStaticMouthAsClosed(layers)
  layers = splitHandwearIfNeeded(layers, rig.anchors.face.cx)
  layers = splitVariantEyesIfNeeded(layers, rig.anchors.face.cx, 'eye-dizzy')
  layers = splitVariantEyesIfNeeded(layers, rig.anchors.face.cx, 'eye-squeeze')
  layers = splitVariantEyesIfNeeded(layers, rig.anchors.face.cx, 'eye-cry')
  layers = synthesizeMissingDizzyEyes(layers, rig.anchors)
  layers = synthesizeMissingSqueezeEyes(layers, rig.anchors)
  layers = synthesizeMissingCryEyes(layers, rig.anchors)
  layers = synthesizeMissingManiacEyeShadows(layers, rig.anchors)
  layers = synthesizeMissingMouthExpressions(layers, rig.anchors)
  layers = synthesizeMissingExpressionSymbols(layers, rig.anchors)
  layers = splitHighCollarOcclusion(layers, rig.anchors, sourceReference)
  layers.forEach((layer, index) => {
    layer.order = index
  })
  assignCrossfadeSlots(layers)
  validateCharacterAssetLayers(layers)
  const faceCenter = {
    x: rig.anchors.face.cx,
    y: rig.anchors.face.cy,
  }
  if (layers.length === 0 || layers.length > MAX_RIG_PARTS) {
    throw new Error(
      currentCopy().merope.anime25dPartCount.replace(
        '{max}',
        String(MAX_RIG_PARTS),
      ),
    )
  }
  const frame = contentFrame(psd, layers)
  onStage?.('packing')
  const {
    atlas,
    analysisReference,
    layers: prepared,
    width: packedWidth,
    height: packedHeight,
  } = await packAtlas(frame, layers)
  const anchors = deriveAnchors(frame, prepared, faceCenter)
  const { bones, layerHandles, secondaryBoneIds } = buildBonesAndHandles(
    prepared,
    anchors,
  )
  const rigLayers = buildLayerSources(prepared, layerHandles)
  const partIds = prepared.map((layer) => `a25d-${layer.id}`)
  const playbackAnchors = remapRiggerAnchors(rig.anchors, frame)
  const mouthProfile = analyzeAnime25DMouthProfile(
    prepared,
    frame,
    playbackAnchors.mouth,
  )
  const anime25dPlayback = buildAnime25DPlayback({
    frameWidth: frame.width,
    frameHeight: frame.height,
    layers: prepared,
    anchors: playbackAnchors,
    mouthProfile,
  })
  const outfitProfile = inferOutfitProfileFromPartIds(partIds)
  const semanticBones: Record<string, string> = {
    root: 'root',
    torso: 'body',
    head: 'head',
    face: 'face',
  }
  if (bones.some((bone) => bone.id === 'left-eye')) {
    semanticBones['left-eye'] = 'left-eye'
  }
  if (bones.some((bone) => bone.id === 'right-eye')) {
    semanticBones['right-eye'] = 'right-eye'
  }
  if (bones.some((bone) => bone.id === 'mouth')) semanticBones.mouth = 'mouth'
  if (bones.some((bone) => bone.id === 'a25d-handwear')) {
    semanticBones.handwear = 'a25d-handwear'
  }
  return {
    atlas,
    analysisReference,
    partCount: prepared.length,
    source: {
      rigIrVersion: RIG_IR_VERSION,
      characterAssetContractVersion: CHARACTER_ASSET_CONTRACT_VERSION,
      sourceMasterAssetId,
      ...(sourceGenerationFingerprint ? { sourceGenerationFingerprint } : {}),
      canvas: { ...PORTRAIT_CANVAS },
      atlas: { id: 'atlas', width: packedWidth, height: packedHeight },
      bones,
      layers: rigLayers,
      outfitProfile,
      semanticAnchors: semanticAnchors(anchors),
      semantics: {
        bones: semanticBones,
        chains: { torso: ['root', 'body', 'head'] },
        secondaryBoneIds,
      },
      anime25dPlayback,
    },
  }
}

function flattenVisibleLayers(layers: Layer[]): Layer[] {
  const output: Layer[] = []
  for (const layer of layers) {
    if (layer.hidden) continue
    if (layer.children) output.push(...flattenVisibleLayers(layer.children))
    else output.push(layer)
  }
  return output
}

/** See-through's plain `mouth` is the static portrait mouth, not an open phoneme. */
function hasStaticSeeThroughMouth(psd: Psd): boolean {
  const names = flattenVisibleLayers(psd.children || []).map((layer) =>
    canonicalAnime25DLayerName(layer.name),
  )
  const hasPlainMouth = names.some(
    (name) => name === 'mouth' || /^mouth-?\d+$/.test(name),
  )
  const hasAuthoredOpen = names.some(
    (name) => name === 'mouth-open' || /^mouth-open-?\d+$/.test(name),
  )
  const hasAuthoredClose = names.some(
    (name) => name === 'mouth-c' || name === 'mouth-close',
  )
  return hasPlainMouth && !hasAuthoredOpen && !hasAuthoredClose
}

function toRiggerLayerName(value: string | undefined): string {
  let kebab = normalizeAnime25DLayerName(value)
  const numbered = kebab.match(/-(\d+)$/)
  const number = numbered?.[1]
  if (number) kebab = kebab.slice(0, -(number.length + 1))
  kebab = kebab.replace(/-(?:l|r|left|right)$/, '')
  const riggerName =
    kebab === 'front-hair'
      ? 'front hair'
      : kebab === 'back-hair'
        ? 'back hair'
        : kebab.replace(/-/g, '_')
  return number ? `${riggerName}_${number}` : riggerName
}

function flattenPsdForRigger(psd: Psd): Psd {
  const children = flattenVisibleLayers(psd.children || [])
    .filter((layer) => validPixelData(layer.imageData))
    .filter(
      (layer) =>
        !UPPER_BODY_IGNORED_LAYERS.has(normalizeAnime25DLayerName(layer.name)),
    )
    .map((layer) => {
      const pixels = layer.imageData
      if (!validPixelData(pixels)) return layer
      return {
        ...layer,
        name: toRiggerLayerName(layer.name),
        imageData: {
          width: pixels.width,
          height: pixels.height,
          data: new Uint8ClampedArray(pixels.data),
        },
      }
    })
  return { width: psd.width, height: psd.height, children }
}

function rasterFromRiggerPart(
  part: {
    name: string
    x: number
    y: number
    w: number
    h: number
    group: 'head' | 'body'
    side: 'L' | 'R' | null
    strands: Array<{ x: number; rootY: number; tipY: number }> | null
    synthetic?: boolean
    img: { width: number; height: number; data: Uint8ClampedArray }
  },
  usedIds: Set<string>,
): RasterLayer {
  const kebab = part.name.replace(/_/g, '-').replace(/ /g, '-').toLowerCase()
  const side: EyeSide | null =
    part.side === 'L'
      ? 'left'
      : part.side === 'R'
        ? 'right'
        : anime25DLayerSide(kebab)
  const role = anime25DBaseRole(kebab.replace(/-(?:l|r)$/, '')) || 'unknown'
  const preferred = side ? `${role}-${side}` : kebab.replace(/-(?:l|r)$/, '')
  return {
    id: uniquePartId(preferred, usedIds),
    role,
    sourceName: kebab,
    order: usedIds.size,
    side,
    group: part.group,
    left: part.x,
    top: part.y,
    width: part.w,
    height: part.h,
    data: part.img.data,
    synthetic: part.synthetic,
    documentStrands: part.strands || undefined,
  }
}

function preserveStaticMouthAsClosed(layers: RasterLayer[]): RasterLayer[] {
  const staticMouth = layers.find(
    (layer) => layer.role === 'mouth-open' && !layer.synthetic,
  )
  if (!staticMouth) return layers
  const output = layers.filter(
    (layer) => layer !== staticMouth && layer.role !== 'mouth-close',
  )
  const usedIds = new Set(output.map((layer) => layer.id))
  const closed = {
    ...staticMouth,
    id: uniquePartId('mouth-close', usedIds),
    role: 'mouth-close' as const,
    sourceName: 'mouth-close',
    synthetic: false,
  }
  const insertAt = Math.max(0, layers.indexOf(staticMouth))
  output.splice(Math.min(insertAt, output.length), 0, closed)
  return output
}

/**
 * Recover the three-layer high-collar topology lost when See-through flattens
 * all clothing into one topwear raster:
 *
 *   rear collar -> neck -> front collar / remaining topwear
 *
 * Detection uses alpha overlap in the exposed neck corridor. Once detected,
 * perceptual color segmentation finds the broad, darker collar region joined
 * to the upper edge before any depth decision is made. The aligned master then
 * separates visible neck from clothing and protects front-facing detail.
 */
function splitHighCollarOcclusion(
  layers: RasterLayer[],
  anchors: Anime25DRiggerAnchors,
  sourceReference?: Anime25DSourceReference,
): RasterLayer[] {
  const neck = layers.find((layer) => layer.role === 'neck')
  const topwear = layers.find((layer) => layer.role === 'topwear')
  if (!neck || !topwear) return layers

  const exposedTop = Math.ceil(Math.max(anchors.face.y1, neck.top))
  const exposedBottom = Math.floor(
    Math.min(anchors.neckBottom, neck.top + neck.height - 1),
  )
  if (exposedBottom - exposedTop < 8) return layers

  const upperBottom =
    exposedTop + (exposedBottom - exposedTop) * HIGH_COLLAR_UPPER_FRACTION
  let neckPixels = 0
  let overlapPixels = 0
  let upperNeckPixels = 0
  let upperOverlapPixels = 0
  for (let y = exposedTop; y <= exposedBottom; y += 1) {
    for (let x = Math.ceil(neck.left); x < neck.left + neck.width; x += 1) {
      if (rasterAlphaAt(neck, x, y) < ALPHA_COMPONENT_THRESHOLD) continue
      neckPixels += 1
      const upper = y <= upperBottom
      if (upper) upperNeckPixels += 1
      if (rasterAlphaAt(topwear, x, y) < ALPHA_COMPONENT_THRESHOLD) continue
      overlapPixels += 1
      if (upper) upperOverlapPixels += 1
    }
  }
  if (neckPixels < 64 || upperNeckPixels < 24) return layers
  if (
    overlapPixels / neckPixels < HIGH_COLLAR_MIN_COVERAGE ||
    upperOverlapPixels / upperNeckPixels < HIGH_COLLAR_MIN_UPPER_COVERAGE
  ) {
    return layers
  }
  const trustedSourceReference =
    sourceReference && sourceReferenceAgreesWithLayers(sourceReference, layers)
      ? sourceReference
      : undefined

  const remainingTopwear = {
    ...topwear,
    data: new Uint8ClampedArray(topwear.data),
  }
  const rearPixels = new Uint8ClampedArray(topwear.data.length)
  const frontPixels = new Uint8ClampedArray(topwear.data.length)
  const centerX = neck.left + neck.width / 2
  const halfWidth = Math.max(1, neck.width / 2)
  const exposedHeight = exposedBottom - exposedTop
  const referenceMask = trustedSourceReference
    ? buildCollarReferenceMask(
        trustedSourceReference,
        neck,
        topwear,
        exposedTop,
        exposedBottom,
      )
    : undefined
  // Keep the reference-assisted path stable. A standalone PSD needs a full
  // front/rear partition because there is no visible master pixel to classify
  // the overlap; a rear-only color mask would move the entire front collar
  // behind the neck.
  const colorRearMask = trustedSourceReference
    ? segmentRearCollarByColor(neck, topwear, exposedTop, exposedBottom, false)
    : undefined
  const standaloneMask = trustedSourceReference
    ? undefined
    : segmentRearCollarByColor(neck, topwear, exposedTop, exposedBottom, true)
  let minimumX = topwear.width
  let minimumY = topwear.height
  let maximumX = -1
  let maximumY = -1
  let frontMinimumX = topwear.width
  let frontMinimumY = topwear.height
  let frontMaximumX = -1
  let frontMaximumY = -1

  for (let y = exposedTop; y <= exposedBottom; y += 1) {
    for (let x = Math.ceil(neck.left); x < neck.left + neck.width; x += 1) {
      const neckAlpha = rasterAlphaAt(neck, x, y)
      if (neckAlpha === 0) continue
      const localX = x - Math.round(topwear.left)
      const localY = y - Math.round(topwear.top)
      if (
        localX < 0 ||
        localY < 0 ||
        localX >= topwear.width ||
        localY >= topwear.height
      ) {
        continue
      }
      const pixel = (localY * topwear.width + localX) * 4
      const sourceAlpha = topwear.data[pixel + 3]
      if (sourceAlpha === 0) continue

      const geometricRearAmount = collarBoundaryRearAmount(
        x,
        y,
        centerX,
        halfWidth,
        exposedTop,
        exposedHeight,
      )
      const colorRearAmount = collarColorMaskAt(colorRearMask, x, y)
      const referenceClass = collarReferenceMaskAt(referenceMask, x, y)
      const referenceRearAmount =
        referenceClass === COLLAR_REFERENCE_REAR ? 1 : 0
      const referenceFrontAmount =
        referenceClass === COLLAR_REFERENCE_FRONT ? 1 : 0
      const standaloneBlend = collarStandaloneRearAmount(standaloneMask, x, y)
      const standaloneRearAmount = standaloneBlend >= 0 ? standaloneBlend : 0
      const standaloneFrontAmount =
        standaloneBlend >= 0 ? 1 - standaloneBlend : 0
      const fallbackRearAmount =
        !colorRearMask && !referenceMask && !standaloneMask
          ? geometricRearAmount
          : 0
      const fallbackFrontAmount =
        !colorRearMask && !referenceMask && !standaloneMask
          ? 1 - geometricRearAmount
          : 0
      const definitiveRearAmount = Math.max(
        colorRearAmount,
        referenceRearAmount,
      )
      const semanticRearAmount = Math.max(
        definitiveRearAmount,
        standaloneRearAmount,
        fallbackRearAmount,
      )
      const semanticFrontAmount =
        definitiveRearAmount > 0
          ? 0
          : Math.max(
              referenceFrontAmount,
              standaloneFrontAmount,
              fallbackFrontAmount,
            )
      const overlapAmount = neckAlpha / 255
      const rearAmount = semanticRearAmount * overlapAmount
      const frontAmount = semanticFrontAmount * overlapAmount
      if (rearAmount > 0) {
        copyRasterPixel(
          topwear.data,
          rearPixels,
          pixel,
          sourceAlpha * rearAmount,
        )
        minimumX = Math.min(minimumX, localX)
        minimumY = Math.min(minimumY, localY)
        maximumX = Math.max(maximumX, localX)
        maximumY = Math.max(maximumY, localY)
      }
      if (frontAmount > 0) {
        copyRasterPixel(
          topwear.data,
          frontPixels,
          pixel,
          sourceAlpha * frontAmount,
        )
        frontMinimumX = Math.min(frontMinimumX, localX)
        frontMinimumY = Math.min(frontMinimumY, localY)
        frontMaximumX = Math.max(frontMaximumX, localX)
        frontMaximumY = Math.max(frontMaximumY, localY)
      }
      remainingTopwear.data[pixel + 3] = Math.round(
        sourceAlpha * (1 - rearAmount - frontAmount),
      )
    }
  }
  if (maximumX < minimumX || maximumY < minimumY) return layers

  const rearWidth = maximumX - minimumX + 1
  const rearHeight = maximumY - minimumY + 1
  const rearData = cropRasterPixels(
    rearPixels,
    topwear.width,
    minimumX,
    minimumY,
    rearWidth,
    rearHeight,
  )
  const hasFrontCollar =
    frontMaximumX >= frontMinimumX && frontMaximumY >= frontMinimumY

  const usedIds = new Set(layers.map((layer) => layer.id))
  const rearCollar: RasterLayer = {
    id: uniquePartId('collar-back', usedIds),
    role: 'collar-back',
    sourceName: 'collar-back',
    order: topwear.order,
    side: null,
    group: 'body',
    left: topwear.left + minimumX,
    top: topwear.top + minimumY,
    width: rearWidth,
    height: rearHeight,
    data: rearData,
    synthetic: true,
  }
  const frontCollar: RasterLayer | undefined = hasFrontCollar
    ? {
        id: uniquePartId('collar-front', usedIds),
        role: 'collar-front',
        sourceName: 'collar-front',
        order: topwear.order,
        side: null,
        group: 'body',
        left: topwear.left + frontMinimumX,
        top: topwear.top + frontMinimumY,
        width: frontMaximumX - frontMinimumX + 1,
        height: frontMaximumY - frontMinimumY + 1,
        data: cropRasterPixels(
          frontPixels,
          topwear.width,
          frontMinimumX,
          frontMinimumY,
          frontMaximumX - frontMinimumX + 1,
          frontMaximumY - frontMinimumY + 1,
        ),
        synthetic: true,
      }
    : undefined

  const neckIndex = layers.indexOf(neck)
  const topwearIndex = layers.indexOf(topwear)
  const insertionIndex = Math.min(neckIndex, topwearIndex)
  const output = layers.filter((layer) => layer !== neck && layer !== topwear)
  // Playback paints in array order rather than consulting semantic depth. Keep
  // the actual raster order identical to the intended collar topology so
  // uncertain topwear pixels cannot be painted back over the neck.
  output.splice(insertionIndex, 0, remainingTopwear, rearCollar, neck)
  if (frontCollar) output.splice(insertionIndex + 3, 0, frontCollar)
  return output
}

function copyRasterPixel(
  source: Uint8ClampedArray,
  target: Uint8ClampedArray,
  pixel: number,
  alpha: number,
): void {
  target[pixel] = source[pixel]
  target[pixel + 1] = source[pixel + 1]
  target[pixel + 2] = source[pixel + 2]
  target[pixel + 3] = Math.round(alpha)
}

function cropRasterPixels(
  source: Uint8ClampedArray,
  sourceWidth: number,
  left: number,
  top: number,
  width: number,
  height: number,
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const sourceStart = ((top + y) * sourceWidth + left) * 4
    const sourceEnd = sourceStart + width * 4
    output.set(source.subarray(sourceStart, sourceEnd), y * width * 4)
  }
  return output
}

/**
 * A manually selected PSD can outlive the site's current master portrait.
 * Reject that stale pairing before using master pixels as semantic truth.
 * Median agreement across identity-bearing regions tolerates inpainting and
 * local occlusion while still separating different characters and outfits.
 */
function sourceReferenceAgreesWithLayers(
  reference: Anime25DSourceReference,
  layers: RasterLayer[],
): boolean {
  const agreements: number[] = []
  for (const role of ['front-hair', 'back-hair', 'face', 'topwear'] as const) {
    const layer = layers.find(
      (candidate) => candidate.role === role && !candidate.synthetic,
    )
    if (!layer) continue
    const sampleStep = Math.max(
      1,
      Math.floor(
        Math.sqrt(
          (layer.width * layer.height) / COLLAR_REFERENCE_SAMPLE_TARGET,
        ),
      ),
    )
    let samples = 0
    let matches = 0
    for (let y = 0; y < layer.height; y += sampleStep) {
      for (let x = 0; x < layer.width; x += sampleStep) {
        const layerPixel = (y * layer.width + x) * 4
        if (layer.data[layerPixel + 3] < 200) continue
        const canvasX = Math.round(layer.left) + x
        const canvasY = Math.round(layer.top) + y
        if (
          canvasX < 0 ||
          canvasX >= reference.width ||
          canvasY < 0 ||
          canvasY >= reference.height
        ) {
          continue
        }
        const referencePixel = (canvasY * reference.width + canvasX) * 4
        if (reference.data[referencePixel + 3] < 200) continue
        samples += 1
        if (
          perceptualColorDistance(
            reference.data,
            referencePixel,
            layer.data,
            layerPixel,
          ) <= COLLAR_REFERENCE_MATCH_DISTANCE
        ) {
          matches += 1
        }
      }
    }
    if (samples >= COLLAR_REFERENCE_MIN_LAYER_SAMPLES) {
      agreements.push(matches / samples)
    }
  }
  if (agreements.length < 2) return false
  agreements.sort((left, right) => left - right)
  const middle = Math.floor(agreements.length / 2)
  const median =
    agreements.length % 2 === 0
      ? (agreements[middle - 1] + agreements[middle]) / 2
      : agreements[middle]
  return median >= COLLAR_REFERENCE_MIN_AGREEMENT
}

/**
 * Split the collar palette before assigning depth. K-means operates in OKLab
 * so luminance differences remain useful across pale, saturated, and dark
 * outfits. A trusted reference keeps the conservative dark-component mask;
 * standalone PSDs instead follow the largest darker upper-edge material
 * through the collar geometry and classify the complementary overlap as the
 * front collar.
 */
function segmentRearCollarByColor(
  neck: RasterLayer,
  topwear: RasterLayer,
  exposedTop: number,
  exposedBottom: number,
  standalone: boolean,
): CollarColorMask | undefined {
  const left = Math.ceil(neck.left)
  const right = Math.floor(neck.left + neck.width)
  const width = right - left
  const height = exposedBottom - exposedTop + 1
  if (width < 8 || height < 8) return undefined

  const samples: CollarColorSample[] = []
  for (let y = exposedTop; y <= exposedBottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      if (rasterAlphaAt(neck, x, y) < ALPHA_COMPONENT_THRESHOLD) continue
      const topwearPixel = rasterPixelIndex(topwear, x, y)
      if (
        topwearPixel < 0 ||
        topwear.data[topwearPixel + 3] < ALPHA_COMPONENT_THRESHOLD
      ) {
        continue
      }
      const [lightness, chromaA, chromaB] = oklabAt(topwear.data, topwearPixel)
      samples.push({
        x: x - left,
        y: y - exposedTop,
        lightness,
        chromaA,
        chromaB,
      })
    }
  }
  if (samples.length < 64) return undefined

  const centroids: Array<[number, number, number]> = []
  const middle = samples[Math.floor(samples.length / 2)]
  centroids.push([middle.lightness, middle.chromaA, middle.chromaB])
  while (
    centroids.length < Math.min(COLLAR_COLOR_CLUSTER_COUNT, samples.length)
  ) {
    let farthest = samples[0]
    let farthestDistance = -1
    for (const sample of samples) {
      let nearestDistance = Number.POSITIVE_INFINITY
      for (const centroid of centroids) {
        nearestDistance = Math.min(
          nearestDistance,
          collarColorDistance(sample, centroid),
        )
      }
      if (nearestDistance > farthestDistance) {
        farthest = sample
        farthestDistance = nearestDistance
      }
    }
    if (farthestDistance <= Number.EPSILON) break
    centroids.push([farthest.lightness, farthest.chromaA, farthest.chromaB])
  }
  if (centroids.length < 2) return undefined

  const labels = new Int8Array(samples.length)
  for (let iteration = 0; iteration < COLLAR_COLOR_ITERATIONS; iteration += 1) {
    const sums = centroids.map(() => [0, 0, 0, 0])
    samples.forEach((sample, index) => {
      let label = 0
      let nearestDistance = Number.POSITIVE_INFINITY
      centroids.forEach((centroid, centroidIndex) => {
        const distance = collarColorDistance(sample, centroid)
        if (distance >= nearestDistance) return
        nearestDistance = distance
        label = centroidIndex
      })
      labels[index] = label
      const sum = sums[label]
      sum[0] += sample.lightness
      sum[1] += sample.chromaA
      sum[2] += sample.chromaB
      sum[3] += 1
    })
    sums.forEach((sum, index) => {
      if (sum[3] === 0) return
      centroids[index] = [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]]
    })
  }

  const seedHeight = Math.max(1, Math.ceil(height * COLLAR_COLOR_SEED_FRACTION))
  const upperHeight = Math.max(
    seedHeight,
    Math.ceil(height * HIGH_COLLAR_UPPER_FRACTION),
  )
  const seedCounts = new Uint32Array(centroids.length)
  let upperLightness = 0
  let upperCount = 0
  samples.forEach((sample, index) => {
    if (sample.y < seedHeight) seedCounts[labels[index]] += 1
    if (sample.y >= upperHeight) return
    upperLightness += sample.lightness
    upperCount += 1
  })
  if (upperCount === 0) return undefined
  upperLightness /= upperCount

  let rearLabel = -1
  let rearSeedCount = 0
  if (standalone) {
    // The rear lining is normally darker than the upper collar as a whole,
    // but pale outfits can have only a small luminance gap. Prefer the largest
    // upper-edge cluster that is meaningfully darker; falling back to the
    // dominant cluster still supports nearly monochrome collars.
    centroids.forEach((centroid, index) => {
      const count = seedCounts[index]
      if (
        centroid[0] >= upperLightness - COLLAR_STANDALONE_MIN_LIGHTNESS_GAP ||
        count <= rearSeedCount
      ) {
        return
      }
      rearLabel = index
      rearSeedCount = count
    })
    if (rearLabel < 0) {
      seedCounts.forEach((count, index) => {
        if (count <= rearSeedCount) return
        rearLabel = index
        rearSeedCount = count
      })
    }
  } else {
    centroids.forEach((centroid, index) => {
      if (
        centroid[0] >= upperLightness - COLLAR_COLOR_MIN_LIGHTNESS_GAP ||
        seedCounts[index] <= rearSeedCount
      ) {
        return
      }
      rearLabel = index
      rearSeedCount = seedCounts[index]
    })
  }
  if (rearLabel < 0 || rearSeedCount < Math.max(12, width * 0.08)) {
    return undefined
  }
  if (standalone) {
    const seedSampleCount = seedCounts.reduce((sum, count) => sum + count, 0)
    if (
      rearSeedCount / Math.max(1, seedSampleCount) <
      COLLAR_STANDALONE_MIN_SEED_FRACTION
    ) {
      return undefined
    }
  }

  const labelGrid = new Int8Array(width * height)
  labelGrid.fill(-1)
  samples.forEach((sample, index) => {
    labelGrid[sample.y * width + sample.x] = labels[index]
  })
  const components = collarColorComponents(
    labelGrid,
    width,
    height,
    rearLabel,
    seedHeight,
    standalone,
  )
  const best = components[0]
  if (
    !best ||
    best.pixels.length < Math.max(24, samples.length * 0.01) ||
    best.span < width * 0.15
  ) {
    return undefined
  }

  const mask = new Uint8Array(width * height)
  for (const component of components) {
    if (component.score < best.score * 0.35) break
    const rowMinimum = new Int16Array(height)
    const rowMaximum = new Int16Array(height)
    rowMinimum.fill(width)
    rowMaximum.fill(-1)
    for (const pixel of component.pixels) {
      const y = Math.floor(pixel / width)
      const x = pixel - y * width
      rowMinimum[y] = Math.min(rowMinimum[y], x)
      rowMaximum[y] = Math.max(rowMaximum[y], x)
    }
    for (let y = 0; y < height; y += 1) {
      if (rowMaximum[y] < rowMinimum[y]) continue
      const start = Math.max(0, rowMinimum[y] - 1)
      const end = Math.min(width - 1, rowMaximum[y] + 1)
      for (let x = start; x <= end; x += 1) {
        if (
          standalone &&
          collarBoundaryRearAmount(
            x,
            y,
            width / 2,
            width / 2,
            0,
            Math.max(1, height - 1),
          ) < COLLAR_STANDALONE_MIN_GEOMETRY
        ) {
          continue
        }
        mask[y * width + x] = COLLAR_REFERENCE_REAR
      }
    }
  }
  if (standalone) {
    for (let pixel = 0; pixel < mask.length; pixel += 1) {
      if (labelGrid[pixel] >= 0 && mask[pixel] === 0) {
        mask[pixel] = COLLAR_REFERENCE_FRONT
      }
    }
  }
  return { left, top: exposedTop, width, height, data: mask }
}

function collarColorComponents(
  labels: Int8Array,
  width: number,
  height: number,
  rearLabel: number,
  seedHeight: number,
  standalone: boolean,
): CollarColorComponent[] {
  const maximumY = standalone
    ? height
    : Math.min(height, Math.ceil(height * COLLAR_COLOR_MAX_REAR_FRACTION))
  const visited = new Uint8Array(width * height)
  const components: CollarColorComponent[] = []
  for (let y = 0; y < seedHeight; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x
      if (visited[start] || labels[start] !== rearLabel) continue
      const queue = [start]
      const pixels: number[] = []
      let cursor = 0
      let minimumX = width
      let maximumX = -1
      visited[start] = 1
      while (cursor < queue.length) {
        const pixel = queue[cursor]
        cursor += 1
        pixels.push(pixel)
        const currentY = Math.floor(pixel / width)
        const currentX = pixel - currentY * width
        minimumX = Math.min(minimumX, currentX)
        maximumX = Math.max(maximumX, currentX)
        const neighbours = [
          [currentX - 1, currentY],
          [currentX + 1, currentY],
          [currentX, currentY - 1],
          [currentX, currentY + 1],
        ]
        for (const [nextX, nextY] of neighbours) {
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= maximumY) {
            continue
          }
          if (
            standalone &&
            collarBoundaryRearAmount(
              nextX,
              nextY,
              width / 2,
              width / 2,
              0,
              Math.max(1, height - 1),
            ) < COLLAR_STANDALONE_MIN_GEOMETRY
          ) {
            continue
          }
          const next = nextY * width + nextX
          if (visited[next] || labels[next] !== rearLabel) continue
          visited[next] = 1
          queue.push(next)
        }
      }
      const span = maximumX - minimumX + 1
      components.push({ pixels, span, score: pixels.length * span })
    }
  }
  return components.sort((left, right) => right.score - left.score)
}

function collarColorMaskAt(
  mask: CollarColorMask | undefined,
  x: number,
  y: number,
): number {
  if (!mask) return 0
  const localX = x - mask.left
  const localY = y - mask.top
  if (
    localX < 0 ||
    localX >= mask.width ||
    localY < 0 ||
    localY >= mask.height
  ) {
    return 0
  }
  return mask.data[localY * mask.width + localX]
}

/**
 * Feather only the internal front/rear seam of a standalone PSD mask. Pixels
 * outside the classified overlap are ignored, preserving the source layer's
 * own antialiased outer contour while avoiding a rigid cut between two meshes.
 */
function collarStandaloneRearAmount(
  mask: CollarReferenceMask | undefined,
  x: number,
  y: number,
): number {
  if (!mask) return -1
  const localX = x - mask.left
  const localY = y - mask.top
  if (
    localX < 0 ||
    localX >= mask.width ||
    localY < 0 ||
    localY >= mask.height
  ) {
    return -1
  }
  const center = mask.data[localY * mask.width + localX]
  if (center === 0) return -1

  let rearWeight = 0
  let classifiedWeight = 0
  for (
    let sampleY = Math.max(0, localY - 1);
    sampleY <= Math.min(mask.height - 1, localY + 1);
    sampleY += 1
  ) {
    for (
      let sampleX = Math.max(0, localX - 1);
      sampleX <= Math.min(mask.width - 1, localX + 1);
      sampleX += 1
    ) {
      const value = mask.data[sampleY * mask.width + sampleX]
      if (value === 0) continue
      const horizontalDistance = Math.abs(sampleX - localX)
      const verticalDistance = Math.abs(sampleY - localY)
      const weight =
        horizontalDistance === 0 && verticalDistance === 0
          ? 4
          : horizontalDistance + verticalDistance === 1
            ? 2
            : 1
      classifiedWeight += weight
      if (value === COLLAR_REFERENCE_REAR) rearWeight += weight
    }
  }
  return classifiedWeight > 0 ? rearWeight / classifiedWeight : -1
}

function collarColorDistance(
  sample: CollarColorSample,
  centroid: [number, number, number],
): number {
  const lightness = sample.lightness - centroid[0]
  const chromaA = sample.chromaA - centroid[1]
  const chromaB = sample.chromaB - centroid[2]
  return lightness * lightness * 4 + chromaA * chromaA + chromaB * chromaB
}

function oklabAt(
  data: Uint8ClampedArray,
  pixel: number,
): [number, number, number] {
  const red = linearSrgb(data[pixel])
  const green = linearSrgb(data[pixel + 1])
  const blue = linearSrgb(data[pixel + 2])
  const long = Math.cbrt(
    0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue,
  )
  const medium = Math.cbrt(
    0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue,
  )
  const short = Math.cbrt(
    0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue,
  )
  return [
    0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short,
    1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short,
    0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short,
  ]
}

function linearSrgb(value: number): number {
  const normalized = value / 255
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4
}

function collarBoundaryRearAmount(
  x: number,
  y: number,
  centerX: number,
  halfWidth: number,
  exposedTop: number,
  exposedHeight: number,
): number {
  const horizontal = clamp(Math.abs(x + 0.5 - centerX) / halfWidth, 0, 1)
  const boundaryFraction =
    COLLAR_BOUNDARY_CENTER -
    (COLLAR_BOUNDARY_CENTER - COLLAR_BOUNDARY_SIDE) *
      horizontal ** COLLAR_BOUNDARY_CURVE
  const boundaryY = exposedTop + exposedHeight * boundaryFraction
  const transition = clamp(
    (boundaryY + COLLAR_BOUNDARY_FEATHER - (y + 0.5)) /
      (COLLAR_BOUNDARY_FEATHER * 2),
    0,
    1,
  )
  return transition * transition * (3 - 2 * transition)
}

function buildCollarReferenceMask(
  reference: Anime25DSourceReference,
  neck: RasterLayer,
  topwear: RasterLayer,
  exposedTop: number,
  exposedBottom: number,
): CollarReferenceMask {
  const left = Math.ceil(neck.left)
  const right = Math.floor(neck.left + neck.width)
  const width = right - left
  const height = exposedBottom - exposedTop + 1
  const raw = new Uint8Array(width * height)
  for (let y = exposedTop; y <= exposedBottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      if (x < 0 || y < 0 || x >= reference.width || y >= reference.height) {
        continue
      }
      const referencePixel = (y * reference.width + x) * 4
      if (reference.data[referencePixel + 3] < ALPHA_COMPONENT_THRESHOLD) {
        continue
      }
      const neckPixel = rasterPixelIndex(neck, x, y)
      const topwearPixel = rasterPixelIndex(topwear, x, y)
      if (
        neckPixel < 0 ||
        topwearPixel < 0 ||
        neck.data[neckPixel + 3] < ALPHA_COMPONENT_THRESHOLD ||
        topwear.data[topwearPixel + 3] < ALPHA_COMPONENT_THRESHOLD
      ) {
        continue
      }
      const neckDistance = perceptualColorDistance(
        reference.data,
        referencePixel,
        neck.data,
        neckPixel,
      )
      const topwearDistance = perceptualColorDistance(
        reference.data,
        referencePixel,
        topwear.data,
        topwearPixel,
      )
      const confidence =
        Math.abs(neckDistance - topwearDistance) /
        (neckDistance + topwearDistance + 1)
      const pixel = (y - exposedTop) * width + x - left
      if (
        neckDistance < topwearDistance &&
        neckDistance <= COLLAR_REFERENCE_REAR_MATCH_DISTANCE &&
        confidence >= COLLAR_REFERENCE_REAR_CONFIDENCE
      ) {
        raw[pixel] = COLLAR_REFERENCE_REAR
      } else if (
        topwearDistance < neckDistance &&
        topwearDistance <= COLLAR_REFERENCE_FRONT_MATCH_DISTANCE &&
        confidence >= COLLAR_REFERENCE_FRONT_CONFIDENCE
      ) {
        raw[pixel] = COLLAR_REFERENCE_FRONT
      }
    }
  }

  const cleaned = new Uint8Array(raw.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x
      const value = raw[pixel]
      if (value === 0) continue
      const neighbours = collarReferenceNeighbourCounts(
        raw,
        width,
        height,
        x,
        y,
      )
      if (
        (value === COLLAR_REFERENCE_REAR && neighbours.rear >= 3) ||
        (value === COLLAR_REFERENCE_FRONT && neighbours.front >= 3)
      ) {
        cleaned[pixel] = value
      }
    }
  }
  const filled = new Uint8Array(cleaned)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x
      if (cleaned[pixel] !== 0) continue
      const neighbours = collarReferenceNeighbourCounts(
        cleaned,
        width,
        height,
        x,
        y,
      )
      if (neighbours.front >= 6 && neighbours.rear <= 1) {
        filled[pixel] = COLLAR_REFERENCE_FRONT
      } else if (neighbours.rear >= 6 && neighbours.front <= 1) {
        filled[pixel] = COLLAR_REFERENCE_REAR
      }
    }
  }
  return { left, top: exposedTop, width, height, data: filled }
}

function collarReferenceNeighbourCounts(
  data: Uint8Array,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
): { rear: number; front: number } {
  let rear = 0
  let front = 0
  for (
    let y = Math.max(0, centerY - 1);
    y <= Math.min(height - 1, centerY + 1);
    y += 1
  ) {
    for (
      let x = Math.max(0, centerX - 1);
      x <= Math.min(width - 1, centerX + 1);
      x += 1
    ) {
      const value = data[y * width + x]
      if (value === COLLAR_REFERENCE_REAR) rear += 1
      else if (value === COLLAR_REFERENCE_FRONT) front += 1
    }
  }
  return { rear, front }
}

function collarReferenceMaskAt(
  mask: CollarReferenceMask | undefined,
  x: number,
  y: number,
): number {
  if (!mask) return 0
  const localX = x - mask.left
  const localY = y - mask.top
  if (
    localX < 0 ||
    localX >= mask.width ||
    localY < 0 ||
    localY >= mask.height
  ) {
    return 0
  }
  return mask.data[localY * mask.width + localX]
}

function perceptualColorDistance(
  left: Uint8ClampedArray,
  leftPixel: number,
  right: Uint8ClampedArray,
  rightPixel: number,
): number {
  const red = left[leftPixel] - right[rightPixel]
  const green = left[leftPixel + 1] - right[rightPixel + 1]
  const blue = left[leftPixel + 2] - right[rightPixel + 2]
  return red * red * 2 + green * green * 4 + blue * blue
}

function rasterPixelIndex(
  layer: RasterLayer,
  canvasX: number,
  canvasY: number,
): number {
  const x = canvasX - Math.round(layer.left)
  const y = canvasY - Math.round(layer.top)
  if (x < 0 || y < 0 || x >= layer.width || y >= layer.height) return -1
  return (y * layer.width + x) * 4
}

function rasterAlphaAt(layer: RasterLayer, canvasX: number, canvasY: number) {
  const pixel = rasterPixelIndex(layer, canvasX, canvasY)
  return pixel < 0 ? 0 : layer.data[pixel + 3]
}

function splitHandwearIfNeeded(
  layers: RasterLayer[],
  faceCenterX: number,
): RasterLayer[] {
  const output: RasterLayer[] = []
  const usedIds = new Set(layers.map((layer) => layer.id))
  for (const layer of layers) {
    if (layer.role !== 'handwear' || layer.side) {
      output.push(layer)
      continue
    }
    for (const side of ['right', 'left'] as const) {
      const split = splitRasterByComponents(layer, faceCenterX, side)
      if (!rasterBounds(split)) continue
      split.id = uniquePartId(`handwear-${side}`, usedIds)
      split.side = side
      output.push(trimRaster(split))
    }
  }
  return output
}

function splitVariantEyesIfNeeded(
  layers: RasterLayer[],
  faceCenterX: number,
  role: 'eye-dizzy' | 'eye-squeeze' | 'eye-cry',
): RasterLayer[] {
  const output: RasterLayer[] = []
  const usedIds = new Set(layers.map((layer) => layer.id))
  for (const layer of layers) {
    if (layer.role !== role || layer.side) {
      output.push(layer)
      continue
    }
    for (const side of ['left', 'right'] as const) {
      const split = splitRasterByComponents(layer, faceCenterX, side)
      if (!rasterBounds(split)) continue
      split.id = uniquePartId(`${role}-${side}`, usedIds)
      split.side = side
      output.push(trimRaster(split))
    }
  }
  return output
}

function synthesizeMissingDizzyEyes(
  layers: RasterLayer[],
  anchors: Anime25DRiggerAnchors,
): RasterLayer[] {
  const generated: RasterLayer[] = []
  const usedIds = new Set(layers.map((layer) => layer.id))
  for (const side of ['left', 'right'] as const) {
    if (
      layers.some((layer) => layer.role === 'eye-dizzy' && layer.side === side)
    ) {
      continue
    }
    const eye = side === 'left' ? anchors.eyeL : anchors.eyeR
    if (!eye) continue
    const eyelash = layers.find(
      (layer) => layer.role === 'eyelash' && layer.side === side,
    )
    const size = dizzyEyeGeneratedSize(eye)
    const bitmap = createDizzyEyeBitmap(
      size,
      sampleDizzyEyeTint(eyelash?.data),
      side,
    )
    generated.push({
      id: uniquePartId(`eye-dizzy-${side}`, usedIds),
      role: 'eye-dizzy',
      sourceName: `eye-dizzy-${side}`,
      order: 0,
      side,
      group: 'head',
      left: Math.round(eye.icx - bitmap.width / 2),
      top: Math.round(eye.icy - bitmap.height / 2),
      width: bitmap.width,
      height: bitmap.height,
      data: bitmap.data,
    })
  }
  if (generated.length === 0) return layers
  const output = [...layers]
  let insertAt = -1
  for (let index = 0; index < output.length; index += 1) {
    if (
      output[index].role === 'eye-close' ||
      output[index].role === 'eyelash'
    ) {
      insertAt = index
    }
  }
  output.splice(insertAt + 1, 0, ...generated)
  return output
}

function synthesizeMissingSqueezeEyes(
  layers: RasterLayer[],
  anchors: Anime25DRiggerAnchors,
): RasterLayer[] {
  const generated: RasterLayer[] = []
  const usedIds = new Set(layers.map((layer) => layer.id))
  for (const side of ['left', 'right'] as const) {
    if (
      layers.some(
        (layer) => layer.role === 'eye-squeeze' && layer.side === side,
      )
    ) {
      continue
    }
    const eye = side === 'left' ? anchors.eyeL : anchors.eyeR
    if (!eye) continue
    const eyelash = layers.find(
      (layer) => layer.role === 'eyelash' && layer.side === side,
    )
    const bitmap = createSqueezeEyeBitmap(
      squeezeEyeGeneratedSize(eye),
      sampleDizzyEyeTint(eyelash?.data),
      side,
    )
    const centerY = eye.icy + (eye.closeY - eye.icy) * 0.45
    generated.push({
      id: uniquePartId(`eye-squeeze-${side}`, usedIds),
      role: 'eye-squeeze',
      sourceName: `eye-squeeze-${side}`,
      order: 0,
      side,
      group: 'head',
      left: Math.round(eye.icx - bitmap.width / 2),
      top: Math.round(centerY - bitmap.height / 2),
      width: bitmap.width,
      height: bitmap.height,
      data: bitmap.data,
    })
  }
  if (generated.length === 0) return layers
  const output = [...layers]
  let insertAt = -1
  for (let index = 0; index < output.length; index += 1) {
    if (
      output[index].role === 'eye-close' ||
      output[index].role === 'eye-dizzy' ||
      output[index].role === 'eyelash'
    ) {
      insertAt = index
    }
  }
  output.splice(insertAt + 1, 0, ...generated)
  return output
}

function synthesizeMissingCryEyes(
  layers: RasterLayer[],
  anchors: Anime25DRiggerAnchors,
): RasterLayer[] {
  const generated: RasterLayer[] = []
  const usedIds = new Set(layers.map((layer) => layer.id))
  for (const side of ['left', 'right'] as const) {
    if (
      layers.some((layer) => layer.role === 'eye-cry' && layer.side === side)
    ) {
      continue
    }
    const eye = side === 'left' ? anchors.eyeL : anchors.eyeR
    if (!eye) continue
    const eyelash = layers.find(
      (layer) => layer.role === 'eyelash' && layer.side === side,
    )
    const bitmap = createCryEyeBitmap(
      cryEyeGeneratedSize(eye),
      sampleDizzyEyeTint(eyelash?.data),
      side,
    )
    const eyeMarkCenterY = eye.icy + (eye.closeY - eye.icy) * 0.45
    generated.push({
      id: uniquePartId(`eye-cry-${side}`, usedIds),
      role: 'eye-cry',
      sourceName: `eye-cry-${side}`,
      order: 0,
      side,
      group: 'head',
      left: Math.round(eye.icx - bitmap.width / 2),
      // Anchor the squeeze mark by eye width so a longer tear canvas extends
      // downward without moving the eye artwork or the tear root.
      top: Math.round(eyeMarkCenterY - bitmap.width * 0.305),
      width: bitmap.width,
      height: bitmap.height,
      data: bitmap.data,
    })
  }
  if (generated.length === 0) return layers
  const output = [...layers]
  let insertAt = -1
  for (let index = 0; index < output.length; index += 1) {
    if (
      output[index].role === 'eye-close' ||
      output[index].role === 'eye-dizzy' ||
      output[index].role === 'eye-squeeze' ||
      output[index].role === 'eyelash'
    ) {
      insertAt = index
    }
  }
  output.splice(insertAt + 1, 0, ...generated)
  return output
}

function synthesizeMissingManiacEyeShadows(
  layers: RasterLayer[],
  anchors: Anime25DRiggerAnchors,
): RasterLayer[] {
  const generated: RasterLayer[] = []
  const usedIds = new Set(layers.map((layer) => layer.id))
  for (const side of ['left', 'right'] as const) {
    if (
      layers.some(
        (layer) => layer.role === 'maniac-eye-shadow' && layer.side === side,
      )
    ) {
      continue
    }
    const eye = side === 'left' ? anchors.eyeL : anchors.eyeR
    if (!eye) continue
    const eyelash = layers.find(
      (layer) => layer.role === 'eyelash' && layer.side === side,
    )
    const bitmap = createManiacEyeShadowBitmap(
      maniacEyeShadowGeneratedSize(eye),
      sampleDizzyEyeTint(eyelash?.data),
      side,
    )
    const eyeHeight = Math.max(1, eye.y1 - eye.y0)
    const eyeWidth = Math.max(1, eye.x1 - eye.x0)
    const inwardOffset = (side === 'left' ? 1 : -1) * eyeWidth * 0.12
    generated.push({
      id: uniquePartId(`maniac-eye-shadow-${side}`, usedIds),
      role: 'maniac-eye-shadow',
      sourceName: `maniac-eye-shadow-${side}`,
      order: 0,
      side,
      group: 'head',
      left: Math.round(eye.icx + inwardOffset - bitmap.width / 2),
      // Sink the shadow into the eyewhite edge. Its lower depth lets the
      // eyewhite crop the overlap, so the visible shadow starts flush with the
      // lower lid instead of floating on the cheek.
      top: Math.round(eye.y1 - eyeHeight * 0.22),
      width: bitmap.width,
      height: bitmap.height,
      data: bitmap.data,
      synthetic: true,
    })
  }
  if (generated.length === 0) return layers

  const output = [...layers]
  const firstEyeLayer = output.findIndex(
    (layer) =>
      layer.role === 'eyewhite' ||
      layer.role === 'irides' ||
      layer.role === 'eyelash' ||
      layer.role === 'eye-close',
  )
  if (firstEyeLayer >= 0) output.splice(firstEyeLayer, 0, ...generated)
  else output.push(...generated)
  return output
}

function synthesizeMissingMouthExpressions(
  layers: RasterLayer[],
  anchors: Anime25DRiggerAnchors,
): RasterLayer[] {
  const reference =
    layers.find((layer) => layer.role === 'mouth-close') ||
    layers.find((layer) => layer.role === 'mouth-open')
  if (!reference) return layers
  const expressions: ReadonlyArray<{
    role:
      | 'mouth-open'
      | 'mouth-wide'
      | 'mouth-round'
      | 'mouth-narrow'
      | 'mouth-cry'
      | 'mouth-maniac'
    kind: MouthExpressionKind
  }> = [
    { role: 'mouth-open', kind: 'open' },
    { role: 'mouth-wide', kind: 'wide' },
    { role: 'mouth-round', kind: 'round' },
    { role: 'mouth-narrow', kind: 'narrow' },
    { role: 'mouth-cry', kind: 'cry' },
    { role: 'mouth-maniac', kind: 'maniac' },
  ]
  const missing = expressions.filter(
    ({ role }) => !layers.some((layer) => layer.role === role),
  )
  if (missing.length === 0) return layers

  const sizes = mouthExpressionGeneratedSizes(reference, {
    width: Math.max(1, anchors.face.x1 - anchors.face.x0),
    height: Math.max(1, anchors.face.y1 - anchors.face.y0),
    mouthToChin: Math.max(1, anchors.face.y1 - anchors.mouth.cy),
  })
  const palette = sampleMouthExpressionPalette(reference.data)
  const usedIds = new Set(layers.map((layer) => layer.id))
  const generated: RasterLayer[] = []
  const add = (
    role: (typeof expressions)[number]['role'],
    kind: MouthExpressionKind,
  ) => {
    const bitmap = createMouthExpressionBitmap(kind, sizes[kind], palette)
    generated.push({
      id: uniquePartId(role, usedIds),
      role,
      sourceName: role,
      order: 0,
      side: null,
      group: 'head',
      left: Math.round(anchors.mouth.cx - bitmap.width / 2),
      top: Math.round(
        anchors.mouth.cy -
          bitmap.height *
            (kind === 'cry' ? 0.46 : kind === 'maniac' ? 0.61 : 0.5) +
          (kind === 'maniac' ? 3 : 0),
      ),
      width: bitmap.width,
      height: bitmap.height,
      data: bitmap.data,
      synthetic: true,
    })
  }
  for (const expression of missing) add(expression.role, expression.kind)

  const output = [...layers]
  let insertAt = -1
  for (let index = 0; index < output.length; index += 1) {
    if (
      output[index].role === 'mouth-open' ||
      output[index].role === 'mouth-close' ||
      output[index].role === 'mouth-wide' ||
      output[index].role === 'mouth-round' ||
      output[index].role === 'mouth-narrow' ||
      output[index].role === 'mouth-cry' ||
      output[index].role === 'mouth-maniac'
    ) {
      insertAt = index
    }
  }
  output.splice(insertAt + 1, 0, ...generated)
  return output
}

function synthesizeMissingExpressionSymbols(
  layers: RasterLayer[],
  anchors: Anime25DRiggerAnchors,
): RasterLayer[] {
  const needsAnger = !layers.some((layer) => layer.role === 'anger-mark')
  const needsSweat = !layers.some((layer) => layer.role === 'speechless-sweat')
  if (!needsAnger && !needsSweat) return layers

  const faceWidth = Math.max(1, anchors.face.x1 - anchors.face.x0)
  const faceHeight = Math.max(1, anchors.face.y1 - anchors.face.y0)
  const sizes = expressionSymbolGeneratedSizes(faceWidth)
  const usedIds = new Set(layers.map((layer) => layer.id))
  const eyelash = layers.find((layer) => layer.role === 'eyelash')
  const tint = sampleDizzyEyeTint(eyelash?.data)
  const generated: RasterLayer[] = []

  if (needsAnger) {
    const bitmap = createAngerMarkBitmap(sizes.anger, tint)
    const centerX = anchors.face.x0 + faceWidth * 0.13
    const centerY = anchors.face.y0 + faceHeight * 0.22
    generated.push({
      id: uniquePartId('anger-mark', usedIds),
      role: 'anger-mark',
      sourceName: 'anger-mark',
      order: 0,
      side: null,
      group: 'head',
      left: Math.round(centerX - bitmap.width / 2),
      top: Math.round(centerY - bitmap.height / 2),
      width: bitmap.width,
      height: bitmap.height,
      data: bitmap.data,
      synthetic: true,
    })
  }

  if (needsSweat) {
    const bitmap = createSpeechlessSweatBitmap(sizes.speechless)
    const eyeY = anchors.eyeR?.icy ?? anchors.eyeL?.icy
    const centerX = anchors.face.x1 - faceWidth * 0.015
    const centerY = eyeY ?? anchors.face.y0 + faceHeight * 0.48
    generated.push({
      id: uniquePartId('speechless-sweat', usedIds),
      role: 'speechless-sweat',
      sourceName: 'speechless-sweat',
      order: 0,
      side: null,
      group: 'head',
      left: Math.round(centerX - bitmap.width / 2),
      top: Math.round(centerY - bitmap.height * 0.2),
      width: bitmap.width,
      height: bitmap.height,
      data: bitmap.data,
      synthetic: true,
    })
  }

  return [...layers, ...generated]
}

function validPixelData(value: PixelData | undefined): value is PixelData {
  return Boolean(
    value &&
    value.width > 0 &&
    value.height > 0 &&
    (value.data instanceof Uint8Array ||
      value.data instanceof Uint8ClampedArray) &&
    value.data.length === value.width * value.height * 4,
  )
}

function splitRasterByComponents(
  source: RasterLayer,
  faceCenterX: number,
  anatomicalSide: EyeSide,
): RasterLayer {
  const output = { ...source, data: new Uint8ClampedArray(source.data) }
  const components = labelAlphaComponents(
    source.data,
    source.width,
    source.height,
  )
  const keep = new Set<number>()
  for (let component = 1; component <= components.count; component += 1) {
    if (components.sizes[component] < 20) continue
    const canvasX =
      source.left + components.sumX[component] / components.sizes[component]
    const side: EyeSide = canvasX < faceCenterX ? 'left' : 'right'
    if (side === anatomicalSide) keep.add(component)
  }
  for (let pixel = 0; pixel < components.labels.length; pixel += 1) {
    if (!keep.has(components.labels[pixel])) output.data[pixel * 4 + 3] = 0
  }
  return output
}

function assignCrossfadeSlots(layers: RasterLayer[]): void {
  for (const side of ['left', 'right'] as const) {
    const open = layers.find(
      (layer) => layer.role === 'eyelash' && layer.side === side,
    )
    const closed = layers.find(
      (layer) => layer.role === 'eye-close' && layer.side === side,
    )
    const dizzy = layers.find(
      (layer) => layer.role === 'eye-dizzy' && layer.side === side,
    )
    const squeeze = layers.find(
      (layer) => layer.role === 'eye-squeeze' && layer.side === side,
    )
    const cry = layers.find(
      (layer) => layer.role === 'eye-cry' && layer.side === side,
    )
    const slot = side === 'left' ? 'eye-left' : 'eye-right'
    if (open) {
      open.slot = slot
      open.variant = 'open'
    }
    if (closed) {
      closed.slot = slot
      closed.variant = 'closed'
    }
    if (dizzy) {
      dizzy.slot = slot
      dizzy.variant = 'dizzy'
    }
    if (squeeze) {
      squeeze.slot = slot
      squeeze.variant = 'squeeze'
    }
    if (cry) {
      cry.slot = slot
      cry.variant = 'cry'
    }
  }
  const mouthVariants = [
    ['mouth-open', 'open'],
    ['mouth-wide', 'wide'],
    ['mouth-round', 'round'],
    ['mouth-narrow', 'narrow'],
    ['mouth-close', 'closed'],
    ['mouth-cry', 'cry'],
    ['mouth-maniac', 'maniac'],
  ] as const
  for (const [role, variant] of mouthVariants) {
    const layer = layers.find((candidate) => candidate.role === role)
    if (layer) {
      layer.slot = 'mouth'
      layer.variant = variant
    }
  }
}

function validateCharacterAssetLayers(layers: readonly RasterLayer[]): void {
  const hasRole = (role: Anime25DLayerRole) =>
    layers.some((layer) => layer.role === role)
  const hasSides = (role: Anime25DLayerRole) =>
    (['left', 'right'] as const).every((side) =>
      layers.some((layer) => layer.role === role && layer.side === side),
    )
  const missing: string[] = []
  if (!hasRole('face')) missing.push('face')
  if (!hasRole('front-hair')) missing.push('front-hair')
  if (!hasRole('back-hair')) missing.push('back-hair')
  if (!hasRole('topwear')) missing.push('topwear')
  if (
    !hasSides('eyelash') ||
    !hasSides('eye-close') ||
    !hasSides('eye-dizzy') ||
    !hasSides('eye-squeeze') ||
    !hasSides('eye-cry')
  ) {
    missing.push('independent open/closed/dizzy/squeeze/cry eyes')
  }
  if (
    !hasRole('mouth-open') ||
    !hasRole('mouth-wide') ||
    !hasRole('mouth-round') ||
    !hasRole('mouth-narrow') ||
    !hasRole('mouth-close') ||
    !hasRole('mouth-cry') ||
    !hasRole('mouth-maniac')
  ) {
    missing.push('open/wide/round/narrow/closed/cry/maniac mouth')
  }
  if (!hasSides('handwear')) {
    missing.push('left/right sleeve-forearm-hand fragments')
  }
  if (missing.length > 0) {
    throw new Error(
      currentCopy().merope.anime25dContractMissing.replace(
        '{missing}',
        missing.join(', '),
      ),
    )
  }
}

/** Removes model letterboxing, then pads (never stretches) into the canonical 3:4 stage. */
function contentFrame(
  psd: Psd,
  layers: readonly RasterLayer[],
): RigCanvasFrame {
  const documentArea = psd.width * psd.height
  const framingLayers = layers.filter(
    (layer) =>
      layer.role !== 'bottomwear' &&
      (layer.role !== 'unknown' ||
        layer.width * layer.height < documentArea * 0.5),
  )
  const candidates = framingLayers.length > 0 ? framingLayers : layers
  let left = psd.width
  let top = psd.height
  let right = 0
  let bottom = 0
  for (const layer of candidates) {
    left = Math.min(left, layer.left)
    top = Math.min(top, layer.top)
    right = Math.max(right, layer.left + layer.width)
    bottom = Math.max(bottom, layer.top + layer.height)
  }
  if (right <= left || bottom <= top) {
    return { x: 0, y: 0, width: psd.width, height: psd.height }
  }
  const horizontalPadding = Math.max(4, Math.round((right - left) * 0.04))
  const verticalPadding = Math.max(4, Math.round((bottom - top) * 0.025))
  left = Math.max(0, Math.floor(left - horizontalPadding))
  top = Math.max(0, Math.floor(top - verticalPadding))
  right = Math.min(psd.width, Math.ceil(right + horizontalPadding))
  bottom = Math.min(psd.height, Math.ceil(bottom + verticalPadding))
  let width = Math.max(1, right - left)
  let height = Math.max(1, bottom - top)
  const targetAspect = PORTRAIT_CANVAS.width / PORTRAIT_CANVAS.height
  if (width / height > targetAspect) {
    const targetHeight = width / targetAspect
    top -= (targetHeight - height) / 2
    height = targetHeight
  } else {
    const targetWidth = height * targetAspect
    left -= (targetWidth - width) / 2
    width = targetWidth
  }
  return { x: left, y: top, width, height }
}

async function packAtlas(
  frame: RigCanvasFrame,
  layers: RasterLayer[],
): Promise<{
  atlas: Blob
  analysisReference: Blob
  layers: PreparedLayer[]
  width: number
  height: number
}> {
  const places: Array<{ x: number; y: number }> = []
  let cursorX = ATLAS_PADDING
  let cursorY = ATLAS_PADDING
  let rowHeight = 0
  let packedWidth = ATLAS_PADDING
  let packedHeight = ATLAS_PADDING
  for (const layer of layers) {
    const drawWidth = Math.max(1, layer.width)
    const drawHeight = Math.max(1, layer.height)
    if (drawWidth + ATLAS_PADDING * 2 > MAX_ATLAS_EDGE) {
      throw new Error(
        currentCopy()
          .merope.anime25dLayerTooWide.replace('{id}', layer.id)
          .replace('{max}', String(MAX_ATLAS_EDGE)),
      )
    }
    if (cursorX + drawWidth + ATLAS_PADDING > MAX_ATLAS_EDGE) {
      cursorX = ATLAS_PADDING
      cursorY += rowHeight + ATLAS_PADDING
      rowHeight = 0
    }
    if (cursorY + drawHeight + ATLAS_PADDING > MAX_ATLAS_EDGE) {
      throw new Error(
        currentCopy().merope.anime25dAtlasOverflow.replace(
          '{max}',
          String(MAX_ATLAS_EDGE),
        ),
      )
    }
    places.push({ x: cursorX, y: cursorY })
    cursorX += drawWidth + ATLAS_PADDING
    rowHeight = Math.max(rowHeight, drawHeight)
    packedWidth = Math.max(packedWidth, cursorX)
    packedHeight = Math.max(packedHeight, cursorY + drawHeight + ATLAS_PADDING)
  }
  packedWidth = Math.max(MIN_ATLAS_EDGE, packedWidth)
  packedHeight = Math.max(MIN_ATLAS_EDGE, packedHeight)
  const atlas = document.createElement('canvas')
  atlas.width = packedWidth
  atlas.height = packedHeight
  const context = requiredContext(atlas)
  const analysisCanvas = document.createElement('canvas')
  analysisCanvas.width = Math.max(1, Math.round(frame.width))
  analysisCanvas.height = Math.max(1, Math.round(frame.height))
  const analysisContext = requiredContext(analysisCanvas)
  const analysisScaleX = analysisCanvas.width / Math.max(1, frame.width)
  const analysisScaleY = analysisCanvas.height / Math.max(1, frame.height)
  const layerCanvas = document.createElement('canvas')
  const prepared: PreparedLayer[] = []
  for (const [index, layer] of layers.entries()) {
    const drawX = places[index].x
    const drawY = places[index].y
    layerCanvas.width = layer.width
    layerCanvas.height = layer.height
    const imageBytes = new Uint8ClampedArray(layer.data.length)
    imageBytes.set(layer.data)
    requiredContext(layerCanvas).putImageData(
      new ImageData(imageBytes, layer.width, layer.height),
      0,
      0,
    )
    context.drawImage(layerCanvas, drawX, drawY)
    if (visibleInAnalysisReference(layer)) {
      analysisContext.drawImage(
        layerCanvas,
        (layer.left - frame.x) * analysisScaleX,
        (layer.top - frame.y) * analysisScaleY,
        layer.width * analysisScaleX,
        layer.height * analysisScaleY,
      )
    }
    const bounds = {
      x: (layer.left - frame.x) / frame.width,
      y: (layer.top - frame.y) / frame.width,
      width: layer.width / frame.width,
      height: layer.height / frame.width,
    }
    prepared.push({
      ...layer,
      bounds,
      textureBounds: {
        x: drawX / packedWidth,
        y: drawY / packedHeight,
        width: layer.width / packedWidth,
        height: layer.height / packedHeight,
      },
      strands:
        layer.role === 'front-hair' || layer.role === 'back-hair'
          ? (layer.documentStrands || []).map((strand) => ({
              x: (strand.x - frame.x) / frame.width,
              rootY: (strand.rootY - frame.y) / frame.width,
              tipY: (strand.tipY - frame.y) / frame.width,
            }))
          : [],
    })
  }
  const [blob, analysisReference] = await Promise.all([
    canvasPng(atlas),
    canvasPng(analysisCanvas),
  ])
  return {
    atlas: blob,
    analysisReference,
    layers: prepared,
    width: packedWidth,
    height: packedHeight,
  }
}

function visibleInAnalysisReference(layer: RasterLayer): boolean {
  if (
    layer.role === 'maniac-eye-shadow' ||
    layer.role === 'anger-mark' ||
    layer.role === 'speechless-sweat'
  ) {
    return false
  }
  if (
    (layer.slot === 'eye-left' || layer.slot === 'eye-right') &&
    layer.variant !== 'open'
  ) {
    return false
  }
  return layer.slot !== 'mouth' || layer.variant === 'closed'
}

function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value
          ? resolve(value)
          : reject(new Error(currentCopy().merope.rigAtlasFailed)),
      'image/png',
    ),
  )
}

function deriveAnchors(
  frame: RigCanvasFrame,
  layers: PreparedLayer[],
  rawFaceCenter: RigPoint,
): AnimeAnchors {
  const face = requiredLayer(layers, 'face').bounds
  const center = (layer: PreparedLayer | undefined): RigPoint | undefined =>
    layer
      ? {
          x: layer.bounds.x + layer.bounds.width / 2,
          y: layer.bounds.y + layer.bounds.height / 2,
        }
      : undefined
  const eyes: Partial<Record<EyeSide, RigPoint>> = {}
  const irises: Partial<Record<EyeSide, RigPoint>> = {}
  for (const side of ['left', 'right'] as const) {
    const eye = layers.find(
      (layer) => layer.role === 'eyewhite' && layer.side === side,
    )
    const iris = layers.find(
      (layer) => layer.role === 'irides' && layer.side === side,
    )
    const fallback = layers.find(
      (layer) => layer.role === 'eyelash' && layer.side === side,
    )
    const eyeCenter = center(eye || fallback)
    if (eyeCenter) eyes[side] = eyeCenter
    const irisCenter = center(iris)
    if (irisCenter) irises[side] = irisCenter
  }
  const neckLayer = layers.find((layer) => layer.role === 'neck')
  const topwear = layers.find((layer) => layer.role === 'topwear')
  const bottomwear = layers.find((layer) => layer.role === 'bottomwear')
  const bodyReference = topwear || bottomwear || neckLayer
  const neck = neckLayer
    ? {
        x: neckLayer.bounds.x + neckLayer.bounds.width / 2,
        y: neckLayer.bounds.y + neckLayer.bounds.height * 0.85,
      }
    : {
        x: face.x + face.width / 2,
        y: face.y + face.height + 20 / frame.width,
      }
  const bodyBottom = bodyReference
    ? {
        x: bodyReference.bounds.x + bodyReference.bounds.width / 2,
        y: bodyReference.bounds.y + bodyReference.bounds.height,
      }
    : { x: 0.5, y: frame.height / frame.width }
  const mouth = center(
    layers.find((layer) => layer.role === 'mouth-open') ||
      layers.find((layer) => layer.role === 'mouth-close'),
  )
  return {
    face,
    faceCenter: {
      x: (rawFaceCenter.x - frame.x) / frame.width,
      y: (rawFaceCenter.y - frame.y) / frame.width,
    },
    neck,
    bodyBottom,
    eyes,
    irises,
    mouth: mouth || null,
  }
}

function buildBonesAndHandles(
  layers: PreparedLayer[],
  anchors: AnimeAnchors,
): {
  bones: RigBone[]
  layerHandles: Map<string, RigBoneHandle[]>
  secondaryBoneIds: string[]
} {
  const bones: RigBone[] = [
    { id: 'root', parent: null, pivot: anchors.bodyBottom },
    { id: 'body', parent: 'root', pivot: anchors.neck },
    { id: 'head', parent: 'body', pivot: anchors.neck },
    { id: 'face', parent: 'head', pivot: anchors.faceCenter },
  ]
  const ensureBone = (id: string, parent: string, pivot: RigPoint): string => {
    if (!bones.some((bone) => bone.id === id)) bones.push({ id, parent, pivot })
    return id
  }
  for (const side of ['left', 'right'] as const) {
    const eye = anchors.eyes[side]
    if (!eye) continue
    ensureBone(`${side}-eye`, 'face', eye)
    if (
      layers.some((layer) => layer.side === side && layer.role === 'eyewhite')
    ) {
      ensureBone(`a25d-eyewhite-${side}`, 'face', eye)
    }
    if (anchors.irises[side]) {
      ensureBone(`a25d-irides-${side}`, `${side}-eye`, anchors.irises[side]!)
    }
    if (
      layers.some(
        (layer) =>
          layer.side === side &&
          (layer.role === 'eyelash' || layer.role === 'eye-close'),
      )
    ) {
      ensureBone(`a25d-eyelash-${side}`, 'face', eye)
    }
    ensureBone(`a25d-eyebrow-${side}`, 'face', {
      x: eye.x,
      y: eye.y - anchors.face.height * 0.12,
    })
  }
  if (anchors.mouth) ensureBone('mouth', 'face', anchors.mouth)
  if (layers.some((layer) => layer.role === 'topwear')) {
    ensureBone('a25d-chest', 'body', {
      x: anchors.neck.x,
      y: anchors.neck.y + anchors.face.height * 0.35,
    })
  }
  if (layers.some((layer) => layer.role === 'handwear')) {
    const handwearLayers = layers.filter((layer) => layer.role === 'handwear')
    const handwear = unionLayerBounds(handwearLayers)
    ensureBone('a25d-handwear', 'body', {
      x: handwear.x + handwear.width / 2,
      y: handwear.y + handwear.height * 0.22,
    })
    for (const side of ['left', 'right'] as const) {
      const sideLayer = handwearLayers.find((layer) => layer.side === side)
      if (!sideLayer) continue
      ensureBone(`a25d-handwear-${side}`, 'a25d-handwear', {
        x: sideLayer.bounds.x + sideLayer.bounds.width / 2,
        y: sideLayer.bounds.y + sideLayer.bounds.height * 0.16,
      })
    }
  }
  const independentHeadRoles: Anime25DLayerRole[] = [
    'nose',
    'ears',
    'earwear',
    'headwear',
    'facedetail',
  ]
  for (const role of independentHeadRoles) {
    const layer = layers.find((candidate) => candidate.role === role)
    if (!layer) continue
    ensureBone(`a25d-${role}`, 'head', rectCenter(layer.bounds))
  }

  const secondaryBoneIds: string[] = []
  const hairBones = new Map<string, RigBoneHandle[]>()
  let availableStrands = Math.max(
    0,
    Math.floor((MAX_RIG_BONES - bones.length) / 2),
  )
  for (const layer of layers.filter(
    (candidate) =>
      candidate.role === 'front-hair' || candidate.role === 'back-hair',
  )) {
    const selected = layer.strands.slice(0, availableStrands)
    availableStrands -= selected.length
    const handles: RigBoneHandle[] = []
    const spacing = layer.bounds.width / Math.max(2, selected.length)
    selected.forEach((strand, index) => {
      const prefix = `a25d-${layer.id}-strand-${index + 1}`
      const root = `${prefix}-hair-root`
      const tip = `${prefix}-hair-tip`
      const midY = strand.rootY + (strand.tipY - strand.rootY) * 0.48
      bones.push({
        id: root,
        parent: 'head',
        pivot: { x: strand.x, y: strand.rootY },
      })
      bones.push({ id: tip, parent: root, pivot: { x: strand.x, y: midY } })
      secondaryBoneIds.push(root, tip)
      handles.push(
        {
          boneId: root,
          start: { x: strand.x, y: strand.rootY },
          end: { x: strand.x, y: midY },
          falloff: Math.max(0.025, spacing * 0.95),
        },
        {
          boneId: tip,
          start: { x: strand.x, y: midY },
          end: { x: strand.x, y: strand.tipY },
          falloff: Math.max(0.025, spacing * 0.82),
        },
      )
    })
    if (handles.length === 0) handles.push(fullLayerHandle(layer, 'head'))
    hairBones.set(layer.id, handles)
  }
  if (bones.length > MAX_RIG_BONES) {
    throw new Error(
      currentCopy().merope.anime25dBoneLimit.replace(
        '{max}',
        String(MAX_RIG_BONES),
      ),
    )
  }

  const layerHandles = new Map<string, RigBoneHandle[]>()
  for (const layer of layers) {
    const hair = hairBones.get(layer.id)
    if (hair) {
      layerHandles.set(layer.id, hair)
      continue
    }
    layerHandles.set(layer.id, handlesForLayer(layer, bones))
  }
  return { bones, layerHandles, secondaryBoneIds }
}

function handlesForLayer(
  layer: PreparedLayer,
  bones: RigBone[],
): RigBoneHandle[] {
  const has = (id: string) => bones.some((bone) => bone.id === id)
  const side = layer.side
  if (layer.role === 'face') return [fullLayerHandle(layer, 'face')]
  if (
    layer.role === 'maniac-eye-shadow' ||
    layer.role === 'anger-mark' ||
    layer.role === 'speechless-sweat'
  ) {
    return [fullLayerHandle(layer, 'face')]
  }
  if (side && layer.role === 'eyewhite' && has(`a25d-eyewhite-${side}`)) {
    return [fullLayerHandle(layer, `a25d-eyewhite-${side}`)]
  }
  if (
    side &&
    (layer.role === 'eyelash' ||
      layer.role === 'eye-close' ||
      layer.role === 'eye-dizzy' ||
      layer.role === 'eye-squeeze' ||
      layer.role === 'eye-cry') &&
    has(`a25d-eyelash-${side}`)
  ) {
    return [fullLayerHandle(layer, `a25d-eyelash-${side}`)]
  }
  if (side && layer.role === 'irides' && has(`a25d-irides-${side}`)) {
    return [fullLayerHandle(layer, `a25d-irides-${side}`)]
  }
  if (side && layer.role === 'eyebrow' && has(`a25d-eyebrow-${side}`)) {
    return [fullLayerHandle(layer, `a25d-eyebrow-${side}`)]
  }
  if (
    (layer.role === 'mouth-open' ||
      layer.role === 'mouth-wide' ||
      layer.role === 'mouth-round' ||
      layer.role === 'mouth-narrow' ||
      layer.role === 'mouth-close' ||
      layer.role === 'mouth-cry' ||
      layer.role === 'mouth-maniac') &&
    has('mouth')
  ) {
    return [fullLayerHandle(layer, 'mouth')]
  }
  if (layer.role === 'topwear' && has('a25d-chest')) {
    return verticalBlendHandles(layer, 'body', 'a25d-chest', 0.58)
  }
  if (layer.role === 'collar-back' || layer.role === 'collar-front') {
    return [fullLayerHandle(layer, 'body')]
  }
  if (layer.role === 'neck') {
    return verticalBlendHandles(layer, 'head', 'body', 0.72)
  }
  if (layer.role === 'handwear' && has('a25d-handwear')) {
    const sideBone = layer.side ? `a25d-handwear-${layer.side}` : ''
    return [
      fullLayerHandle(
        layer,
        sideBone && has(sideBone) ? sideBone : 'a25d-handwear',
      ),
    ]
  }
  if (layer.role === 'bottomwear') return [fullLayerHandle(layer, 'root')]
  const dedicated = `a25d-${layer.role}`
  if (has(dedicated)) return [fullLayerHandle(layer, dedicated)]
  const group =
    layer.bounds.y + layer.bounds.height / 2 < 0.62 ? 'head' : 'body'
  return [fullLayerHandle(layer, group)]
}

function fullLayerHandle(layer: PreparedLayer, boneId: string): RigBoneHandle {
  return {
    boneId,
    start: {
      x: layer.bounds.x + layer.bounds.width / 2,
      y: layer.bounds.y,
    },
    end: {
      x: layer.bounds.x + layer.bounds.width / 2,
      y: layer.bounds.y + layer.bounds.height,
    },
    falloff: Math.max(layer.bounds.width, layer.bounds.height, 0.02),
  }
}

function verticalBlendHandles(
  layer: PreparedLayer,
  topBone: string,
  bottomBone: string,
  split: number,
): RigBoneHandle[] {
  const centerX = layer.bounds.x + layer.bounds.width / 2
  const middleY = layer.bounds.y + layer.bounds.height * split
  const falloff = Math.max(
    layer.bounds.width * 0.68,
    layer.bounds.height * 0.38,
  )
  return [
    {
      boneId: topBone,
      start: { x: centerX, y: layer.bounds.y },
      end: { x: centerX, y: middleY },
      falloff,
    },
    {
      boneId: bottomBone,
      start: { x: centerX, y: middleY },
      end: { x: centerX, y: layer.bounds.y + layer.bounds.height },
      falloff,
    },
  ]
}

function buildLayerSources(
  layers: PreparedLayer[],
  handles: Map<string, RigBoneHandle[]>,
): RigLayerSource[] {
  return layers.map((layer) => {
    const mesh = gridMesh(layer.bounds, layer.role)
    const depth =
      layer.role === 'unknown' ? 1 : ANIME25D_LAYER_DEPTH[layer.role]
    return {
      id: `a25d-${layer.id}`,
      textureId: 'atlas',
      textureBounds: layer.textureBounds,
      // ag-psd exposes this PSD bottom-to-top. Anime2.5DRig deliberately
      // overrides that order with its semantic depth table, then keeps the PSD
      // order as a stable tie-break for numbered/repeated layers.
      zIndex: Math.round(depth * 100) * 100 + Math.round(layer.order),
      opacity: 1,
      slot: layer.slot,
      variant: layer.variant,
      contours: [],
      mesh,
      boneHandles: handles.get(layer.id) || [fullLayerHandle(layer, 'body')],
    }
  })
}

export function gridMesh(
  bounds: RigRect,
  role: Anime25DLayerRole | 'unknown',
): RigLayerMeshSource {
  const deformable =
    role === 'front-hair' ||
    role === 'back-hair' ||
    role === 'topwear' ||
    role === 'neck'
  const cell = deformable ? 0.035 : 0.075
  const columns = clampInt(
    Math.ceil(bounds.width / cell),
    2,
    deformable ? 14 : 8,
  )
  const rows = clampInt(Math.ceil(bounds.height / cell), 2, deformable ? 18 : 8)
  const vertices: RigPoint[] = []
  const indices: number[] = []
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      vertices.push({
        x: bounds.x + (bounds.width * column) / columns,
        y: bounds.y + (bounds.height * row) / rows,
      })
    }
  }
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const topLeft = row * (columns + 1) + column
      const topRight = topLeft + 1
      const bottomLeft = topLeft + columns + 1
      const bottomRight = bottomLeft + 1
      indices.push(
        topLeft,
        topRight,
        bottomLeft,
        topRight,
        bottomRight,
        bottomLeft,
      )
    }
  }
  return { vertices, indices }
}

function semanticAnchors(
  anchors: AnimeAnchors,
): MeropeRigImportSource['semanticAnchors'] {
  const relative = (boneId: string, pivot: RigPoint, point: RigPoint) => ({
    boneId,
    offset: { x: point.x - pivot.x, y: point.y - pivot.y },
  })
  return {
    forehead: relative('head', anchors.neck, {
      x: anchors.face.x + anchors.face.width * 0.5,
      y: anchors.face.y + anchors.face.height * 0.18,
    }),
    'temple-right': relative('head', anchors.neck, {
      x: anchors.face.x + anchors.face.width * 0.28,
      y: anchors.face.y + anchors.face.height * 0.3,
    }),
    chin: relative('head', anchors.neck, {
      x: anchors.face.x + anchors.face.width * 0.5,
      y: anchors.face.y + anchors.face.height * 0.88,
    }),
    chest: relative('body', anchors.neck, {
      x: anchors.neck.x,
      y: anchors.neck.y + anchors.face.height * 0.42,
    }),
  }
}

function labelAlphaComponents(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): { labels: Int32Array; sizes: number[]; sumX: number[]; count: number } {
  const labels = new Int32Array(width * height)
  const stack = new Int32Array(width * height)
  const sizes = [0]
  const sumX = [0]
  let count = 0
  for (let start = 0; start < labels.length; start += 1) {
    if (labels[start] || data[start * 4 + 3] <= ALPHA_COMPONENT_THRESHOLD)
      continue
    count += 1
    let stackSize = 0
    stack[stackSize++] = start
    labels[start] = count
    let size = 0
    let xSum = 0
    while (stackSize > 0) {
      const pixel = stack[--stackSize]
      const x = pixel % width
      const y = Math.floor(pixel / width)
      size += 1
      xSum += x
      for (const neighbor of [
        x > 0 ? pixel - 1 : -1,
        x < width - 1 ? pixel + 1 : -1,
        y > 0 ? pixel - width : -1,
        y < height - 1 ? pixel + width : -1,
      ]) {
        if (
          neighbor >= 0 &&
          labels[neighbor] === 0 &&
          data[neighbor * 4 + 3] > ALPHA_COMPONENT_THRESHOLD
        ) {
          labels[neighbor] = count
          stack[stackSize++] = neighbor
        }
      }
    }
    sizes.push(size)
    sumX.push(xSum)
  }
  return { labels, sizes, sumX, count }
}

function rasterBounds(layer: RasterLayer): RigRect | null {
  let minX = layer.width
  let minY = layer.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < layer.height; y += 1) {
    for (let x = 0; x < layer.width; x += 1) {
      if (layer.data[(y * layer.width + x) * 4 + 3] <= 8) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  return maxX < minX
    ? null
    : {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      }
}

function trimRaster(layer: RasterLayer): RasterLayer {
  const bounds = rasterBounds(layer)
  if (!bounds) return layer
  const padding = 2
  const left = Math.max(0, Math.floor(bounds.x) - padding)
  const top = Math.max(0, Math.floor(bounds.y) - padding)
  const right = Math.min(
    layer.width,
    Math.ceil(bounds.x + bounds.width) + padding,
  )
  const bottom = Math.min(
    layer.height,
    Math.ceil(bounds.y + bounds.height) + padding,
  )
  const width = right - left
  const height = bottom - top
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const start = ((y + top) * layer.width + left) * 4
    data.set(layer.data.subarray(start, start + width * 4), y * width * 4)
  }
  return {
    ...layer,
    left: layer.left + left,
    top: layer.top + top,
    width,
    height,
    data,
  }
}

function requiredLayer(
  layers: PreparedLayer[],
  role: Anime25DLayerRole,
): PreparedLayer {
  const layer = layers.find((candidate) => candidate.role === role)
  if (!layer) {
    throw new Error(
      currentCopy().merope.anime25dMissingLayer.replace('{role}', role),
    )
  }
  return layer
}

function unionLayerBounds(layers: PreparedLayer[]): RigRect {
  if (layers.length === 0) {
    throw new Error(currentCopy().merope.anime25dMissingHandwear)
  }
  const left = Math.min(...layers.map((layer) => layer.bounds.x))
  const top = Math.min(...layers.map((layer) => layer.bounds.y))
  const right = Math.max(
    ...layers.map((layer) => layer.bounds.x + layer.bounds.width),
  )
  const bottom = Math.max(
    ...layers.map((layer) => layer.bounds.y + layer.bounds.height),
  )
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function requiredContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error(currentCopy().merope.canvasUnsupported)
  return context
}

function uniquePartId(preferred: string, used: Set<string>): string {
  let id = preferred
  let suffix = 2
  while (used.has(id)) id = `${preferred}-${suffix++}`
  used.add(id)
  return id
}

function rectCenter(rect: RigRect): RigPoint {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function clampInt(value: number, minimum: number, maximum: number): number {
  return Math.round(clamp(value, minimum, maximum))
}
