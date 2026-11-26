import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'
import { crc32, deflateSync } from 'node:zlib'
import { encode as encodePng } from 'fast-png'
import jpeg from 'jpeg-js'
import { FigureError } from '../../errors'
import { decodePicture, MAX_JPEG_SCANS, MAX_PICTURE_BYTES, MAX_PICTURE_EDGE, pngForDecoder, readPictureHeader } from './picture'
import { placePixels } from './raster'

const SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, body.length)
  out.set(Buffer.from(type, 'latin1'), 4)
  out.set(body, 8)
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)))
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

/** A scan of the first component, with no coded data. */
const EMPTY_SCAN = [0xFF, 0xDA, 0, 8, 1, 1, 0, 0, 63, 0]

/** A JPEG of only its frame header and an empty scan. */
function jpegHeaderOnly(marker: number, { precision = 8, width = 16, height = 16, components = 3 } = {}): Uint8Array {
  const frame = [precision, height >> 8, height & 0xFF, width >> 8, width & 0xFF, components]
  for (let i = 0; i < components; i += 1) frame.push(i + 1, 0x11, 0)
  const length = frame.length + 2
  return new Uint8Array([0xFF, 0xD8, 0xFF, marker, length >> 8, length & 0xFF, ...frame, ...EMPTY_SCAN, 0xFF, 0xD9])
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

/** The chunks of a PNG, by type, in order. */
function chunkTypes(png: Uint8Array): string[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const types: string[] = []
  for (let at = 8; at + 12 <= png.length; at += 12 + view.getUint32(at)) types.push(Buffer.from(png.subarray(at + 4, at + 8)).toString('latin1'))
  return types
}

/** A PNG with `extra` chunks put in after its header (before its pixels) and `trailing` bytes after its end. */
function withChunks(png: Uint8Array, extra: Uint8Array[], trailing: Uint8Array = new Uint8Array(0)): Uint8Array {
  return Buffer.concat([png.subarray(0, 33), ...extra, png.subarray(33), trailing])
}

/** 64 MB of zeros, deflated to 64 KB. */
const BOMB = deflateSync(Buffer.alloc(64 * 1024 * 1024))

test('only the pixels of a PNG are given to the decoder: a bombed profile or text, a second header or what follows the end are left out', () => {
  const plain = encodePng({ width: 16, height: 8, data: halves(), channels: 4 })
  const latin = (text: string) => Buffer.from(text, 'latin1')
  const cases: Record<string, Uint8Array> = {
    iCCP: withChunks(plain, [chunk('iCCP', Buffer.concat([latin('icc\0\0'), BOMB]))]),
    zTXt: withChunks(plain, [chunk('zTXt', Buffer.concat([latin('Comment\0\0'), BOMB]))]),
    iTXt: withChunks(plain, [chunk('iTXt', Buffer.concat([latin('Comment\0\x01\0\0\0'), BOMB]))]),
    'second IHDR': withChunks(plain, [chunk('IHDR', pngHeaderOnly(100_000, 100_000).subarray(16, 29))]),
    'after IEND': withChunks(plain, [], Buffer.concat([chunk('IDAT', BOMB), latin('trailing')])),
    // A truecolour picture's suggested palette, which fast-png would take for its colours.
    'suggested palette': withChunks(plain, [chunk('PLTE', new Uint8Array([0, 255, 0]))]),
  }
  for (const [name, png] of Object.entries(cases)) {
    assert.deepEqual(chunkTypes(pngForDecoder(png)), ['IHDR', 'IDAT', 'IEND'], name)
    const pixels = decodePicture(png)
    assert.deepEqual([pixels.width, pixels.height, colourAt(pixels, 2, 4), colourAt(pixels, 13, 4)], [16, 8, 'red', 'blue'], name)
  }
  // A palette-coloured picture keeps its palette and its transparency.
  const header = pngHeaderOnly(2, 1, { depth: 8, colour: 3 })
  const indexed = Buffer.concat([
    header.subarray(0, 33),
    chunk('PLTE', new Uint8Array([255, 0, 0, 0, 0, 255])),
    chunk('tRNS', new Uint8Array([255, 0])),
    chunk('IDAT', deflateSync(Buffer.from([0, 0, 1]))),
    header.subarray(33),
  ])
  assert.deepEqual(chunkTypes(pngForDecoder(withChunks(indexed, [chunk('iCCP', Buffer.concat([latin('icc\0\0'), BOMB]))]))), ['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'])
  assert.deepEqual([...decodePicture(indexed).data], [255, 0, 0, 255, 0, 0, 255, 0])
})

test('a PNG whose chunks do not hold together is refused', () => {
  const plain = encodePng({ width: 16, height: 8, data: halves(), channels: 4 })
  const corrupt = (at: number) => {
    const bytes = new Uint8Array(plain)
    bytes[at] = bytes[at]! ^ 0xFF
    return bytes
  }
  const idat = chunkTypes(plain).indexOf('IDAT')
  assert.equal(idat, 1)
  // The pixels' CRC, the header's CRC, a chunk longer than the file, and a palette-coloured one without its palette.
  assert.equal(refusal(() => decodePicture(corrupt(33 + 8 + new DataView(plain.buffer, plain.byteOffset).getUint32(33)))).reason, 'unreadable')
  assert.equal(refusal(() => decodePicture(corrupt(29))).reason, 'unreadable')
  const long = new Uint8Array(plain)
  new DataView(long.buffer).setUint32(33, 0x7FFFFFF0)
  assert.equal(refusal(() => decodePicture(long)).reason, 'unreadable')
  assert.equal(refusal(() => decodePicture(pngHeaderOnly(2, 1, { depth: 8, colour: 3, idat: deflateSync(Buffer.from([0, 0, 1])) }))).reason, 'unreadable')
  // An ancillary chunk with a bad CRC is only left out.
  const badText = withChunks(plain, [chunk('tEXt', Buffer.from('a\0b', 'latin1'))])
  badText[33 + 12 + 3 - 1] = badText[33 + 12 + 3 - 1]! ^ 0xFF
  assert.equal(decodePicture(badText).width, 16)
})

test('16-bit PNGs are read, colour and grey, with and without alpha', () => {
  const rgba = new Uint16Array([65535, 0, 32896, 65535, 0, 65535, 0, 32896])
  const fromRgba = decodePicture(encodePng({ width: 2, height: 1, depth: 16, channels: 4, data: rgba }))
  assert.deepEqual([...fromRgba.data], [255, 0, 128, 255, 0, 255, 0, 128])
  const fromRgb = decodePicture(encodePng({ width: 2, height: 1, depth: 16, channels: 3, data: new Uint16Array([65535, 0, 0, 0, 0, 65535]) }))
  assert.deepEqual([...fromRgb.data], [255, 0, 0, 255, 0, 0, 255, 255])
  const fromGrey = decodePicture(encodePng({ width: 3, height: 1, depth: 16, channels: 1, data: new Uint16Array([0, 32896, 65535]) }))
  assert.deepEqual([...fromGrey.data], [0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255])
  const fromGreyAlpha = decodePicture(encodePng({ width: 1, height: 2, depth: 16, channels: 2, data: new Uint16Array([65535, 0, 0, 65535]) }))
  assert.deepEqual([...fromGreyAlpha.data], [255, 255, 255, 0, 0, 0, 0, 255])
})

test('a JPEG with a second frame, sampling past 4 or too many scans is refused before it is decoded', () => {
  const plain = jpegHeaderOnly(0xC0)
  const frame = plain.subarray(2, 2 + 4 + 15)
  const twoFrames = Buffer.concat([plain.subarray(0, 2 + frame.length), frame, plain.subarray(2 + frame.length)])
  assert.equal(refusal(() => readPictureHeader(twoFrames)).reason, 'unreadable')
  const oversampled = new Uint8Array(plain)
  oversampled[2 + 4 + 7] = 0x51
  assert.equal(refusal(() => readPictureHeader(oversampled)).reason, 'unreadable')
  const scans = (count: number) => Buffer.concat([plain.subarray(0, plain.length - 2), ...Array.from({ length: count - 1 }, () => Buffer.from(EMPTY_SCAN)), plain.subarray(plain.length - 2)])
  assert.equal(readPictureHeader(scans(MAX_JPEG_SCANS)).format, 'jpeg')
  assert.equal(refusal(() => readPictureHeader(scans(MAX_JPEG_SCANS + 1))).reason, 'unsupported')
  // Coded data with a stuffed 0xFF and a restart marker in it is walked over.
  const coded = Buffer.concat([plain.subarray(0, plain.length - 2), Buffer.from([0x12, 0xFF, 0x00, 0x34, 0xFF, 0xD0, 0x56]), plain.subarray(plain.length - 2)])
  assert.equal(readPictureHeader(coded).format, 'jpeg')
})

test('nothing can be hidden inside a JPEG segment\'s length: the walk ends each segment where jpeg-js does', () => {
  const plain = jpegHeaderOnly(0xC0)
  const frameEnd = 2 + 4 + 15
  const frame = plain.subarray(2, frameEnd)
  const end = plain.subarray(plain.length - 2)
  /** A scan whose length says it holds `hidden` too: jpeg-js reads its header and then `hidden` as what follows. */
  const hiding = (hidden: Uint8Array) => {
    const length = 8 + hidden.length
    return Buffer.concat([Buffer.from([0xFF, 0xDA, length >> 8, length & 0xFF, 1, 1, 0, 0, 63, 0]), hidden])
  }
  const manyScans = Buffer.concat(Array.from({ length: MAX_JPEG_SCANS + 1 }, () => Buffer.from(EMPTY_SCAN)))
  const hiddenScans = Buffer.concat([plain.subarray(0, frameEnd), hiding(manyScans), end])
  assert.equal(refusal(() => readPictureHeader(hiddenScans)).reason, 'unreadable')
  const hiddenFrame = Buffer.concat([plain.subarray(0, frameEnd), hiding(Buffer.from(frame)), end])
  assert.equal(refusal(() => readPictureHeader(hiddenFrame)).reason, 'unreadable')
  // The same for every segment jpeg-js reads by what is in it: a frame, tables, a restart interval.
  const dqt = [0xFF, 0xDB, 0, 67, 0, ...Array.from({ length: 64 }, () => 1)]
  const dht = [0xFF, 0xC4, 0, 20, 0, 1, ...Array.from({ length: 15 }, () => 0), 0]
  const dri = [0xFF, 0xDD, 0, 4, 0, 1]
  for (const [name, segment] of Object.entries({ dqt, dht, dri })) {
    const fits = Buffer.concat([plain.subarray(0, frameEnd), Buffer.from(segment), plain.subarray(frameEnd)])
    assert.equal(readPictureHeader(fits).format, 'jpeg', name)
    const short = Buffer.from(fits)
    short[frameEnd + 3] = short[frameEnd + 3]! - 1
    assert.equal(refusal(() => readPictureHeader(short)).reason, 'unreadable', `${name} shorter than it holds`)
    const long = Buffer.from(fits)
    long[frameEnd + 3] = long[frameEnd + 3]! + 1
    assert.equal(refusal(() => readPictureHeader(long)).reason, 'unreadable', `${name} longer than it holds`)
  }
  const longFrame = Buffer.from(plain)
  longFrame[2 + 3] = longFrame[2 + 3]! + 3
  assert.equal(refusal(() => readPictureHeader(longFrame)).reason, 'unreadable')
  // A marker jpeg-js does not know, a stray restart, and 0xFF00, between segments.
  for (const stray of [[0xFF, 0xF0, 0, 2], [0xFF, 0xD0], [0xFF, 0x00]]) {
    assert.equal(refusal(() => readPictureHeader(Buffer.concat([plain.subarray(0, frameEnd), Buffer.from(stray), plain.subarray(frameEnd)]))).reason, 'unreadable', JSON.stringify(stray))
  }
  // Fill bytes before a marker are passed, as jpeg-js passes them.
  assert.equal(readPictureHeader(Buffer.concat([plain.subarray(0, frameEnd), Buffer.from([0xFF, 0xFF, 0xFF]), plain.subarray(frameEnd + 1)])).format, 'jpeg')
  // A scan of a component the frame does not have.
  const stranger = Buffer.from(plain)
  stranger[frameEnd + 5] = 9
  assert.equal(refusal(() => readPictureHeader(stranger)).reason, 'unreadable')
})

test('a tRNS on a PNG that has an alpha channel is left out, as browsers ignore it', () => {
  const plain = encodePng({ width: 16, height: 8, data: halves(), channels: 4 })
  const keyed = withChunks(plain, [chunk('tRNS', new Uint8Array([0, 255, 0, 0, 0, 0]))])
  assert.deepEqual(chunkTypes(pngForDecoder(keyed)), ['IHDR', 'IDAT', 'IEND'])
  assert.equal(colourAt(decodePicture(keyed), 2, 4), 'red')
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
