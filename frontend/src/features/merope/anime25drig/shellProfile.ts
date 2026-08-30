import type {
  Anime25DPlayback,
  Anime25DPlaybackAnchors,
  Anime25DPlaybackLayer,
  Anime25DShellCurvePoint,
  Anime25DShellProfile,
  Anime25DTorsoShellProfile,
} from './types'

const DEFAULT_CURVE: readonly Anime25DShellCurvePoint[] = [
  { v: 0.06, z: 0.1 },
  { v: 0.42, z: 0.02 },
  { v: 0.62, z: 0.3 },
  { v: 0.78, z: 0.06 },
  { v: 0.97, z: 0.14 },
]

type ShellProfileSource = Pick<Anime25DPlayback, 'anchors' | 'layers'>

/**
 * Resolves the optional v6 extension without mutating the immutable asset.
 * Existing assets therefore gain the same deterministic profile as new imports.
 */
export function resolveAnime25DShellProfile(
  playback: Readonly<ShellProfileSource> &
    Partial<Pick<Anime25DPlayback, 'shellProfile'>>,
): Anime25DShellProfile {
  const persisted = playback.shellProfile
  if (!persisted) return deriveAnime25DShellProfile(playback)
  const pinMode =
    persisted.hair.hairlinePin.mode ??
    (persisted.source === 'anchor-derived' ? 'strand-roots' : 'rectangle')
  if (persisted.torso && persisted.hair.hairlinePin.mode === pinMode) {
    return persisted
  }
  return {
    ...persisted,
    hair: {
      ...persisted.hair,
      hairlinePin: {
        ...persisted.hair.hairlinePin,
        mode: pinMode,
      },
    },
    torso: persisted.torso ?? deriveAnime25DTorsoShellProfile(playback),
  }
}

export function deriveAnime25DShellProfile(
  playback: Readonly<ShellProfileSource>,
): Anime25DShellProfile {
  const { anchors, layers } = playback
  const faceWidth = Math.max(1, anchors.face.x1 - anchors.face.x0)
  const faceHeight = Math.max(1, anchors.face.y1 - anchors.face.y0)
  const head = {
    centerX: anchors.face.cx,
    centerY: anchors.face.y0 + faceHeight * 0.45,
    radiusX: faceWidth * 0.62,
    radiusY: faceHeight * 0.72,
    radiusZ: faceWidth * 0.45,
  }
  const profileStartY = anchors.face.y0
  const profileEndY = anchors.face.y1 + faceHeight * 0.12
  return {
    version: 1,
    source: 'anchor-derived',
    enabled: true,
    blend: 0.5,
    head,
    faceProfile: {
      enabled: true,
      startY: profileStartY,
      endY: profileEndY,
      points: deriveFaceCurve(anchors, layers, profileStartY, profileEndY),
    },
    hair: {
      centerX: head.centerX,
      centerY: head.centerY - head.radiusY * 0.06,
      radiusX: head.radiusX * 1.1,
      radiusY: head.radiusY * 1.1,
      radiusZ: head.radiusZ * 1.05,
      frontGap: 0.18,
      frontBulge: 1,
      backDepth: 0.35,
      crownRound: 0,
      hairlinePin: {
        enabled: layers.some((layer) => layer.role === 'front-hair'),
        mode: 'strand-roots',
        centerX: 0,
        centerY: -0.45,
        halfWidth: 1.1,
        halfHeight: 0.32,
        feather: 0.06,
      },
    },
    torso: deriveAnime25DTorsoShellProfile(playback),
  }
}

export function deriveAnime25DTorsoShellProfile(
  playback: Readonly<ShellProfileSource>,
): Anime25DTorsoShellProfile {
  const faceWidth = Math.max(
    1,
    playback.anchors.face.x1 - playback.anchors.face.x0,
  )
  return {
    enabled: playback.layers.some(
      (layer) => layer.role === 'topwear' || layer.role === 'bottomwear',
    ),
    blend: 0.5,
    centerX: playback.anchors.neckPivot.x,
    radiusX: Math.max(1, faceWidth * 0.95),
    radiusZ: Math.max(1, faceWidth * 0.55),
  }
}

function deriveFaceCurve(
  anchors: Readonly<Anime25DPlaybackAnchors>,
  layers: readonly Anime25DPlaybackLayer[],
  startY: number,
  endY: number,
): Anime25DShellCurvePoint[] {
  const span = Math.max(1, endY - startY)
  const progress = (value: number) => clamp((value - startY) / span, 0, 1)
  const eyeRootY =
    anchors.eyeL && anchors.eyeR
      ? (anchors.eyeL.icy + anchors.eyeR.icy) / 2
      : anchors.face.y0 + (anchors.face.y1 - anchors.face.y0) * 0.42
  const noseLayer = layers.find((layer) => layer.role === 'nose')
  const noseY = noseLayer
    ? noseLayer.y + noseLayer.h * 0.65
    : eyeRootY + (anchors.mouth.cy - eyeRootY) * 0.55
  const candidate = [
    0.06,
    progress(eyeRootY),
    progress(noseY),
    progress(anchors.mouth.y0),
    progress(anchors.face.y1),
  ]
  if (!strictlyOrdered(candidate, 0.025)) {
    return DEFAULT_CURVE.map((point) => ({ ...point }))
  }
  return candidate.map((v, index) => ({
    v,
    z: DEFAULT_CURVE[index].z,
  }))
}

function strictlyOrdered(
  values: readonly number[],
  minimumGap: number,
): boolean {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] - values[index - 1] < minimumGap) return false
  }
  return true
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
