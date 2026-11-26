import type { RasterLayer } from '@myriad/figure-player/internals'
import assert from 'node:assert/strict'
import test from 'node:test'
import { rasterBounds } from './anime25dRaster'

// The box as it was first found, looking at every pixel: the definition.
function plainBounds(layer: RasterLayer) {
  let minX = layer.width
  let minY = layer.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < layer.height; y += 1) {
    for (let x = 0; x < layer.width; x += 1) {
      if (layer.data[(y * layer.width + x) * 4 + 3]! <= 8) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  return maxX < minX ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

test('the box of what is drawn is the one found by looking at every pixel', () => {
  let state = 91
  const random = () => {
    state = (state * 1103515245 + 12345) & 0x7FFFFFFF
    return state / 0x7FFFFFFF
  }
  for (const [width, height] of [[0, 0], [0, 4], [4, 0], [1, 1], [1, 7], [7, 1], [6, 5], [23, 17]] as const) {
    for (const density of [0, 0.01, 0.1, 0.6, 1]) {
      for (let round = 0; round < 20; round += 1) {
        const data = new Uint8ClampedArray(width * height * 4)
        // Faint pixels (8 and under) are not drawn.
        for (let i = 3; i < data.length; i += 4) data[i] = random() < density ? 9 + Math.floor(random() * 247) : Math.floor(random() * 9)
        const layer: RasterLayer = { id: 'a', role: 'unknown', sourceName: 'a', order: 0, side: null, group: 'body', left: 3, top: 4, width, height, data }
        assert.deepEqual(rasterBounds(layer), plainBounds(layer), `${width}x${height} density ${density}`)
      }
    }
  }
})
