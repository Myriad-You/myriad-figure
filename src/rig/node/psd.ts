import type { Layer } from 'ag-psd'
import { inflateSync } from 'node:zlib'
import { readPsd } from 'ag-psd'
import { FigureError } from '../../errors'
import { validateRigPsdHeader } from '../psdDecode'

// What ag-psd does with a PSD's sizes, as the import reads it (8-bit RGB, no
// composite, thumbnail or linked files), and what bounds each:
//
// - Layer and mask pixels are allocated from their rectangles, all counted
//   against the import's `totalMemoryLimit` (512 MB) before they are; a
//   layer's rectangle is held to MAX_EDGE, and all of them to MAX_PIXELS.
// - RLE channels: a length for each row (counted against the limit), rows
//   written no further than the rectangle's width, read from the file.
// - Raw channels: views of the file, copied no further than the rectangle.
// - Patterns: their rectangle counted against the limit before it is
//   allocated, their channels raw or RLE as above.
// - A read past the file's end: one zeroed copy of at most 100 MB, after
//   which the next read throws.
// - Image resources and layer information (descriptors, text, ICC profiles,
//   XMP): views or copies of their sections, which must fit the file; none is
//   inflated.
// - Zip channels: inflated whole, with nothing to stop them (pako's
//   `inflate`), even for a channel ag-psd then drops. That is held here.

/**
 * Every zip-compressed channel in the PSD inflated with a cap: no more than its
 * rectangle holds (a mask's for a mask channel, the layer's for the others), at
 * 8 bits. One that inflates past it is refused before ag-psd inflates it.
 * The PSD's header is held first, as the import holds it.
 */
export function holdPsdInflation(buffer: ArrayBuffer): void {
  try {
    validateRigPsdHeader(buffer)
  } catch {
    throw new FigureError('psdSpecInvalid')
  }
  let layers: Layer[]
  try {
    const psd = readPsd(buffer, {
      useRawData: true,
      skipCompositeImageData: true,
      skipThumbnail: true,
      skipLinkedFilesData: true,
      totalMemoryLimit: 512 * 1024 * 1024,
    })
    layers = psd.children ?? []
  } catch {
    // The import reads it again and says what it is.
    return
  }
  const size = (rect: { top?: number; left?: number; bottom?: number; right?: number } | undefined) =>
    rect ? Math.max(0, (rect.right ?? 0) - (rect.left ?? 0)) * Math.max(0, (rect.bottom ?? 0) - (rect.top ?? 0)) : 0
  const visit = (children: Layer[]) => {
    for (const layer of children) {
      const raw = (layer as { rawData?: { channels: Array<{ id: number; compression: number; data?: Uint8Array }> } }).rawData
      for (const { id, compression, data } of raw?.channels ?? []) {
        if ((compression !== 2 && compression !== 3) || !data?.length) continue
        const most = size(id === -2 ? layer.mask : id === -3 ? layer.realMask : layer)
        try {
          inflateSync(data, { maxOutputLength: Math.max(1, most) })
        } catch {
          throw new FigureError('psdSpecInvalid')
        }
      }
      visit(layer.children ?? [])
    }
  }
  visit(layers)
}
