import assert from 'node:assert/strict'
import test from 'node:test'
import { closeMask } from './psdRepairMasks'

// The closing as it was first written, looking at the whole reach from every pixel: the definition.
function plainSweep(mask: Uint8Array, width: number, height: number, radius: number, step: number, grow: boolean): Uint8Array {
  const output = new Uint8Array(mask.length)
  const length = step === 1 ? width : height
  const lines = step === 1 ? height : width
  for (let line = 0; line < lines; line += 1) {
    const start = step === 1 ? line * width : line
    for (let position = 0; position < length; position += 1) {
      let value = grow ? 0 : 1
      for (let offset = -radius; offset <= radius; offset += 1) {
        const other = position + offset
        const sample = other < 0 || other >= length ? (grow ? 0 : 1) : mask[start + other * step]!
        if (grow ? sample : !sample) {
          value = grow ? 1 : 0
          break
        }
      }
      output[start + position * step] = value
    }
  }
  return output
}

function plainClose(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const dilated = plainSweep(plainSweep(mask, width, height, radius, 1, true), width, height, radius, width, true)
  return plainSweep(plainSweep(dilated, width, height, radius, 1, false), width, height, radius, width, false)
}

test('a mask closed by counting gives the mask closed by looking, a column of one pixel included', () => {
  let state = 77
  const random = () => {
    state = (state * 1103515245 + 12345) & 0x7FFFFFFF
    return state / 0x7FFFFFFF
  }
  for (const [width, height] of [[1, 1], [1, 9], [9, 1], [2, 2], [5, 8], [17, 13], [40, 31]] as const) {
    for (const radius of [0, 1, 2, 5, 12, 50]) {
      for (const density of [0.03, 0.4, 0.9]) {
        // Set pixels are any value but zero.
        const mask = Uint8Array.from({ length: width * height }, () => (random() < density ? 1 + Math.floor(random() * 255) : 0))
        assert.deepEqual(closeMask(mask, width, height, radius), plainClose(mask, width, height, radius), `${width}x${height} radius ${radius} density ${density}`)
      }
    }
  }
})
