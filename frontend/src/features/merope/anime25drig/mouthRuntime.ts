import type { Anime25DDriver } from './driver'
import type {
  MouthTransitionSample,
  SpeechMouthMaterial,
} from './mouthTransition'
import type { Anime25DPlayback, Anime25DPlaybackLayer } from './types'
import { dominantMouthMaterial } from './mouthTransition'

export interface MouthMorphState {
  centerX: number
  centerY: number
  width: number
  height: number
  openMix: number
  wide: number
  round: number
  narrow: number
}

interface MouthLayerState {
  source: Anime25DPlaybackLayer
}

export function resolveMouthMorph(
  layers: readonly MouthLayerState[],
  driver: Anime25DDriver,
  fallback: Anime25DPlayback['anchors']['mouth'],
  face: Anime25DPlayback['anchors']['face'],
  output: MouthMorphState,
): void {
  const openMix = mouthOpenMix(driver)
  const shapeScale = mouthShapeScale(driver)
  const articulation = 1 - smoothstep(driver.mouthSeal)
  const wide = driver.mouthWide * shapeScale * articulation
  const round = driver.mouthRound * shapeScale * articulation
  const narrow = driver.mouthNarrow * shapeScale * articulation
  const open = Math.max(0, 1 - wide - round - narrow)
  const maniac = smoothstep(driver.maniac)
  const regular = 1 - maniac
  output.openMix = Math.max(openMix, maniac)
  output.wide = wide
  output.round = round
  output.narrow = narrow

  let total = 0
  output.centerX = 0
  output.centerY = 0
  output.width = 0
  output.height = 0
  let closed: Anime25DPlaybackLayer | undefined
  let ordinary: Anime25DPlaybackLayer | undefined
  let wideLayer: Anime25DPlaybackLayer | undefined
  let roundLayer: Anime25DPlaybackLayer | undefined
  let narrowLayer: Anime25DPlaybackLayer | undefined
  let maniacLayer: Anime25DPlaybackLayer | undefined
  for (const layer of layers) {
    if (layer.source.fade === 'mouthClose') closed ??= layer.source
    else if (layer.source.fade === 'mouthOpen') ordinary ??= layer.source
    else if (layer.source.fade === 'mouthWide') wideLayer ??= layer.source
    else if (layer.source.fade === 'mouthRound') roundLayer ??= layer.source
    else if (layer.source.fade === 'mouthNarrow') narrowLayer ??= layer.source
    else if (layer.source.fade === 'mouthManiac') maniacLayer ??= layer.source
  }
  if (closed)
    total += addMouthMorphSource(output, closed, (1 - openMix) * regular)
  if (ordinary)
    total += addMouthMorphSource(output, ordinary, openMix * open * regular)
  if (wideLayer)
    total += addMouthMorphSource(output, wideLayer, openMix * wide * regular)
  if (roundLayer)
    total += addMouthMorphSource(output, roundLayer, openMix * round * regular)
  if (narrowLayer) {
    total += addMouthMorphSource(
      output,
      narrowLayer,
      openMix * narrow * regular,
    )
  }
  if (maniacLayer) total += addMouthMorphSource(output, maniacLayer, maniac)
  if (total <= 0) {
    output.centerX = fallback.cx
    output.centerY = fallback.cy
    output.width = Math.max(1, fallback.x1 - fallback.x0)
    output.height = Math.max(1, fallback.y1 - fallback.y0)
    return
  }
  output.centerX /= total
  output.centerY /= total
  output.width = Math.max(1, output.width / total)
  output.height = Math.max(1, output.height / total)
  if (closed && output.openMix > 0) {
    const blendedTop = output.centerY - output.height / 2
    const blendedBottom = output.centerY + output.height / 2
    const neutralTop = closed.y
    const neutralBottom = closed.y + closed.h
    const upperRelease = 0.32 + maniac * 0.68
    const lowerRelease = 0.88 + maniac * 0.12
    const anchoredTop = neutralTop + (blendedTop - neutralTop) * upperRelease
    const releasedBottom =
      neutralBottom + (blendedBottom - neutralBottom) * lowerRelease
    output.centerY = (anchoredTop + releasedBottom) / 2
    output.height = Math.max(1, releasedBottom - anchoredTop)
  }
  if (maniac > 0) {
    // An extreme mouth must still fit the character's lower face.
    // Blend the guard with the expression so entry/exit remains continuous.
    const faceWidth = Math.max(1, face.x1 - face.x0)
    const faceHeight = Math.max(1, face.y1 - face.y0)
    const maximumWidth = faceWidth * 0.54
    const chinMargin = Math.max(2, faceHeight * 0.01)
    const lowerFaceRoom = Math.max(1, face.y1 - fallback.cy - chinMargin)
    const maximumHeight = Math.max(1, lowerFaceRoom / 0.44)
    const guardedWidth = Math.min(output.width, maximumWidth)
    const guardedHeight = Math.min(output.height, maximumHeight)
    const guardedCenterY = Math.min(output.centerY, fallback.cy)
    output.width += (guardedWidth - output.width) * maniac
    output.height += (guardedHeight - output.height) * maniac
    output.centerY += (guardedCenterY - output.centerY) * maniac
  }
}

function addMouthMorphSource(
  output: MouthMorphState,
  source: Anime25DPlaybackLayer,
  weight: number,
): number {
  if (weight <= 0) return 0
  output.centerX += (source.x + source.w / 2) * weight
  output.centerY += (source.y + source.h / 2) * weight
  output.width += source.w * weight
  output.height += source.h * weight
  return weight
}

function mouthOpenMix(driver: Anime25DDriver): number {
  const opening = smoothstep(
    (driver.mouthOpen - (0.02 + driver.mouthEase * 0.08)) /
      (0.53 + driver.mouthEase * 0.17),
  )
  return opening * (1 - smoothstep(driver.mouthSeal))
}

function mouthShapeScale(driver: Anime25DDriver): number {
  const total = driver.mouthWide + driver.mouthRound + driver.mouthNarrow
  return total > 1 ? 1 / total : 1
}

export function applyMouthTransitionBridge(
  output: MouthMorphState,
  transition: Readonly<MouthTransitionSample>,
): void {
  output.width = Math.max(1, output.width * transition.widthScale)
  output.height = Math.max(1, output.height * transition.heightScale)
  output.centerX += transition.centerOffsetX
  output.centerY += transition.centerOffsetY
  const retainedShape = 1 - transition.shapeNeutralization
  output.wide *= retainedShape
  output.round *= retainedShape
  output.narrow *= retainedShape
}

export function fadeOpacity(
  layer: Anime25DPlaybackLayer,
  driver: Anime25DDriver,
  activeMouthMaterial?: SpeechMouthMaterial,
  sillyMouthShare = 1,
): number {
  if (!layer.fade) return 1
  const dizzy = smoothstep(driver.eyeDizzy)
  const cry = smoothstep(driver.eyeCry)
  const mouthCry = cry * (1 - dizzy)
  const squeeze = smoothstep(driver.eyeSqueeze)
  const anger = smoothstep(driver.anger)
  const speechless = smoothstep(driver.speechless)
  const maniac = smoothstep(driver.maniac)
  // Silly is a complete eye and mouth replacement, so it yields to every
  // artwork state that also replaces the eyes and to the wilder maniac face.
  const silly =
    smoothstep(driver.silly) *
    (1 - dizzy) *
    (1 - cry) *
    (1 - squeeze) *
    (1 - maniac)
  const lovestruck =
    smoothstep(driver.lovestruck) *
    (1 - dizzy) *
    (1 - cry) *
    (1 - squeeze) *
    (1 - maniac) *
    (1 - silly)
  // The vacant eyes and the vacant mouth are owned separately: speech keeps
  // the articulating mouth while the stare stays on the face.
  const sillyMouth = silly * clamp(sillyMouthShare, 0, 1)
  const symbolBlocker =
    (1 - dizzy) * (1 - squeeze) * (1 - cry) * (1 - silly) * (1 - lovestruck)
  if (layer.fade === 'eyeDizzy') return dizzy
  if (layer.fade === 'eyeCry') return cry * (1 - dizzy)
  if (layer.fade === 'eyeSilly') return silly
  if (layer.fade === 'lovestruckHeart') {
    const open = layer.side === 'L' ? driver.eyeOpenL : driver.eyeOpenR
    return lovestruck * smoothstep((open - 0.12) / 0.28)
  }
  if (layer.fade === 'lovestruckFace') return lovestruck
  if (layer.fade === 'lovestruckDrool') return lovestruck
  if (layer.fade === 'maniacEyeShadow') return maniac * symbolBlocker
  if (layer.fade === 'maniacMouthShadow') return maniac * symbolBlocker
  if (layer.fade === 'angerMark') return anger * (1 - maniac) * symbolBlocker
  if (layer.fade === 'speechlessSweat') {
    return speechless * (1 - anger) * (1 - maniac) * symbolBlocker
  }
  if (layer.fade === 'mouthCry') return mouthCry
  if (layer.fade === 'mouthSilly') return sillyMouth * (1 - mouthCry)
  if (layer.fade === 'eyeSqueeze') {
    return squeeze * (1 - dizzy) * (1 - cry)
  }
  if (layer.fade === 'eyeOpen' || layer.fade === 'eyeClose') {
    const open = layer.side === 'L' ? driver.eyeOpenL : driver.eyeOpenR
    const faded = smoothstep((open - (0.1 + driver.eyeEase * 0.45)) / 0.15)
    return (
      (layer.fade === 'eyeOpen' ? faded : 1 - faded) *
      (1 - dizzy) *
      (1 - squeeze) *
      (1 - cry) *
      (1 - silly)
    )
  }
  if (
    layer.fade === 'mouthOpen' ||
    layer.fade === 'mouthWide' ||
    layer.fade === 'mouthRound' ||
    layer.fade === 'mouthNarrow' ||
    layer.fade === 'mouthClose' ||
    layer.fade === 'mouthManiac'
  ) {
    const selected = activeMouthMaterial ?? dominantMouthMaterial(driver)
    return (layer.fade === selected ? 1 : 0) * (1 - mouthCry) * (1 - sillyMouth)
  }
  return 1
}

/** Invisible generated variants do not need CPU deformation or GPU uploads. */
export function shouldDeformLayer(
  layer: Pick<Anime25DPlaybackLayer, 'name'>,
  opacity: number,
): boolean {
  return opacity >= 0.004 || layer.name.startsWith('eyewhite')
}

function smoothstep(value: number): number {
  const bounded = clamp(value, 0, 1)
  return bounded * bounded * (3 - 2 * bounded)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
