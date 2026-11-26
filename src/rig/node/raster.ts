import type { RasterDraw, RasterRect, RgbaPixels, RigRaster } from '../rigRaster'
import { crc32, deflateSync } from 'node:zlib'
import { convertIndexedToRgb, decode as decodePng, hasPngSignature } from 'fast-png'
import jpeg from 'jpeg-js'

// A raster without a canvas, drawing as Chromium's 2D canvas does where that is
// known: pixels kept premultiplied in 8 bits between draws, a high-quality
// stretch bicubic (Mitchell) when it enlarges and bilinear when it shrinks
// (from a halved copy below half), bilinear for an ordinary draw, and a draw's edges that
// fall between pixels drawn whole on the pixels whose centres they take in.
// How near this comes to the browser's is measured in
// `tests/browser/nodeCompile.spec.ts`.

/** Unpremultiplied 0–255 colour times alpha, in 8 bits, as a canvas stores it. */
function premultiply(colour: number, alpha: number): number {
  return Math.round((colour * alpha) / 255)
}

function unpremultiply(colour: number, alpha: number): number {
  return alpha === 0 ? 0 : Math.min(255, Math.round((colour * 255) / alpha))
}

/** RGBA premultiplied, as floats, of a picture. */
function premultiplied(pixels: RgbaPixels): Float32Array {
  const { data } = pixels
  const out = new Float32Array(data.length)
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]!
    out[i] = premultiply(data[i]!, alpha)
    out[i + 1] = premultiply(data[i + 1]!, alpha)
    out[i + 2] = premultiply(data[i + 2]!, alpha)
    out[i + 3] = alpha
  }
  return out
}

type Kernel = (distance: number) => number

const linear: Kernel = (x) => Math.max(0, 1 - Math.abs(x))

/** Bilinear with the sample's place between pixels cut to sixteenths, as an ordinary canvas draw takes it. */
const coarseLinear: Kernel = (x) => {
  if (x <= -1 || x > 1) return 0
  const between = Math.floor((x <= 0 ? -x : 1 - x) * 16) / 16
  return x <= 0 ? 1 - between : between
}

/** Mitchell–Netravali, B = C = 1/3. */
const mitchell: Kernel = (value) => {
  const x = Math.abs(value)
  if (x < 1) return (7 * x ** 3 - 12 * x ** 2 + 16 / 3) / 6
  if (x < 2) return (-7 / 3 * x ** 3 + 12 * x ** 2 - 20 * x + 32 / 3) / 6
  return 0
}

interface Taps {
  /** The first target pixel the draw covers, and how many. */
  from: number
  count: number
  /** Each one's `per` source pixels and their weights, one after another. */
  per: number
  index: Int32Array
  weight: Float32Array
}

/**
 * One axis of a draw of `source` pixels onto [at, at + size) of a target
 * `limit` pixels long. A target pixel is drawn when its centre is in that
 * span, whole (the edges are not smoothed), and samples the source there with
 * `kernel`, clamped at the source's edges.
 */
function taps(source: number, at: number, size: number, limit: number, kernel: Kernel, support: number): Taps {
  const from = Math.max(0, Math.ceil(at - 0.5))
  const to = Math.min(limit, Math.ceil(at + size - 0.5))
  const count = Math.max(0, to - from)
  const scale = source / size
  const per = 2 * support
  const index = new Int32Array(count * per)
  const weight = new Float32Array(count * per)
  for (let i = 0; i < count; i += 1) {
    const pixel = from + i
    const centre = (pixel + 0.5 - at) * scale - 0.5
    const first = Math.floor(centre - support) + 1
    let sum = 0
    for (let t = 0; t < per; t += 1) {
      const w = kernel(first + t - centre)
      index[i * per + t] = Math.min(source - 1, Math.max(0, first + t))
      weight[i * per + t] = w
      sum += w
    }
    for (let t = 0; t < per; t += 1) weight[i * per + t]! /= sum
  }
  return { from, count, per, index, weight }
}

/** Halves a premultiplied picture, each pixel the mean of its 2×2 block (a mip level). */
function halve(pixels: Float32Array, width: number, height: number): { pixels: Float32Array; width: number; height: number } {
  const w = Math.max(1, width >> 1)
  const h = Math.max(1, height >> 1)
  const out = new Float32Array(w * h * 4)
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.min(height - 1, 2 * y)
    const y1 = Math.min(height - 1, 2 * y + 1)
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.min(width - 1, 2 * x)
      const x1 = Math.min(width - 1, 2 * x + 1)
      for (let k = 0; k < 4; k += 1) {
        out[(y * w + x) * 4 + k] = (
          pixels[(y0 * width + x0) * 4 + k]! + pixels[(y0 * width + x1) * 4 + k]!
          + pixels[(y1 * width + x0) * 4 + k]! + pixels[(y1 * width + x1) * 4 + k]!
        ) / 4
      }
    }
  }
  return { pixels: out, width: w, height: h }
}

/**
 * A premultiplied picture drawn onto `to` of a premultiplied 8-bit target
 * (source-over), sampled with `kernel`; what each target pixel ends up as is
 * rounded to 8 bits, as a canvas keeps it.
 */
function drawOnto(
  target: Uint8ClampedArray,
  width: number,
  height: number,
  source: { pixels: Float32Array; width: number; height: number },
  to: RasterRect,
  kernel: Kernel,
  support: number,
): void {
  const across = taps(source.width, to.x, to.width, width, kernel, support)
  const down = taps(source.height, to.y, to.height, height, kernel, support)
  if (across.count === 0 || down.count === 0) return
  // Across first, the source rows sampled down; then down.
  let top = source.height
  let bottom = 0
  for (const row of down.index) {
    top = Math.min(top, row)
    bottom = Math.max(bottom, row)
  }
  const span = across.count * 4
  const rows = new Float32Array((bottom - top + 1) * span)
  for (let y = top; y <= bottom; y += 1) {
    const line = y * source.width
    const out = (y - top) * span
    for (let i = 0; i < across.count; i += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let t = i * across.per; t < (i + 1) * across.per; t += 1) {
        const w = across.weight[t]!
        if (w === 0) continue
        const at = (line + across.index[t]!) * 4
        r += source.pixels[at]! * w
        g += source.pixels[at + 1]! * w
        b += source.pixels[at + 2]! * w
        a += source.pixels[at + 3]! * w
      }
      rows[out + i * 4] = r
      rows[out + i * 4 + 1] = g
      rows[out + i * 4 + 2] = b
      rows[out + i * 4 + 3] = a
    }
  }
  for (let j = 0; j < down.count; j += 1) {
    const ty = down.from + j
    for (let i = 0; i < across.count; i += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let t = j * down.per; t < (j + 1) * down.per; t += 1) {
        const w = down.weight[t]!
        if (w === 0) continue
        const at = (down.index[t]! - top) * span + i * 4
        r += rows[at]! * w
        g += rows[at + 1]! * w
        b += rows[at + 2]! * w
        a += rows[at + 3]! * w
      }
      // A cubic can ring past the picture: premultiplied colour stays within its alpha.
      a = Math.min(255, Math.max(0, a))
      if (a === 0) continue
      r = Math.min(a, Math.max(0, r))
      g = Math.min(a, Math.max(0, g))
      b = Math.min(a, Math.max(0, b))
      const out = (ty * width + across.from + i) * 4
      const keep = 1 - a / 255
      target[out] = Math.round(r + target[out]! * keep)
      target[out + 1] = Math.round(g + target[out + 1]! * keep)
      target[out + 2] = Math.round(b + target[out + 2]! * keep)
      target[out + 3] = Math.round(a + target[out + 3]! * keep)
    }
  }
}

/** Copies premultiplied 8-bit pixels at a whole-pixel place, source-over: a draw at its own size on the pixel grid. */
function copyOnto(target: Uint8ClampedArray, width: number, height: number, pixels: RgbaPixels, x: number, y: number): void {
  for (let row = 0; row < pixels.height; row += 1) {
    const ty = y + row
    if (ty < 0 || ty >= height) continue
    for (let column = 0; column < pixels.width; column += 1) {
      const tx = x + column
      if (tx < 0 || tx >= width) continue
      const from = (row * pixels.width + column) * 4
      const alpha = pixels.data[from + 3]!
      if (alpha === 0) continue
      const out = (ty * width + tx) * 4
      const keep = (255 - alpha) / 255
      for (let k = 0; k < 3; k += 1) target[out + k] = Math.round(premultiply(pixels.data[from + k]!, alpha) + target[out + k]! * keep)
      target[out + 3] = Math.round(alpha + target[out + 3]! * keep)
    }
  }
}

function unpremultiplied(target: Uint8ClampedArray): Uint8ClampedArray {
  for (let i = 0; i < target.length; i += 4) {
    const alpha = target[i + 3]!
    target[i] = unpremultiply(target[i]!, alpha)
    target[i + 1] = unpremultiply(target[i + 1]!, alpha)
    target[i + 2] = unpremultiply(target[i + 2]!, alpha)
  }
  return target
}

function onGrid(x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y)
}

/** Reads a PNG or a JPEG into RGBA; other formats are refused. Embedded colour profiles are not applied. */
export function decodePicture(bytes: Uint8Array): RgbaPixels {
  if (hasPngSignature(bytes)) return pngPixels(bytes)
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    const { width, height, data } = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true })
    return { width, height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength) }
  }
  throw new Error('Only PNG and JPEG pictures can be read here')
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

/** A PNG of RGBA pixels: each row filtered the way that leaves the smallest bytes, deflated by zlib. */
function pngBlob(width: number, height: number, data: Uint8ClampedArray): Blob {
  const stride = width * 4
  const filtered = new Uint8Array(height * (stride + 1))
  const trial = Array.from({ length: 5 }, () => new Uint8Array(stride))
  for (let y = 0; y < height; y += 1) {
    const row = y * stride
    const above = row - stride
    let best = 0
    let bestCost = Infinity
    for (let filter = 0; filter < 5; filter += 1) {
      const out = trial[filter]!
      let cost = 0
      for (let x = 0; x < stride; x += 1) {
        const value = data[row + x]!
        const left = x >= 4 ? data[row + x - 4]! : 0
        const up = y > 0 ? data[above + x]! : 0
        const corner = x >= 4 && y > 0 ? data[above + x - 4]! : 0
        let predicted = 0
        if (filter === 1) { predicted = left
}
        else if (filter === 2) { predicted = up
}
        else if (filter === 3) { predicted = (left + up) >> 1
}
        else if (filter === 4) {
          const p = left + up - corner
          const pa = Math.abs(p - left)
          const pb = Math.abs(p - up)
          const pc = Math.abs(p - corner)
          predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner
        }
        const byte = (value - predicted) & 0xFF
        out[x] = byte
        cost += byte < 128 ? byte : 256 - byte
      }
      if (cost < bestCost) {
        bestCost = cost
        best = filter
      }
    }
    filtered[y * (stride + 1)] = best
    filtered.set(trial[best]!, y * (stride + 1) + 1)
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header.set([8, 6, 0, 0, 0], 8)
  const chunk = (type: string, body: Uint8Array) => {
    const out = new Uint8Array(12 + body.length)
    const chunkView = new DataView(out.buffer)
    chunkView.setUint32(0, body.length)
    for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i)
    out.set(body, 8)
    chunkView.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)))
    return out
  }
  return new Blob([
    new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', header),
    chunk('IDAT', new Uint8Array(deflateSync(filtered, { level: 4 }))),
    chunk('IEND', new Uint8Array(0)),
  ], { type: 'image/png' })
}

/** A high-quality stretch of a premultiplied picture onto `to` of a transparent frame. */
function placePixels(picture: RgbaPixels, width: number, height: number, to: RasterRect): Uint8ClampedArray {
  const target = new Uint8ClampedArray(width * height * 4)
  const scaleX = to.width / picture.width
  const scaleY = to.height / picture.height
  if (scaleX === 1 && scaleY === 1 && onGrid(to.x, to.y)) {
    copyOnto(target, width, height, picture, to.x, to.y)
    return target
  }
  let source = { pixels: premultiplied(picture), width: picture.width, height: picture.height }
  if (scaleX >= 1 && scaleY >= 1) {
    drawOnto(target, width, height, source, to, mitchell, 2)
    return target
  }
  // Shrunk: bilinear, from the picture halved as many times as it stays at least the draw's size.
  const levels = Math.floor(Math.log2(1 / Math.min(scaleX, scaleY)))
  for (let level = 0; level < levels; level += 1) source = halve(source.pixels, source.width, source.height)
  drawOnto(target, width, height, source, to, linear, 1)
  return target
}

/** The raster of an import run without a browser: PNG and JPEG pictures in, PNG files out. */
export const nodeRigRaster: RigRaster<RgbaPixels> = {
  async decode(file) {
    return decodePicture(new Uint8Array(await file.arrayBuffer()))
  },
  release() {},
  place(picture, width, height, to) {
    return { width, height, data: unpremultiplied(placePixels(picture, width, height, to)) }
  },
  async paint(width, height, draws: readonly RasterDraw[]) {
    const target = new Uint8ClampedArray(width * height * 4)
    for (const { pixels, x, y, width: drawWidth = pixels.width, height: drawHeight = pixels.height } of draws) {
      if (drawWidth === pixels.width && drawHeight === pixels.height && onGrid(x, y)) {
        copyOnto(target, width, height, pixels, x, y)
      } else {
        // The sprite as the canvas would hold it, premultiplied in 8 bits, then sampled.
        const sprite = premultiplied(pixels)
        drawOnto(target, width, height, { pixels: sprite, width: pixels.width, height: pixels.height }, { x, y, width: drawWidth, height: drawHeight }, coarseLinear, 1)
      }
    }
    return pngBlob(width, height, unpremultiplied(target))
  },
}
