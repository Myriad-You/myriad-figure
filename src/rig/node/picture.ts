import type { RgbaPixels } from '../rigRaster'
import { Buffer } from 'node:buffer'
import { crc32, inflateSync } from 'node:zlib'
import { convertIndexedToRgb, decode as decodePng } from 'fast-png'
import jpeg from 'jpeg-js'
import { FigureError } from '../../errors'
import { MAX_EDGE } from '../psdDecode'

// Reading a portrait, a redraw or a gesture arm that may come from anyone: its
// size is read from its header and held to the limits before anything is
// decoded, and every picture the import is given is turned upright by its
// orientation tag, as a browser does. Whatever cannot be read is a
// `psdPreviewFailed`, the code the page's import gives a portrait it cannot read.

/** The most bytes a picture may have: as many as the site takes for a figure's enlarged picture. */
export const MAX_PICTURE_BYTES = 32 * 1024 * 1024
/** The longest edge: twice what a PSD may have, for a portrait larger than the PSD cut from it. */
export const MAX_PICTURE_EDGE = 2 * MAX_EDGE
/** The most pixels: as many as the largest PSD has. */
export const MAX_PICTURE_PIXELS = MAX_EDGE * MAX_EDGE

export interface PictureHeader {
  format: 'png' | 'jpeg'
  /** As stored, before the orientation turns it. */
  width: number
  height: number
  /** The EXIF orientation, 1 (upright) to 8. */
  orientation: number
}

function refuse(reason: string): never {
  throw new FigureError('psdPreviewFailed', { reason })
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]

/** The EXIF orientation in a TIFF block (an Exif APP1's or a PNG eXIf chunk's), 1 when there is none. */
function tiffOrientation(bytes: Uint8Array, start: number, end: number): number {
  if (end - start < 8) return 1
  const view = new DataView(bytes.buffer, bytes.byteOffset + start, end - start)
  const little = view.getUint16(0) === 0x4949
  if (!little && view.getUint16(0) !== 0x4D4D) return 1
  const ifd = view.getUint32(4, little)
  if (ifd + 2 > view.byteLength) return 1
  const entries = view.getUint16(ifd, little)
  for (let i = 0; i < entries; i += 1) {
    const at = ifd + 2 + i * 12
    if (at + 12 > view.byteLength) return 1
    if (view.getUint16(at, little) === 0x0112) {
      const value = view.getUint16(at + 8, little)
      return value >= 1 && value <= 8 ? value : 1
    }
  }
  return 1
}

function pngHeader(bytes: Uint8Array): PictureHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 33 || view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) refuse('unreadable')
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  const depth = bytes[24]!
  const interlaced = bytes[28] === 1
  // fast-png cannot read an interlaced picture of fewer than 8 bits a sample.
  if (interlaced && depth < 8) refuse('unsupported')
  let orientation = 1
  // eXIf counts only before the pixels, as browsers take it.
  for (let at = 33; at + 12 <= bytes.length;) {
    const length = view.getUint32(at)
    const type = view.getUint32(at + 4)
    if (type === 0x49444154 || length > bytes.length) break
    if (type === 0x65584966) orientation = tiffOrientation(bytes, at + 8, Math.min(bytes.length, at + 8 + length))
    at += 12 + length
  }
  return { format: 'png', width, height, orientation }
}

/**
 * The most scans a JPEG may have. jpeg-js goes over every block of the
 * picture in each scan, so a file of many empty scans would take minutes; an
 * encoder writes one (baseline) or about ten (progressive).
 */
export const MAX_JPEG_SCANS = 64

/**
 * A JPEG's markers, the whole file: its one frame (a second is refused, as
 * libjpeg does), with 1 to 4 for each sampling factor (as libjpeg allows; jpeg-js
 * would take up to 15 and allocate for them), and no more than MAX_JPEG_SCANS
 * scans. Every other segment jpeg-js reads is bounded by its 16-bit length.
 */
function jpegHeader(bytes: Uint8Array): PictureHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let orientation = 1
  let frame: { width: number; height: number } | null = null
  let scans = 0
  let at = 2
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xFF) refuse('unreadable')
    const marker = bytes[at + 1]!
    if (marker === 0xFF) {
      at += 1
      continue
    }
    if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
      at += 2
      continue
    }
    if (marker === 0xD9) break
    const length = view.getUint16(at + 2)
    if (length < 2 || at + 2 + length > bytes.length) refuse('unreadable')
    const body = at + 4
    const end = at + 2 + length
    if (marker === 0xE1 && !frame && length >= 8 && String.fromCharCode(...bytes.subarray(body, body + 6)) === 'Exif\0\0') {
      orientation = tiffOrientation(bytes, body + 6, end)
    }
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      if (frame) refuse('unreadable')
      if (length < 8) refuse('unreadable')
      // jpeg-js reads 8-bit Huffman JPEGs, baseline or progressive, grey or YCbCr.
      const components = bytes[body + 5]!
      if (marker > 0xC2 || bytes[body] !== 8 || (components !== 1 && components !== 3)) refuse('unsupported')
      if (length < 8 + components * 3) refuse('unreadable')
      for (let i = 0; i < components; i += 1) {
        const sampling = bytes[body + 7 + i * 3]!
        const across = sampling >> 4
        const down = sampling & 15
        if (across < 1 || across > 4 || down < 1 || down > 4) refuse('unreadable')
      }
      frame = { width: view.getUint16(body + 3), height: view.getUint16(body + 1) }
    }
    at = end
    if (marker === 0xDA) {
      if (!frame) refuse('unreadable')
      scans += 1
      if (scans > MAX_JPEG_SCANS) refuse('unsupported')
      // The scan's coded data, up to the next marker that is not a restart (0xFF00 is a stuffed 0xFF).
      while (at + 1 < bytes.length && !(bytes[at] === 0xFF && bytes[at + 1] !== 0 && bytes[at + 1] !== 0xFF && !(bytes[at + 1]! >= 0xD0 && bytes[at + 1]! <= 0xD7))) at += 1
    }
  }
  if (!frame || scans === 0) refuse('unreadable')
  return { format: 'jpeg', width: frame.width, height: frame.height, orientation }
}

/** What a picture's header says, held to the limits; refuses anything but a PNG or a JPEG this can read. */
export function readPictureHeader(bytes: Uint8Array): PictureHeader {
  if (bytes.length > MAX_PICTURE_BYTES) refuse('tooLarge')
  const header = PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)
    ? pngHeader(bytes)
    : bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF
      ? jpegHeader(bytes)
      : refuse('unsupported')
  const { width, height } = header
  if (width < 1 || height < 1) refuse('unreadable')
  if (width > MAX_PICTURE_EDGE || height > MAX_PICTURE_EDGE || width * height > MAX_PICTURE_PIXELS) refuse('tooLarge')
  return header
}

const PNG_TYPE = { IHDR: 0x49484452, PLTE: 0x504C5445, tRNS: 0x74524E53, IDAT: 0x49444154, IEND: 0x49454E44 }

/** The bytes a PNG's pixels inflate to: each row's filter byte and its samples, for each of interlacing's passes. */
function pngPixelBytes(width: number, height: number, depth: number, colour: number, interlaced: boolean): number {
  const channels = [1, 0, 3, 1, 2, 0, 4][colour] ?? 4
  const rows = (w: number, h: number) => (w > 0 && h > 0 ? h * (1 + Math.ceil((w * channels * depth) / 8)) : 0)
  if (!interlaced) return rows(width, height)
  // Adam7: each pass's first column and row and its step across and down.
  const passes = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]
  return passes.reduce((sum, [x, y, across, down]) => sum + rows(Math.ceil((width - x!) / across!), Math.ceil((height - y!) / down!)), 0)
}

/**
 * The PNG as fast-png is given it: its first IHDR, the palette of a
 * palette-coloured one, a tRNS before the pixels, the first run of IDATs, and
 * an IEND. Every other chunk is left out, so nothing fast-png would inflate or
 * allocate for is left but the pixels (a profile, iCCP, is inflated whole; a
 * second IHDR would size them anew; a truecolour picture's suggested palette
 * would be read as its colours). A chunk must fit the file; a critical one
 * whose CRC is wrong is refused, a tRNS whose CRC is wrong is left out, as
 * libpng does. The pixels are inflated with a cap first: a stream that inflates
 * past what the header's size needs is refused before fast-png reads it.
 */
export function pngForDecoder(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const kept: Uint8Array[] = [bytes.subarray(0, 8)]
  const idat: Uint8Array[] = []
  const colour = bytes[25]!
  let palette = false
  let transparency = false
  let ended = false
  let lastWasIdat = false
  for (let at = 8; at < bytes.length && !ended;) {
    if (at + 12 > bytes.length) refuse('unreadable')
    const length = view.getUint32(at)
    const type = view.getUint32(at + 4)
    if (length > 0x7FFFFFFF || at + 12 + length > bytes.length) refuse('unreadable')
    const whole = bytes.subarray(at, at + 12 + length)
    const sound = () => crc32(whole.subarray(4, 8 + length)) === view.getUint32(at + 8 + length)
    const pixelsBegun = idat.length > 0
    if (at === 8) {
      if (type !== PNG_TYPE.IHDR || length !== 13 || !sound()) refuse('unreadable')
      kept.push(whole)
    } else if (type === PNG_TYPE.IDAT) {
      // Only the first run: IDATs after another chunk are not the picture's.
      if (!pixelsBegun || lastWasIdat) {
        if (!sound()) refuse('unreadable')
        idat.push(whole.subarray(8, 8 + length))
        kept.push(whole)
      }
    } else if (type === PNG_TYPE.IEND) {
      ended = true
    } else if (type === PNG_TYPE.PLTE && colour === 3 && !palette && !pixelsBegun) {
      if (length === 0 || length > 768 || length % 3 !== 0 || !sound()) refuse('unreadable')
      palette = true
      kept.push(whole)
    } else if (type === PNG_TYPE.tRNS && !transparency && !pixelsBegun && (colour !== 3 || palette) && sound()) {
      transparency = true
      kept.push(whole)
    }
    lastWasIdat = type === PNG_TYPE.IDAT
    at += 12 + length
  }
  if (idat.length === 0 || (colour === 3 && !palette)) refuse('unreadable')
  const most = pngPixelBytes(view.getUint32(16), view.getUint32(20), bytes[24]!, colour, bytes[28] === 1)
  try {
    // A stream that ends with a few bytes to spare is still read, as libpng does.
    inflateSync(Buffer.concat(idat), { maxOutputLength: most + 1024 })
  } catch {
    refuse('unreadable')
  }
  kept.push(Uint8Array.of(0, 0, 0, 0, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82))
  return Buffer.concat(kept)
}

function pngPixels(bytes: Uint8Array): RgbaPixels {
  const png = decodePng(bytes)
  const { width, height } = png
  const count = width * height
  const out = new Uint8ClampedArray(count * 4)
  if (png.palette) {
    const rgb = convertIndexedToRgb(png)
    const channels = rgb.length / count
    for (let i = 0; i < count; i += 1) {
      out[i * 4] = rgb[i * channels]!
      out[i * 4 + 1] = rgb[i * channels + 1]!
      out[i * 4 + 2] = rgb[i * channels + 2]!
      out[i * 4 + 3] = channels === 4 ? rgb[i * channels + 3]! : 255
    }
    return { width, height, data: out }
  }
  const { channels, depth } = png
  // Below 8 bits the data is packed bytes, each row starting on a byte; from 8 bits on, one element a sample.
  const needed = depth < 8 ? Math.ceil((width * channels * depth) / 8) * height : width * height * channels
  if (png.data.length < needed) refuse('unreadable')
  const samples = depth < 8 ? unpackSamples(png.data, width, height, depth) : png.data
  const max = (1 << depth) - 1
  // To 8 bits, rounded.
  const level = (value: number) => (depth === 8 ? value : Math.round((value * 255) / max))
  const transparent = png.transparency && png.transparency.length > 0 ? png.transparency : null
  for (let i = 0; i < count; i += 1) {
    const at = i * channels
    const grey = channels < 3
    const r = samples[at]!
    const g = grey ? r : samples[at + 1]!
    const b = grey ? r : samples[at + 2]!
    const alpha = channels === 2 || channels === 4 ? samples[at + channels - 1]! : max
    const keyed = transparent !== null && (grey
      ? r === transparent[0]
      : r === transparent[0] && g === transparent[1] && b === transparent[2])
    out[i * 4] = level(r)
    out[i * 4 + 1] = level(g)
    out[i * 4 + 2] = level(b)
    out[i * 4 + 3] = keyed ? 0 : level(alpha)
  }
  return { width, height, data: out }
}

/** Grey samples of fewer than 8 bits, one to a value; each row starts on a byte. */
function unpackSamples(data: ArrayLike<number>, width: number, height: number, depth: number): Uint8Array {
  const out = new Uint8Array(width * height)
  const rowBytes = Math.ceil((width * depth) / 8)
  const mask = (1 << depth) - 1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const bit = x * depth
      const byte = data[y * rowBytes + (bit >> 3)]!
      out[y * width + x] = (byte >> (8 - depth - (bit & 7))) & mask
    }
  }
  return out
}

/** The picture turned by its EXIF orientation (2–8 flip or turn it; 5–8 swap its edges). */
function upright(pixels: RgbaPixels, orientation: number): RgbaPixels {
  if (orientation === 1) return pixels
  const { width: w, height: h, data } = pixels
  const turned = orientation >= 5
  const width = turned ? h : w
  const height = turned ? w : h
  const out = new Uint8ClampedArray(data.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sx = x
      let sy = y
      switch (orientation) {
        case 2: sx = w - 1 - x; break
        case 3: sx = w - 1 - x; sy = h - 1 - y; break
        case 4: sy = h - 1 - y; break
        case 5: sx = y; sy = x; break
        case 6: sx = y; sy = h - 1 - x; break
        case 7: sx = w - 1 - y; sy = h - 1 - x; break
        case 8: sx = w - 1 - y; sy = x; break
      }
      const from = (sy * w + sx) * 4
      const to = (y * width + x) * 4
      out[to] = data[from]!
      out[to + 1] = data[from + 1]!
      out[to + 2] = data[from + 2]!
      out[to + 3] = data[from + 3]!
    }
  }
  return { width, height, data: out }
}

/** A PNG or a JPEG read into upright RGBA. Embedded colour profiles are not applied. */
export function decodePicture(bytes: Uint8Array): RgbaPixels {
  const header = readPictureHeader(bytes)
  let pixels: RgbaPixels
  try {
    if (header.format === 'png') {
      pixels = pngPixels(pngForDecoder(bytes))
    } else {
      const { width, height, data } = jpeg.decode(bytes, {
        useTArray: true,
        formatAsRGBA: true,
        maxResolutionInMP: MAX_PICTURE_PIXELS / 1e6,
        maxMemoryUsageInMB: 512,
      })
      pixels = { width, height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength) }
    }
  } catch (error) {
    if (error instanceof FigureError) throw error
    refuse('unreadable')
  }
  if (pixels.width !== header.width || pixels.height !== header.height || pixels.data.length !== pixels.width * pixels.height * 4) {
    refuse('unreadable')
  }
  return upright(pixels, header.orientation)
}
