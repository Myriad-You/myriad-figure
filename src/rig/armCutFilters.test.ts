import type { Anime25DSourceReference } from './anime25dImportTypes'
import type { P2 } from './armRaster'
import assert from 'node:assert/strict'
import test from 'node:test'
import { blurClamped, resampleRgb } from './armCutFilters'
import { add2, components, dist2, dot2, gaussian, median, morphEllipse, morphSquare, mul2, nearestRound, percentile, pointSegmentDistance, segmentDistance, sub2 } from './armRaster'

// The plain loops the cut was tuned with (the 2026-11-03 trial), kept as the definition: the fast ones in
// armCutFilters and armRaster must give their every bit.

function plainKernel(sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(sigma * 3))
  const kernel = new Float32Array(r * 2 + 1)
  let sum = 0
  for (let i = -r; i <= r; i += 1) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma))
    kernel[i + r] = v
    sum += v
  }
  for (let i = 0; i < kernel.length; i += 1) kernel[i] /= sum
  return kernel
}

function plainBlur(image: Float32Array, w: number, h: number, sigma: number, channels: number): Float32Array {
  const kernel = plainKernel(sigma)
  const r = kernel.length >> 1
  const pass = new Float32Array(image.length)
  const out = new Float32Array(image.length)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      for (let c = 0; c < channels; c += 1) {
        let sum = 0
        for (let k = -r; k <= r; k += 1) {
          const sx = Math.min(w - 1, Math.max(0, x + k))
          sum += image[(y * w + sx) * channels + c] * kernel[k + r]
        }
        pass[(y * w + x) * channels + c] = sum
      }
    }
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      for (let c = 0; c < channels; c += 1) {
        let sum = 0
        for (let k = -r; k <= r; k += 1) {
          const sy = Math.min(h - 1, Math.max(0, y + k))
          sum += pass[(sy * w + x) * channels + c] * kernel[k + r]
        }
        out[(y * w + x) * channels + c] = sum
      }
    }
  }
  return out
}

function plainResample(
  picture: Anime25DSourceReference,
  placement: { x: number; y: number; width: number; height: number },
  w: number,
  h: number,
): Float32Array {
  const out = new Float32Array(w * h * 3)
  const sx = placement.width / w
  const sy = placement.height / h
  for (let y = 0; y < h; y += 1) {
    const dy = placement.y + (y + 0.5) * sy - 0.5
    for (let x = 0; x < w; x += 1) {
      const dx = placement.x + (x + 0.5) * sx - 0.5
      const x0 = Math.max(0, Math.min(picture.width - 1, Math.floor(dx)))
      const y0 = Math.max(0, Math.min(picture.height - 1, Math.floor(dy)))
      const x1 = Math.min(picture.width - 1, x0 + 1)
      const y1 = Math.min(picture.height - 1, y0 + 1)
      const fx = Math.max(0, Math.min(1, dx - x0))
      const fy = Math.max(0, Math.min(1, dy - y0))
      for (let c = 0; c < 3; c += 1) {
        const top = picture.data[(y0 * picture.width + x0) * 4 + c] * (1 - fx) + picture.data[(y0 * picture.width + x1) * 4 + c] * fx
        const bottom = picture.data[(y1 * picture.width + x0) * 4 + c] * (1 - fx) + picture.data[(y1 * picture.width + x1) * 4 + c] * fx
        out[(y * w + x) * 3 + c] = top * (1 - fy) + bottom * fy
      }
    }
  }
  return out
}

/** Square min or max filter of odd `size`, off the grid not counted. */
function plainMorph(mask: Uint8Array, w: number, h: number, size: number, grow: boolean): Uint8Array {
  const r = size >> 1
  const pass = new Uint8Array(w * h)
  const out = new Uint8Array(w * h)
  const hit = grow ? 1 : 0
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let value = 1 - hit
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k += 1) {
        if (mask[y * w + k] === hit) {
          value = hit
          break
        }
      }
      pass[y * w + x] = value
    }
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let value = 1 - hit
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k += 1) {
        if (pass[k * w + x] === hit) {
          value = hit
          break
        }
      }
      out[y * w + x] = value
    }
  }
  return out
}

function seeded(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6D2B79F5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The same floats, signed zeros and all. */
function sameBits(actual: Float32Array, expected: Float32Array, what: string): void {
  assert.equal(actual.length, expected.length, what)
  assert.deepEqual(new Uint32Array(actual.buffer, actual.byteOffset, actual.length), new Uint32Array(expected.buffer, expected.byteOffset, expected.length), what)
}

test('the fast blur gives the plain blur bit for bit, at every size, feather and channel count the cut uses', () => {
  const random = seeded(11)
  for (const [w, h] of [[1, 1], [1, 9], [9, 1], [2, 3], [5, 4], [7, 7], [10, 12], [11, 3], [37, 23], [64, 41]] as const) {
    for (const sigma of [0.8, 1, 1.5, 2.3]) {
      for (const channels of [1, 3]) {
        // Colours as resampled (fractions of bytes), masks (0 and 1), and values of either sign.
        for (const kind of ['colour', 'mask', 'signed'] as const) {
          const image = Float32Array.from({ length: w * h * channels }, () =>
            kind === 'colour' ? random() * 255 : kind === 'mask' ? (random() < 0.4 ? 1 : 0) : (random() - 0.5) * 1e3)
          sameBits(blurClamped(image, w, h, sigma, channels), plainBlur(image, w, h, sigma, channels), `${w}x${h} sigma ${sigma} x${channels} ${kind}`)
        }
      }
    }
  }
})

test('the fast resample gives the plain resample bit for bit, enlarging, reducing and off the picture', () => {
  const random = seeded(23)
  const picture = (width: number, height: number): Anime25DSourceReference => ({
    width,
    height,
    data: Uint8ClampedArray.from({ length: width * height * 4 }, () => Math.floor(random() * 256)),
  })
  const cases: Array<[Anime25DSourceReference, { x: number; y: number; width: number; height: number }, number, number]> = [
    [picture(40, 30), { x: 0, y: 0, width: 40, height: 30 }, 40, 30],
    [picture(40, 30), { x: 0, y: 0, width: 40, height: 30 }, 23, 17],
    [picture(40, 30), { x: 3.25, y: 1.5, width: 31.5, height: 27.75 }, 64, 55],
    [picture(40, 30), { x: -6, y: -4.5, width: 52, height: 39 }, 29, 22],
    [picture(1, 1), { x: 0, y: 0, width: 1, height: 1 }, 5, 4],
    [picture(17, 9), { x: 2, y: 3, width: 11, height: 5 }, 1, 1],
  ]
  for (const [source, placement, w, h] of cases) {
    sameBits(resampleRgb(source, placement, w, h), plainResample(source, placement, w, h), `${source.width}x${source.height} onto ${w}x${h}`)
  }
})

test('the linear square filter gives the plain one on every mask of ones and zeros', () => {
  const random = seeded(31)
  for (const [w, h] of [[1, 1], [1, 12], [12, 1], [3, 3], [8, 5], [16, 16], [31, 20], [40, 33]] as const) {
    for (const size of [1, 3, 7, 15, 41]) {
      for (const density of [0.02, 0.3, 0.7, 0.98]) {
        const mask = Uint8Array.from({ length: w * h }, () => (random() < density ? 1 : 0))
        for (const grow of [true, false]) {
          assert.deepEqual(morphSquare(mask, w, h, size, grow), plainMorph(mask, w, h, size, grow), `${w}x${h} size ${size} density ${density} ${grow ? 'grown' : 'shrunk'}`)
        }
      }
    }
  }
})

test('the median and percentile are those of a sort by comparison, zeros of either sign and NaN included', () => {
  const random = seeded(47)
  const plainSorted = (values: readonly number[]) => [...values].sort((a, b) => a - b)
  const plainMedian = (values: readonly number[]) => {
    if (!values.length) return 0
    const sorted = plainSorted(values)
    const mid = sorted.length >> 1
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
  }
  const plainPercentile = (values: readonly number[], q: number) => {
    const sorted = plainSorted(values)
    const at = ((sorted.length - 1) * q) / 100
    const lo = Math.floor(at)
    const hi = Math.min(sorted.length - 1, lo + 1)
    return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo)
  }
  const pools: number[][] = [
    [0, 1, 2, 3, 250, 255],
    [-0, 0],
    [-0, 0, 1, -1],
    [-3.5, -0, 0, 2.25, 1e-9, -1e-9],
    [Number.NaN, 1, 2, 3],
    [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, 5],
  ]
  for (const pool of pools) {
    for (let round = 0; round < 300; round += 1) {
      const values = Array.from({ length: Math.floor(random() * 9) }, () => pool[Math.floor(random() * pool.length)]!)
      assert.ok(Object.is(median(values), plainMedian(values)), `median of ${values.map((v) => (Object.is(v, -0) ? '-0' : v)).join(' ')}`)
      if (values.length === 0) continue
      for (const q of [0, 3, 12, 35, 40, 50, 100]) {
        assert.ok(Object.is(percentile(values, q), plainPercentile(values, q)), `percentile ${q} of ${values.map((v) => (Object.is(v, -0) ? '-0' : v)).join(' ')}`)
      }
    }
  }
})

test('the distance to a segment is the same number whether the point comes as a pair or as two numbers', () => {
  const random = seeded(53)
  const plain = (c: P2, a: P2, b: P2) => {
    const d = sub2(b, a)
    const t = Math.min(1, Math.max(0, dot2(sub2(c, a), d) / Math.max(1e-12, dot2(d, d))))
    return dist2(c, add2(a, mul2(d, t)))
  }
  for (let round = 0; round < 5000; round += 1) {
    const point = (): P2 => (random() < 0.2 ? [Math.floor(random() * 50), Math.floor(random() * 50)] : [random() * 900 - 100, random() * 900 - 100])
    const a = point()
    const b = random() < 0.05 ? [a[0], a[1]] as P2 : point()
    const c = point()
    assert.ok(Object.is(segmentDistance(c, a, b), plain(c, a, b)))
    assert.ok(Object.is(pointSegmentDistance(c[0], c[1], a, b), plain(c, a, b)))
  }
})

test('the Gaussian of the arm model gives the plain one bit for bit, mirrored at the edges and running round', () => {
  const random = seeded(61)
  const plainGaussian = (image: Float32Array, w: number, h: number, sigma: number, wrap: boolean) => {
    const size = Math.round(sigma * 8 + 1) | 1
    const r = size >> 1
    const kernel = new Float32Array(size)
    let total = 0
    for (let i = 0; i < size; i += 1) {
      kernel[i] = Math.exp(-((i - r) ** 2) / (2 * sigma * sigma))
      total += kernel[i]!
    }
    for (let i = 0; i < size; i += 1) kernel[i]! /= total
    const taps = (n: number, round: boolean) =>
      Int32Array.from({ length: n + 2 * r }, (_, i) => {
        let k = i - r
        if (n === 1) return 0
        if (round) return ((k % n) + n) % n
        while (k < 0 || k >= n) k = k < 0 ? -k : 2 * n - 2 - k
        return k
      })
    const xs = taps(w, wrap)
    const ys = taps(h, false)
    const pass = new Float32Array(w * h)
    for (let y = 0; y < h; y += 1) {
      const row = y * w
      for (let x = 0; x < w; x += 1) {
        let sum = 0
        for (let k = 0; k < size; k += 1) sum += image[row + xs[x + k]!]! * kernel[k]!
        pass[row + x] = sum
      }
    }
    const out = new Float32Array(w * h)
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        let sum = 0
        for (let k = 0; k < size; k += 1) sum += pass[ys[y + k]! * w + x]! * kernel[k]!
        out[y * w + x] = sum
      }
    }
    return out
  }
  for (const [w, h] of [[1, 1], [1, 7], [7, 1], [2, 2], [3, 5], [9, 9], [16, 11], [40, 27]] as const) {
    for (const sigma of [0.05, 1, 1.5, 2]) {
      for (const wrap of [false, true]) {
        const image = Float32Array.from({ length: w * h }, () => (random() < 0.3 ? Math.floor(random() * 2) : random() * 255))
        sameBits(gaussian(image, w, h, sigma, wrap), plainGaussian(image, w, h, sigma, wrap), `${w}x${h} sigma ${sigma}${wrap ? ' round' : ''}`)
      }
    }
  }
})

test('the ellipse filter gives what testing every pixel of the ellipse gives', () => {
  const random = seeded(67)
  const plainEllipse = (mask: Uint8Array, w: number, h: number, size: number, grow: boolean) => {
    const r = size >> 1
    const out = new Uint8Array(w * h)
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        let any = false
        let all = true
        for (let dy = -r; dy <= r; dy += 1) {
          const sy = y + dy
          if (sy < 0 || sy >= h) continue
          const half = Math.round(Math.sqrt(r * r - dy * dy))
          for (let sx = Math.max(0, x - half); sx <= Math.min(w - 1, x + half); sx += 1) {
            if (mask[sy * w + sx]) any = true
            else all = false
          }
        }
        out[y * w + x] = grow ? (any ? 1 : 0) : all ? 1 : 0
      }
    }
    return out
  }
  for (const [w, h] of [[1, 1], [6, 1], [1, 6], [9, 7], [24, 19]] as const) {
    for (const size of [1, 5, 7, 9, 15]) {
      for (const density of [0.05, 0.5, 0.95]) {
        const mask = Uint8Array.from({ length: w * h }, () => (random() < density ? 1 : 0))
        for (const grow of [true, false]) {
          assert.deepEqual(morphEllipse(mask, w, h, size, grow), plainEllipse(mask, w, h, size, grow), `${w}x${h} size ${size} ${grow ? 'grown' : 'shrunk'}`)
        }
      }
    }
  }
})

test('components are numbered and sized as looking at each pixel\'s eight neighbours one by one numbers and sizes them', () => {
  const random = seeded(71)
  const plain = (mask: Uint8Array, w: number, h: number) => {
    const labels = new Int32Array(w * h)
    const stack = new Int32Array(w * h)
    const sizes = [0]
    for (let start = 0; start < w * h; start += 1) {
      if (!mask[start] || labels[start]) continue
      const label = sizes.length
      let size = 0
      let top = 0
      stack[top++] = start
      labels[start] = label
      while (top > 0) {
        const p = stack[--top]!
        size += 1
        const x = p % w
        const y = (p - x) / w
        for (let dy = -1; dy <= 1; dy += 1) {
          const ny = y + dy
          if (ny < 0 || ny >= h) continue
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx
            if (nx < 0 || nx >= w) continue
            const n = ny * w + nx
            if (mask[n] && !labels[n]) {
              labels[n] = label
              stack[top++] = n
            }
          }
        }
      }
      sizes.push(size)
    }
    return { labels, sizes }
  }
  for (const [w, h] of [[1, 1], [1, 8], [8, 1], [2, 2], [7, 5], [30, 22]] as const) {
    for (const density of [0, 0.1, 0.4, 0.6, 1]) {
      for (let round = 0; round < 10; round += 1) {
        const mask = Uint8Array.from({ length: w * h }, () => (random() < density ? 1 + Math.floor(random() * 3) : 0))
        assert.deepEqual(components(mask, w, h), plain(mask, w, h), `${w}x${h} density ${density}`)
      }
    }
  }
})

test('the nearest known place round a ring is the one found by looking through them all in order', () => {
  // The sleeve's own loop as it was (origin/main d4901bb, layOnSleeve): the definition.
  const plain = (have: readonly number[], around: number, j: number) => {
    let pick = have[0]!
    let nearest = Infinity
    for (const h of have) {
      const d = Math.min(Math.abs(h - j), around - Math.abs(h - j))
      if (d < nearest) {
        nearest = d
        pick = h
      }
    }
    return pick
  }
  const check = (have: number[], around: number) => {
    const fast = nearestRound(have, around)
    for (let j = 0; j < around; j += 1) assert.equal(fast[j], plain(have, around, j), `place ${j} of ${around}, known ${have.join(' ')}`)
  }
  // Every choice of known places on small rings: one known, all known, the ends, places as near either way.
  for (let around = 1; around <= 11; around += 1) {
    for (let chosen = 1; chosen < 1 << around; chosen += 1) {
      check(Array.from({ length: around }, (_, j) => j).filter((j) => chosen & (1 << j)), around)
    }
  }
  // And on the sleeve's own ring, sparse to nearly full.
  const random = seeded(73)
  for (const share of [0.01, 0.1, 0.5, 0.9, 0.99]) {
    for (let round = 0; round < 40; round += 1) {
      const have = Array.from({ length: 256 }, (_, j) => j).filter(() => random() < share)
      if (have.length === 0) have.push(Math.floor(random() * 256))
      check(have, 256)
    }
  }
})
