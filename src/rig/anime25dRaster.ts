import type { RasterLayer } from './anime25dImportTypes'
import type { RigRect } from './types'

/** The box of what is drawn (alpha above 8): its first and last rows, then in the rows between only the pixels outside the columns already found. */
export function rasterBounds(layer: RasterLayer): RigRect | null {
  const { width, height, data } = layer
  const drawnInRow = (y: number) => {
    const row = y * width * 4 + 3
    for (let x = 0; x < width; x += 1) {
      if (!(data[row + x * 4] <= 8)) return true
    }
    return false
  }
  let minY = 0
  while (minY < height && !drawnInRow(minY)) minY += 1
  if (minY >= height) return null
  let maxY = height - 1
  while (maxY > minY && !drawnInRow(maxY)) maxY -= 1
  let minX = width
  let maxX = -1
  for (let y = minY; y <= maxY; y += 1) {
    const row = y * width * 4 + 3
    for (let x = 0; x < minX; x += 1) {
      if (!(data[row + x * 4] <= 8)) {
        minX = x
        break
      }
    }
    for (let x = width - 1; x > maxX; x -= 1) {
      if (!(data[row + x * 4] <= 8)) {
        maxX = x
        break
      }
    }
  }
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  }
}

export function trimRaster(layer: RasterLayer): RasterLayer {
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

export function uniquePartId(preferred: string, used: Set<string>): string {
  let id = preferred
  let suffix = 2
  while (used.has(id)) id = `${preferred}-${suffix++}`
  used.add(id)
  return id
}
