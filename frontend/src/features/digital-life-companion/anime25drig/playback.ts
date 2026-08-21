import { ANIME25D_LAYER_DEPTH, type Anime25DLayerRole } from '../rig/anime25d'
import type {
  Anime25DFade,
  Anime25DPlayback,
  Anime25DPlaybackLayer,
} from './types'
import { anime25DPlaybackSource } from './types'

export interface Anime25DPlaybackBuildLayer {
  id: string
  role: string
  side: 'left' | 'right' | null
  bounds: { x: number; y: number; width: number; height: number }
  textureBounds: { x: number; y: number; width: number; height: number }
  strands: Array<{ x: number; rootY: number; tipY: number }>
}

export interface Anime25DPlaybackBuildInput {
  frameWidth: number
  frameHeight: number
  layers: Anime25DPlaybackBuildLayer[]
  faceCenter: { x: number; y: number }
}

const HEAD_ROLES = new Set([
  'back-hair',
  'front-hair',
  'face',
  'facedetail',
  'ears',
  'earwear',
  'headwear',
  'nose',
  'eyebrow',
  'eyewhite',
  'irides',
  'eyelash',
  'eye-close',
  'mouth-open',
  'mouth-close',
])

export function buildAnime25DPlayback(
  input: Anime25DPlaybackBuildInput,
): Anime25DPlayback {
  const width = Math.max(1, input.frameWidth)
  const height = Math.max(1, input.frameHeight)
  const layers = input.layers.map((layer) => toPlaybackLayer(layer, width))
  const face = requiredLayer(layers, 'face')
  const faceBox = {
    x0: face.x,
    y0: face.y,
    x1: face.x + face.w,
    y1: face.y + face.h,
    cx: input.faceCenter.x * width,
    cy: input.faceCenter.y * width,
  }
  const neck = layers.find((layer) => layer.role === 'neck')
  const topwear = layers.find((layer) => layer.role === 'topwear')
  const neckPivot = neck
    ? { x: neck.x + neck.w / 2, y: neck.y + neck.h * 0.85 }
    : { x: faceBox.cx, y: faceBox.y1 + 20 }
  const bodyPivot = topwear
    ? { x: topwear.x + topwear.w / 2, y: topwear.y + topwear.h }
    : { x: width / 2, y: height }
  const mouthLayer =
    layers.find((layer) => layer.role === 'mouth-open') ||
    layers.find((layer) => layer.role === 'mouth-close')
  return {
    ...anime25DPlaybackSource(),
    pixelCanvas: { width, height },
    layers,
    anchors: {
      face: faceBox,
      neckPivot,
      bodyPivot,
      mouth: mouthLayer
        ? { cx: mouthLayer.x + mouthLayer.w / 2, cy: mouthLayer.y + mouthLayer.h / 2 }
        : { cx: faceBox.cx, cy: faceBox.y0 + face.h * 0.72 },
      faceScale: (faceBox.x1 - faceBox.x0) / 333,
      eyeL: eyeAnchor(layers, 'L'),
      eyeR: eyeAnchor(layers, 'R'),
    },
  }
}

function toPlaybackLayer(
  layer: Anime25DPlaybackBuildLayer,
  frameWidth: number,
): Anime25DPlaybackLayer {
  const role = layer.role
  return {
    name: playbackName(layer),
    role,
    depth: playbackDepth(role),
    group: HEAD_ROLES.has(role) ? 'head' : 'body',
    phys: role === 'front-hair' || role === 'back-hair' ? 'hair' : null,
    fade: playbackFade(role),
    side: layer.side === 'left' ? 'L' : layer.side === 'right' ? 'R' : null,
    x: layer.bounds.x * frameWidth,
    y: layer.bounds.y * frameWidth,
    w: layer.bounds.width * frameWidth,
    h: layer.bounds.height * frameWidth,
    atlas: {
      x: layer.textureBounds.x,
      y: layer.textureBounds.y,
      w: layer.textureBounds.width,
      h: layer.textureBounds.height,
    },
    strands: layer.strands.map((strand) => ({
      x: strand.x * frameWidth,
      rootY: strand.rootY * frameWidth,
      tipY: strand.tipY * frameWidth,
    })),
  }
}

function playbackName(layer: Anime25DPlaybackBuildLayer): string {
  if (layer.side === 'left') return `${layer.role}-L`
  if (layer.side === 'right') return `${layer.role}-R`
  return layer.id
}

function playbackDepth(role: string): number {
  return Object.hasOwn(ANIME25D_LAYER_DEPTH, role)
    ? ANIME25D_LAYER_DEPTH[role as Anime25DLayerRole]
    : 1
}

function playbackFade(role: string): Anime25DFade | null {
  if (role === 'eyewhite' || role === 'irides' || role === 'eyelash') return 'eyeOpen'
  if (role === 'eye-close') return 'eyeClose'
  if (role === 'mouth-open') return 'mouthOpen'
  if (role === 'mouth-close') return 'mouthClose'
  return null
}

function requiredLayer(
  layers: Anime25DPlaybackLayer[],
  role: string,
): Anime25DPlaybackLayer {
  const layer = layers.find((candidate) => candidate.role === role)
  if (!layer) throw new Error(`Anime2.5DRig playback missing ${role}`)
  return layer
}

function eyeAnchor(
  layers: Anime25DPlaybackLayer[],
  side: 'L' | 'R',
): Anime25DPlayback['anchors']['eyeL'] {
  const white = layers.find((layer) => layer.role === 'eyewhite' && layer.side === side)
  const iris = layers.find((layer) => layer.role === 'irides' && layer.side === side)
  const lash = layers.find((layer) => layer.role === 'eyelash' && layer.side === side)
  const box = white || lash
  if (!box) return undefined
  return {
    x0: box.x,
    y0: box.y,
    x1: box.x + box.w,
    y1: box.y + box.h,
    icx: iris ? iris.x + iris.w / 2 : box.x + box.w / 2,
    icy: iris ? iris.y + iris.h / 2 : box.y + box.h / 2,
    closeY: box.y + box.h * 0.62,
  }
}
