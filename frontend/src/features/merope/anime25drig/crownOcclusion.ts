import type { Anime25DPlaybackLayer } from './types'
import type { CroppedLayerPixels } from './webglRuntime'

type Drawing = Pick<Anime25DPlaybackLayer, 'role' | 'x' | 'y' | 'w' | 'h'>
export interface CrownOcclusionBand { start: number; end: number }

/**
 * Back-hair may contain a visible cap as well as hair behind the shoulders.
 * Infer only a covered upper scalp, not an arbitrary forehead or a whole layer
 * reorder. Sparse/missing evidence is rejected; an early forehead opening
 * limits the cap above it rather than being painted over.
 */
export function deriveCrownOcclusionBand(
  face: Drawing, front: Drawing, back: Drawing, eyeTop: number,
  facePixels: CroppedLayerPixels | null,
  frontPixels: CroppedLayerPixels | null,
  backPixels: CroppedLayerPixels | null,
): CrownOcclusionBand | null {
  const span = eyeTop - face.y
  if (face.role !== 'face' || front.role !== 'front-hair' || back.role !== 'back-hair' ||
    !Number.isFinite(span) || span < face.h * 0.3 || span > face.h * 0.8 ||
    front.y > face.y || back.y > face.y || back.w < face.w * 0.8 ||
    !facePixels || !frontPixels || !backPixels) { return null
}
  let count = 0; let coveredFront = 0; let coveredBack = 0
  for (let row = 0; row < 12; row++) {
    for (let column = 0; column < 8; column++) {
      const x = face.x + face.w * (0.3 + (column + 0.5) / 8 * 0.4)
      const y = face.y + span * (row + 0.5) / 12 * 0.65
      if (alphaAt(face, facePixels, x, y) < 192) continue
      count++
      if (alphaAt(front, frontPixels, x, y) >= 192) coveredFront++
      if (alphaAt(back, backPixels, x, y) >= 224) coveredBack++
    }
  }
  if (count < 48 || coveredFront / count < 0.9 || coveredBack / count < 0.95) return null
  // Average coverage can hide a narrow, intentional part. Stop before an
  // opening inside the nominal solid scalp, while retaining the cap above it.
  // Two rows of contiguous exposed face reject isolated alpha pinholes.
  let start = 0.65; let end = 0.85
  let previousOpening: number | null = null
  for (let row = 0; row < 16; row++) {
    const progress = 0.2 + row / 15 * 0.45
    const y = face.y + span * progress
    let run = 0; let opening = false
    for (let column = 0; column < 24; column++) {
      const x = face.x + face.w * (0.3 + (column + 0.5) / 24 * 0.4)
      run = alphaAt(face, facePixels, x, y) >= 192 && alphaAt(front, frontPixels, x, y) < 64 ? run + 1 : 0
      if (run >= 3) opening = true
    }
    if (opening && previousOpening !== null) {
      // End at the preceding sample's boundary, not inside the exposed part.
      end = Math.max(0.2, previousOpening - 0.03)
      start = Math.max(0, end - 0.2)
      break
    }
    previousOpening = opening ? progress : null
  }
  return {
    start: (face.y + span * start - back.y) / back.h,
    end: (face.y + span * end - back.y) / back.h,
  }
}

function alphaAt(layer: Drawing, image: CroppedLayerPixels, x: number, y: number): number {
  const px = Math.floor((x - layer.x) / layer.w * image.width)
  const py = Math.floor((y - layer.y) / layer.h * image.height)
  if (px < 0 || py < 0 || px >= image.width || py >= image.height) return 0
  return image.pixels[(py * image.width + px) * 4 + 3]
}
