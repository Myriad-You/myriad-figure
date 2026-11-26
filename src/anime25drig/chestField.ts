// The chest profile the importer derives from a package's geometry, read by the stage's chest physics.
import type { Anime25DPlayback } from '@myriad/figure-player'
import type { Anime25DChestProfile } from '@myriad/figure-player/internals'
import { isAnime25DLiningPiece } from '@myriad/figure-player/internals'

const DEFAULT_SUPPORT_SCALE = 0.45

const DEFAULT_GARMENT_MOTION_SCALE = 0.65

export function deriveGeometryChestProfile(
  playback: Readonly<
    Pick<Anime25DPlayback, 'pixelCanvas' | 'layers' | 'anchors'>
  >,
): Anime25DChestProfile {
  const { width, height } = playback.pixelCanvas
  const faceWidth = Math.max(
    1,
    Math.abs(playback.anchors.face.x1 - playback.anchors.face.x0),
  )
  const faceHeight = Math.max(
    1,
    Math.abs(playback.anchors.face.y1 - playback.anchors.face.y0),
  )
  const topwear = playback.layers.find((layer) => layer.role === 'topwear' && !isAnime25DLiningPiece(layer.name))
  let centerX = clamp(playback.anchors.neckPivot.x, 0, width)
  let centerY = clamp(playback.anchors.neckBottom + faceHeight * 0.5, 0, height)
  if (topwear && topwear.w > 0 && topwear.h > 0) {
    centerX = clamp(
      centerX,
      topwear.x + topwear.w * 0.15,
      topwear.x + topwear.w * 0.85,
    )
    const minimumY = clamp(
      Math.max(
        topwear.y + topwear.h * 0.2,
        playback.anchors.neckBottom + faceHeight * 0.12,
      ),
      0,
      height,
    )
    const maximumY = clamp(
      Math.min(
        topwear.y + topwear.h * 0.62,
        playback.anchors.neckBottom + faceHeight * 0.78,
      ),
      minimumY,
      height,
    )
    centerY = clamp(centerY, minimumY, maximumY)
  }
  return {
    version: 2,
    enabled: true,
    source: 'geometry-fallback',
    centerX,
    centerY,
    radiusX: clamp(faceWidth * 0.6, 1, width * 0.5),
    radiusY: clamp(faceHeight * 0.32, 1, height * 0.22),
    visibleScale: 0.5,
    motionScale: 1,
    frequencyScale: 1,
    supportScale: DEFAULT_SUPPORT_SCALE,
    garmentMotionScale: DEFAULT_GARMENT_MOTION_SCALE,
    confidence: 0,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
