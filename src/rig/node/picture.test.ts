import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'
import { deflateSync } from 'node:zlib'
import { encode as encodePng } from 'fast-png'
import jpeg from 'jpeg-js'
import { FigureError } from '../../errors'
import { decodePicture, MAX_PICTURE_BYTES, MAX_PICTURE_EDGE, readPictureHeader } from './picture'
import { placePixels } from './raster'

const SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length)
  new DataView(out.buffer).setUint32(0, body.length)
  out.set(Buffer.from(type, 'latin1'), 4)
  out.set(body, 8)
  return out
}

/** A PNG of only its header (and `idat`, if given). */
function pngHeaderOnly(width: number, height: number, { depth = 8, colour = 6, interlace = 0, idat }: { depth?: number; colour?: number; interlace?: number; idat?: Uint8Array } = {}): Uint8Array {
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header.set([depth, colour, 0, 0, interlace], 8)
  return Buffer.concat([Buffer.from(SIGNATURE), chunk('IHDR', header), ...(idat ? [chunk('IDAT', idat)] : []), chunk('IEND', new Uint8Array(0))])
}

/** A JPEG of only its frame header. */
function jpegHeaderOnly(marker: number, { precision = 8, width = 16, height = 16, components = 3 } = {}): Uint8Array {
  const frame = [precision, height >> 8, height & 0xFF, width >> 8, width & 0xFF, components]
  for (let i = 0; i < components; i += 1) frame.push(i + 1, 0x11, 0)
  const length = frame.length + 2
  return new Uint8Array([0xFF, 0xD8, 0xFF, marker, length >> 8, length & 0xFF, ...frame, 0xFF, 0xD9])
}

/** A TIFF block with one tag: the orientation. */
function exif(orientation: number): Uint8Array {
  return new Uint8Array([0x4D, 0x4D, 0, 0x2A, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0, 0, 0])
}

function refusal(run: () => unknown): Record<string, unknown> {
  try {
    run()
  } catch (error) {
    assert.ok(error instanceof FigureError)
    assert.equal(error.code, 'psdPreviewFailed')
    return error.params
  }
  return assert.fail('read')
}

test('a picture past the limits is refused from its header, before it is decoded', () => {
  assert.equal(refusal(() => readPictureHeader(pngHeaderOnly(MAX_PICTURE_EDGE + 1, 1))).reason, 'tooLarge')
  assert.equal(refusal(() => readPictureHeader(pngHeaderOnly(4097, 4097))).reason, 'tooLarge')
  assert.equal(refusal(() => readPictureHeader(jpegHeaderOnly(0xC0, { width: MAX_PICTURE_EDGE + 1 }))).reason, 'tooLarge')
  const long = new Uint8Array(MAX_PICTURE_BYTES + 1)
  long.set(SIGNATURE)
  assert.equal(refusal(() => readPictureHeader(long)).reason, 'tooLarge')
  assert.equal(refusal(() => readPictureHeader(pngHeaderOnly(0, 16))).reason, 'unreadable')
  assert.deepEqual(readPictureHeader(pngHeaderOnly(4096, 4096)), { format: 'png', width: 4096, height: 4096, orientation: 1 })
})

test('pictures of a kind this cannot read are refused as unsupported', () => {
  assert.equal(refusal(() => readPictureHeader(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).reason, 'unsupported')
  // An interlaced palette of 2 bits a pixel; arithmetic-coded, 12-bit and four-colour (CMYK) JPEGs.
  assert.equal(refusal(() => readPictureHeader(pngHeaderOnly(16, 16, { depth: 2, colour: 3, interlace: 1 }))).reason, 'unsupported')
  assert.equal(refusal(() => readPictureHeader(jpegHeaderOnly(0xC9))).reason, 'unsupported')
  assert.equal(refusal(() => readPictureHeader(jpegHeaderOnly(0xC1, { precision: 12 }))).reason, 'unsupported')
  assert.equal(refusal(() => readPictureHeader(jpegHeaderOnly(0xC0, { components: 4 }))).reason, 'unsupported')
  assert.equal(readPictureHeader(jpegHeaderOnly(0xC2)).format, 'jpeg')
})

test('a PNG whose pixels inflate past what its size can hold is refused', () => {
  const bomb = pngHeaderOnly(16, 16, { idat: deflateSync(Buffer.alloc(8 * 1024 * 1024)) })
  assert.equal(refusal(() => decodePicture(bomb)).reason, 'unreadable')
})

/** 16 × 8: the left half red, the right half blue. */
function halves(): Uint8Array {
  const data = new Uint8Array(16 * 8 * 4)
  for (let i = 0; i < 16 * 8; i += 1) data.set((i % 16) < 8 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4)
  return data
}

function colourAt(pixels: { width: number; data: Uint8ClampedArray }, x: number, y: number): 'red' | 'blue' | 'other' {
  const at = (y * pixels.width + x) * 4
  const [r, , b] = pixels.data.subarray(at, at + 3)
  return r! > 200 && b! < 60 ? 'red' : b! > 200 && r! < 60 ? 'blue' : 'other'
}

test('a picture is turned upright by its EXIF orientation, from a JPEG or a PNG, as a browser does', () => {
  const plainJpeg = new Uint8Array(jpeg.encode({ width: 16, height: 8, data: halves() }, 95).data)
  const app1 = new Uint8Array([...Buffer.from('Exif\0\0', 'latin1'), ...exif(6)])
  const turnedJpeg = Buffer.concat([plainJpeg.subarray(0, 2), Buffer.from([0xFF, 0xE1, (app1.length + 2) >> 8, (app1.length + 2) & 0xFF]), app1, plainJpeg.subarray(2)])
  const plainPng = encodePng({ width: 16, height: 8, data: halves(), channels: 4 })
  const turnedPng = Buffer.concat([plainPng.subarray(0, 33), chunk('eXIf', exif(6)), plainPng.subarray(33)])
  for (const [name, plain, turned] of [['JPEG', plainJpeg, turnedJpeg], ['PNG', plainPng, turnedPng]] as const) {
    const upright = decodePicture(plain)
    assert.deepEqual([upright.width, upright.height, colourAt(upright, 2, 4), colourAt(upright, 13, 4)], [16, 8, 'red', 'blue'], name)
    // Turned a quarter clockwise: the left half is on top.
    const quarter = decodePicture(turned)
    assert.deepEqual([quarter.width, quarter.height, colourAt(quarter, 4, 2), colourAt(quarter, 4, 13)], [8, 16, 'red', 'blue'], name)
  }
})

test('a portrait stretched onto no room at all leaves the frame empty, at once', () => {
  const picture = { width: 1, height: 5000, data: new Uint8ClampedArray(5000 * 4).fill(255) }
  for (const to of [{ x: 128, y: 0, width: 0, height: 320 }, { x: 0, y: 0, width: 1e-9, height: 0 }, { x: Number.NaN, y: 0, width: 4, height: 4 }]) {
    const frame = placePixels(picture, 256, 320, to)
    assert.equal(frame.length, 256 * 320 * 4)
    assert.ok(frame.every((value) => value === 0), JSON.stringify(to))
  }
  // A sliver of room: 1/5000 is a dozen halvings, down to one pixel, then drawn.
  const sliver = placePixels(picture, 256, 320, { x: 100, y: 0, width: 1, height: 1 })
  assert.equal(sliver[(0 * 256 + 100) * 4 + 3], 255)
})
