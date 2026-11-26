import assert from 'node:assert/strict'
import test from 'node:test'
import { writePsd } from 'ag-psd'
import { FigureError } from '../../errors'
import { holdPsdInflation } from './psd'

/** A 256 × 256 PSD of one zip-compressed layer, `size` square and all transparent. */
function zipPsd(size: number): Uint8Array {
  const imageData = { width: size, height: size, data: new Uint8ClampedArray(size * size * 4), colorSpace: 'srgb' as const }
  const bytes = writePsd({ width: 256, height: 256, children: [{ name: 'body', top: 0, left: 0, imageData }] }, { compress: true })
  return new Uint8Array(bytes)
}

/** Where the first layer's rectangle is: after the header, colour mode data, resources and the layer section's lengths and count. */
function firstLayerRect(psd: Uint8Array): number {
  const view = new DataView(psd.buffer, psd.byteOffset, psd.byteLength)
  let at = 26
  at += 4 + view.getUint32(at)
  at += 4 + view.getUint32(at)
  return at + 4 + 4 + 2
}

test('a PSD channel zipped to inflate past its layer is refused before ag-psd inflates it', () => {
  // 2048 square of zeros zips to a few kilobytes a channel; the layer is then said to be 16 square.
  const bomb = zipPsd(2048)
  const rect = firstLayerRect(bomb)
  const view = new DataView(bomb.buffer)
  assert.deepEqual([view.getInt32(rect), view.getInt32(rect + 4), view.getInt32(rect + 8), view.getInt32(rect + 12)], [0, 0, 2048, 2048])
  holdPsdInflation(bomb.slice().buffer)
  view.setInt32(rect + 8, 16)
  view.setInt32(rect + 12, 16)
  assert.throws(() => holdPsdInflation(bomb.buffer), (error) => error instanceof FigureError && error.code === 'psdSpecInvalid')
  // A zipped layer that inflates to its size is read.
  holdPsdInflation(zipPsd(64).buffer as ArrayBuffer)
})
