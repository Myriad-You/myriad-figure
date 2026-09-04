import type { Anime25DPlaybackAnchors, Anime25DPlaybackLayer } from './types'
import type { CroppedLayerPixels } from './webglRuntime'

export interface Anime25DNeckSurface {
  neck: Anime25DPlaybackLayer
  body: Anime25DPlaybackLayer
  /** Rest-space UV interval, above the contaminated cut edge of the neck. */
  fadeStart: number
  fadeEnd: number
}

type ReadPixels = (layer: Anime25DPlaybackLayer) => CroppedLayerPixels | null

/**
 * See-through can inpaint exposed skin into topwear. Painting it over the neck
 * clips the authored chin shadow into a straight line. Recover the open-neck
 * overlap only when a fully supported, colour-agreeing lower join exists.
 * This is not high-collar recovery and must never override collar topology.
 */
export function resolveAnime25DNeckSurface(
  layers: readonly Anime25DPlaybackLayer[],
  anchors: Anime25DPlaybackAnchors,
  readPixels: ReadPixels,
): Anime25DNeckSurface | null {
  if (layers.some((l) => l.role === 'collar-front' || l.role === 'collar-back'))
    return null
  const necks = layers.filter((l) => l.role === 'neck')
  if (necks.length !== 1) return null
  const neck = necks[0]
  const neckPixels = readPixels(neck)
  if (!neckPixels || neckPixels.height < 8) return null
  const candidates: Anime25DNeckSurface[] = []
  for (const body of layers.filter((l) => l.role === 'topwear')) {
    if (
      body.x >= neck.x + neck.w ||
      body.x + body.w <= neck.x ||
      body.y >= neck.y + neck.h
    ) {
      continue
    }
    const bodyPixels = readPixels(body)
    if (!bodyPixels) continue
    const top = Math.max(neck.y, anchors.face.y1)
    const upperEnd = top + Math.max(0, anchors.neckBottom - top) * 0.35
    let upper = 0
    let covered = 0
    const matching = new Uint8Array(neckPixels.height)
    const supported = new Uint8Array(neckPixels.height)
    for (let y = 0; y < neckPixels.height; y++) {
      const worldY = neck.y + ((y + 0.5) / neckPixels.height) * neck.h
      let rowPixels = 0
      let opaquePixels = 0
      let matches = 0
      let unsupported = 0
      for (let x = 0; x < neckPixels.width; x++) {
        const n = (y * neckPixels.width + x) * 4
        if (neckPixels.pixels[n + 3] < 16) continue
        const worldX = neck.x + ((x + 0.5) / neckPixels.width) * neck.w
        const b = pixelAt(bodyPixels, body, worldX, worldY)
        const alpha = b < 0 ? 0 : bodyPixels.pixels[b + 3]
        if (worldY >= top && worldY <= upperEnd) {
          upper++
          if (alpha >= 16) covered++
        }
        rowPixels++
        if (alpha < 250) unsupported++
        if (neckPixels.pixels[n + 3] < 240 || alpha < 250) continue
        opaquePixels++
        const r = neckPixels.pixels[n] - bodyPixels.pixels[b]
        const g = neckPixels.pixels[n + 1] - bodyPixels.pixels[b + 1]
        const blue = neckPixels.pixels[n + 2] - bodyPixels.pixels[b + 2]
        if (r * r * 2 + g * g * 4 + blue * blue <= 12 * 12 * 7) matches++
      }
      supported[y] = rowPixels === 0 || unsupported === 0 ? 1 : 0
      matching[y] =
        supported[y] &&
        opaquePixels >= Math.max(4, neckPixels.width * 0.2) &&
        matches / opaquePixels >= 0.85
          ? 1
          : 0
    }
    // An unsplit high collar covers the upper neck too. Even a pale garment
    // that resembles skin cannot qualify through the lower colour test alone.
    if (upper < 24 || covered / upper >= 0.5) continue
    let end = neckPixels.height - 1
    while (end >= 0 && !matching[end]) end--
    if (end < neckPixels.height * 0.85) continue
    if (supported.subarray(end).includes(0)) continue
    let start = end
    while (start > neckPixels.height * 0.5 && matching[start - 1]) start--
    if (end - start < Math.max(4, neckPixels.height * 0.08)) continue
    candidates.push({
      neck,
      body,
      fadeStart: (start + 0.5) / neckPixels.height,
      fadeEnd: (end + 0.5) / neckPixels.height,
    })
  }
  return candidates.length === 1 ? candidates[0] : null
}

function pixelAt(
  image: CroppedLayerPixels,
  source: Anime25DPlaybackLayer,
  x: number,
  y: number,
): number {
  const px = Math.floor(((x - source.x) / source.w) * image.width)
  const py = Math.floor(((y - source.y) / source.h) * image.height)
  return px < 0 || py < 0 || px >= image.width || py >= image.height
    ? -1
    : (py * image.width + px) * 4
}
