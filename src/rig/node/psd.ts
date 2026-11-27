import type { HoldZipChannel } from '../psdDecode'
import { inflateSync } from 'node:zlib'

// What ag-psd does with a PSD's sizes, as the import reads it (8-bit RGB, no
// composite, thumbnail or linked files), and what bounds each:
//
// - Layer and mask pixels are allocated from their rectangles, all held to
//   512 MB by `decodeRigPsd` before any is decoded; a layer's rectangle is held
//   to MAX_EDGE, and all of them to MAX_PIXELS.
// - RLE channels: a length for each row, rows written no further than the
//   rectangle's width, read from the file.
// - Raw channels: views of the file, copied no further than the rectangle.
// - Patterns: their rectangle counted against ag-psd's `totalMemoryLimit`
//   (512 MB) before it is allocated, their channels raw or RLE as above.
// - A read past the file's end: one zeroed copy of at most 100 MB, after
//   which the next read throws.
// - Image resources and layer information (descriptors, text, ICC profiles,
//   XMP): views or copies of their sections, which must fit the file; none is
//   inflated.
// - Zip channels: ag-psd inflates them whole (pako's `inflate`), with nothing
//   to stop it. The PSD is read with every channel's bytes kept, inflating
//   nothing, and only the layers in its tree are then decoded, each zip
//   channel held here first.

/** A zip channel inflated with a cap at what its rectangle holds at 8 bits; one that inflates past it is refused. */
export const holdZipChannel: HoldZipChannel = (data, most) => {
  try {
    inflateSync(data, { maxOutputLength: Math.max(1, most) })
  } catch {
    throw new Error('psdSpecInvalid')
  }
}
