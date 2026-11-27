import type { RasterDraw, RasterRect, RgbaPixels, RigRaster } from '../rigRaster'
import { crc32, deflateSync } from 'node:zlib'
import { decodePicture } from './picture'

// A raster without a canvas, drawing as Chromium's 2D canvas does where that is
// known: pixels kept premultiplied in 8 bits between draws; a high-quality
// stretch bicubic (Mitchell) where it enlarges both ways and otherwise
// bilinear from blended mip levels; an ordinary draw
// bilinear in sixteenths of a pixel; and a draw's edges that fall between
// pixels drawn whole on the pixels whose centres they take in. How near this
// comes to the browser's is measured in `tests/browser/nodeCompile.spec.ts`.
//
// Every size here comes from the import (the PSD's, the atlas's) or from a
// picture held to the limits in `picture.ts`; a draw onto nothing draws nothing.

/** Unpremultiplied 0–255 colour times alpha, in 8 bits, as a canvas stores it. */
function premultiply(colour: number, alpha: number): number {
  return Math.round((colour * alpha) / 255)
}

function unpremultiply(colour: number, alpha: number): number {
  return alpha === 0 ? 0 : Math.min(255, Math.round((colour * 255) / alpha))
}

/** RGBA premultiplied in 8 bits, as a canvas holds a picture drawn into it. */
function premultiplied(pixels: RgbaPixels): Uint8ClampedArray {
  const { data } = pixels
  const out = new Uint8ClampedArray(data.length)
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]!
    out[i] = premultiply(data[i]!, alpha)
    out[i + 1] = premultiply(data[i + 1]!, alpha)
    out[i + 2] = premultiply(data[i + 2]!, alpha)
    out[i + 3] = alpha
  }
  return out
}

interface Premultiplied {
  pixels: Uint8ClampedArray | Float32Array
  width: number
  height: number
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
 * `limit` pixels long. A target pixel is drawn whole when its centre is in
 * that span (the edges are not smoothed), and samples the source there with
 * `kernel`, clamped at the source's edges. `size` is positive.
 */
function taps(source: number, at: number, size: number, limit: number, kernel: Kernel, support: number): Taps {
  // Each edge rounded to the nearest pixel boundary, halves up, as Skia rounds a rectangle.
  const from = Math.max(0, Math.floor(at + 0.5))
  const to = Math.min(limit, Math.floor(at + size + 0.5))
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

/**
 * Halves a premultiplied picture (a mip level, as Skia builds one): each pixel
 * the mean of its 2 × 2 block, or along an odd edge of the 1-2-1 weighted
 * three around it, so the last row or column is not lost.
 */
function halve({ pixels, width, height }: Premultiplied): Premultiplied {
  const w = Math.max(1, width >> 1)
  const h = Math.max(1, height >> 1)
  const taps = (edge: number, i: number): Array<[number, number]> => edge === 1
    ? [[0, 1]]
    : edge % 2 === 1
      ? [[2 * i, 0.25], [2 * i + 1, 0.5], [2 * i + 2, 0.25]]
      : [[2 * i, 0.5], [2 * i + 1, 0.5]]
  const out = new Float32Array(w * h * 4)
  for (let y = 0; y < h; y += 1) {
    const down = taps(height, y)
    for (let x = 0; x < w; x += 1) {
      const across = taps(width, x)
      for (let k = 0; k < 4; k += 1) {
        let sum = 0
        for (const [sy, wy] of down) {
          for (const [sx, wx] of across) sum += pixels[(sy * width + sx) * 4 + k]! * wx * wy
        }
        out[(y * w + x) * 4 + k] = sum
      }
    }
  }
  return { pixels: out, width: w, height: h }
}

/** Whether a rectangle has room to draw into: finite, and wider and taller than nothing. */
function drawable(to: RasterRect): boolean {
  return [to.x, to.y, to.width, to.height].every(Number.isFinite) && to.width > 0 && to.height > 0
}

/** Takes a premultiplied sample (clamped to the picture's range) for the target pixel at `at` (its index × 4). */
type Put = (at: number, r: number, g: number, b: number, a: number) => void

/** Source-over onto a premultiplied 8-bit target, rounded to 8 bits as a canvas keeps it. */
function over(target: Uint8ClampedArray): Put {
  return (at, r, g, b, a) => {
    const keep = 1 - a / 255
    target[at] = Math.round(r + target[at]! * keep)
    target[at + 1] = Math.round(g + target[at + 1]! * keep)
    target[at + 2] = Math.round(b + target[at + 2]! * keep)
    target[at + 3] = Math.round(a + target[at + 3]! * keep)
  }
}

/**
 * A premultiplied picture sampled with `kernel` onto `to` of a `width` ×
 * `height` target, each covered pixel's sample given to `put`. Source rows
 * are sampled across as the target rows down need them, and let go once
 * passed, so no more than a few of them are held at once.
 */
function drawOnto(
  put: Put,
  width: number,
  height: number,
  source: Premultiplied,
  to: RasterRect,
  kernel: Kernel,
  support: number,
): void {
  if (!drawable(to) || source.width < 1 || source.height < 1) return
  const across = taps(source.width, to.x, to.width, width, kernel, support)
  const down = taps(source.height, to.y, to.height, height, kernel, support)
  if (across.count === 0 || down.count === 0) return
  const rows = new Map<number, Float32Array>()
  const rowAcross = (y: number): Float32Array => {
    const cached = rows.get(y)
    if (cached) return cached
    const row = new Float32Array(across.count * 4)
    const line = y * source.width
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
      row[i * 4] = r
      row[i * 4 + 1] = g
      row[i * 4 + 2] = b
      row[i * 4 + 3] = a
    }
    rows.set(y, row)
    return row
  }
  const sampled: Float32Array[] = []
  for (let j = 0; j < down.count; j += 1) {
    const ty = down.from + j
    // The rows this target row samples; the ones above them are done with (taps only move down).
    let lowest = Infinity
    for (let t = j * down.per; t < (j + 1) * down.per; t += 1) {
      sampled[t - j * down.per] = rowAcross(down.index[t]!)
      lowest = Math.min(lowest, down.index[t]!)
    }
    for (const y of rows.keys()) {
      if (y < lowest) rows.delete(y)
    }
    for (let i = 0; i < across.count; i += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let t = 0; t < down.per; t += 1) {
        const w = down.weight[j * down.per + t]!
        if (w === 0) continue
        const row = sampled[t]!
        r += row[i * 4]! * w
        g += row[i * 4 + 1]! * w
        b += row[i * 4 + 2]! * w
        a += row[i * 4 + 3]! * w
      }
      // A cubic can ring past the picture: premultiplied colour stays within its alpha.
      a = Math.min(255, Math.max(0, a))
      if (a === 0) continue
      put((ty * width + across.from + i) * 4, Math.min(a, Math.max(0, r)), Math.min(a, Math.max(0, g)), Math.min(a, Math.max(0, b)), a)
    }
  }
}

/** Copies premultiplied 8-bit pixels at a whole-pixel place, source-over: a draw at its own size on the pixel grid. */
function copyOnto(target: Uint8ClampedArray, width: number, height: number, pixels: RgbaPixels, x: number, y: number): void {
  for (let row = Math.max(0, -y); row < Math.min(pixels.height, height - y); row += 1) {
    const ty = y + row
    for (let column = Math.max(0, -x); column < Math.min(pixels.width, width - x); column += 1) {
      const tx = x + column
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
        if (filter === 1) {
          predicted = left
        } else if (filter === 2) {
          predicted = up
        } else if (filter === 3) {
          predicted = (left + up) >> 1
        } else if (filter === 4) {
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

/**
 * A high-quality stretch of a picture onto `to` of a transparent frame, as
 * Chromium's canvas does it: a Mitchell cubic where it enlarges both ways;
 * otherwise bilinear from mip levels (the picture halved again and again),
 * blended between the two levels around half a level below the scale's (a
 * picture shrunk by less than about 0.7 is sampled from itself alone). A
 * rectangle with no room leaves the frame empty, as a canvas draw onto it does.
 */
export function placePixels(picture: RgbaPixels, width: number, height: number, to: RasterRect): Uint8ClampedArray {
  const target = new Uint8ClampedArray(width * height * 4)
  if (!drawable(to) || picture.width < 1 || picture.height < 1) return target
  const scaleX = to.width / picture.width
  const scaleY = to.height / picture.height
  if (scaleX === 1 && scaleY === 1 && onGrid(to.x, to.y)) {
    copyOnto(target, width, height, picture, to.x, to.y)
    return target
  }
  let level: Premultiplied = { pixels: premultiplied(picture), width: picture.width, height: picture.height }
  if (scaleX >= 1 && scaleY >= 1) {
    drawOnto(over(target), width, height, level, to, mitchell, 2)
    return target
  }
  // A picture is at most MAX_PICTURE_EDGE, so a dozen halvings bring it to one pixel; past that there is nothing to blend.
  const lod = Math.min(16, Math.max(0, Math.log2(1 / Math.min(scaleX, scaleY)) - 0.5))
  const whole = Math.floor(lod)
  for (let i = 0; i < whole && (level.width > 1 || level.height > 1); i += 1) level = halve(level)
  const toward = lod - whole
  if (toward === 0 || (level.width === 1 && level.height === 1)) {
    drawOnto(over(target), width, height, level, to, linear, 1)
    return target
  }
  // The two levels' samples blended, then rounded once.
  const blend = new Float32Array(target.length)
  drawOnto((at, r, g, b, a) => {
    blend[at] = r * (1 - toward)
    blend[at + 1] = g * (1 - toward)
    blend[at + 2] = b * (1 - toward)
    blend[at + 3] = a * (1 - toward)
  }, width, height, level, to, linear, 1)
  drawOnto((at, r, g, b, a) => {
    blend[at] = blend[at]! + r * toward
    blend[at + 1] = blend[at + 1]! + g * toward
    blend[at + 2] = blend[at + 2]! + b * toward
    blend[at + 3] = blend[at + 3]! + a * toward
  }, width, height, halve(level), to, linear, 1)
  for (let i = 0; i < blend.length; i += 1) target[i] = Math.round(blend[i]!)
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
        const sprite = { pixels: premultiplied(pixels), width: pixels.width, height: pixels.height }
        drawOnto(over(target), width, height, sprite, { x, y, width: drawWidth, height: drawHeight }, coarseLinear, 1)
      }
    }
    // Drawn now; encoded after the caller's turn, as a canvas encodes its PNG apart from the drawing.
    await Promise.resolve()
    return pngBlob(width, height, unpremultiplied(target))
  },
}
