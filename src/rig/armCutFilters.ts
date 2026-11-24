import type { Anime25DSourceReference } from './anime25dImportTypes'

/**
 * The pictures a gesture arm is cut on (armVariants): the portrait's rectangle of a document picture resampled
 * onto the working grid, and its Gaussian blur.
 *
 * Both are written for speed and held to the plain loops they replace, bit for bit (armCutFilters.test.ts keeps
 * those loops): every pixel is still the same sum of the same products in the same order, in doubles, rounded to
 * a float once. Only what does not touch a value changed: which pixel a tap reads is worked out once a row or a
 * column, not once a tap, and the commonest sums are written out tap by tap.
 */

function gaussianKernel(sigma: number): Float32Array {
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

/** Separable Gaussian of an image of `channels` interleaved floats, edges clamped. */
export function blurClamped(image: Float32Array, w: number, h: number, sigma: number, channels = 1): Float32Array {
  // The float kernel's own values, as the doubles they are read as.
  const kernel = Float64Array.from(gaussianKernel(sigma))
  const taps = kernel.length
  const r = taps >> 1
  const stride = w * channels
  const pass = new Float32Array(image.length)
  const out = new Float32Array(image.length)
  // Across. Between `inner0` and `inner1` no tap leaves the row.
  const inner0 = Math.min(r, w)
  const inner1 = Math.max(inner0, w - r)
  const clampedAcross = (row: number, x: number) => {
    for (let c = 0; c < channels; c += 1) {
      let sum = 0
      for (let k = 0; k < taps; k += 1) {
        const sx = Math.min(w - 1, Math.max(0, x + k - r))
        sum += image[row + sx * channels + c] * kernel[k]
      }
      pass[row + x * channels + c] = sum
    }
  }
  for (let y = 0; y < h; y += 1) {
    const row = y * stride
    for (let x = 0; x < inner0; x += 1) clampedAcross(row, x)
    sumAcross(image, pass, row + inner0 * channels, row + inner1 * channels, channels, kernel)
    for (let x = inner1; x < w; x += 1) clampedAcross(row, x)
  }
  // Down: the rows each tap reads, clamped once a row.
  const rows = new Int32Array(taps)
  for (let y = 0; y < h; y += 1) {
    for (let k = 0; k < taps; k += 1) rows[k] = Math.min(h - 1, Math.max(0, y + k - r)) * stride
    sumDown(pass, out, y * stride, stride, rows, kernel)
  }
  return out
}

/**
 * A kernel's sums across a row: for each pixel from `from` up to `to`, the taps `step` apart about it, none
 * leaving the row. Each sum is the taps in order from nothing, in doubles, as `let sum = 0; sum += tap` adds them.
 * The sizes the cut and the arm model use are written out (`0 + a + b …` adds left to right, as the loop does): a
 * loop over the taps costs several times the sums themselves.
 */
export function sumAcross(image: Float32Array, pass: Float32Array, from: number, to: number, step: number, kernel: Float64Array): void {
  switch (kernel.length) {
    case 7: return across7(image, pass, from, to, step, kernel)
    case 9: return across9(image, pass, from, to, step, kernel)
    case 11: return across11(image, pass, from, to, step, kernel)
    case 13: return across13(image, pass, from, to, step, kernel)
    case 17: return across17(image, pass, from, to, step, kernel)
  }
  const taps = kernel.length
  const reach = (taps >> 1) * step
  for (let i = from; i < to; i += 1) {
    let sum = 0
    for (let k = 0; k < taps; k += 1) sum += image[i - reach + k * step] * kernel[k]
    pass[i] = sum
  }
}

/** A kernel's sums down the rows: for each of the `stride` pixels of the row at `to`, the taps at the row starts `rows`. */
export function sumDown(pass: Float32Array, out: Float32Array, to: number, stride: number, rows: Int32Array, kernel: Float64Array): void {
  switch (kernel.length) {
    case 7: return down7(pass, out, to, stride, rows, kernel)
    case 9: return down9(pass, out, to, stride, rows, kernel)
    case 11: return down11(pass, out, to, stride, rows, kernel)
    case 13: return down13(pass, out, to, stride, rows, kernel)
    case 17: return down17(pass, out, to, stride, rows, kernel)
  }
  const taps = kernel.length
  for (let i = 0; i < stride; i += 1) {
    let sum = 0
    for (let k = 0; k < taps; k += 1) sum += pass[rows[k] + i] * kernel[k]
    out[to + i] = sum
  }
}

function across7(image: Float32Array, pass: Float32Array, from: number, to: number, step: number, kernel: Float64Array): void {
  const k0 = kernel[0]
  const k1 = kernel[1]
  const k2 = kernel[2]
  const k3 = kernel[3]
  const k4 = kernel[4]
  const k5 = kernel[5]
  const k6 = kernel[6]
  for (let i = from; i < to; i += 1) pass[i] = 0 + image[i - 3 * step] * k0 + image[i - 2 * step] * k1 + image[i - 1 * step] * k2 + image[i] * k3 + image[i + 1 * step] * k4 + image[i + 2 * step] * k5 + image[i + 3 * step] * k6
}

function down7(pass: Float32Array, out: Float32Array, to: number, stride: number, rows: Int32Array, kernel: Float64Array): void {
  const k0 = kernel[0]
  const k1 = kernel[1]
  const k2 = kernel[2]
  const k3 = kernel[3]
  const k4 = kernel[4]
  const k5 = kernel[5]
  const k6 = kernel[6]
  const r0 = rows[0]
  const r1 = rows[1]
  const r2 = rows[2]
  const r3 = rows[3]
  const r4 = rows[4]
  const r5 = rows[5]
  const r6 = rows[6]
  for (let i = 0; i < stride; i += 1) out[to + i] = 0 + pass[r0 + i] * k0 + pass[r1 + i] * k1 + pass[r2 + i] * k2 + pass[r3 + i] * k3 + pass[r4 + i] * k4 + pass[r5 + i] * k5 + pass[r6 + i] * k6
}

function across9(image: Float32Array, pass: Float32Array, from: number, to: number, step: number, kernel: Float64Array): void {
  const k0 = kernel[0]
  const k1 = kernel[1]
  const k2 = kernel[2]
  const k3 = kernel[3]
  const k4 = kernel[4]
  const k5 = kernel[5]
  const k6 = kernel[6]
  const k7 = kernel[7]
  const k8 = kernel[8]
  for (let i = from; i < to; i += 1) pass[i] = 0 + image[i - 4 * step] * k0 + image[i - 3 * step] * k1 + image[i - 2 * step] * k2 + image[i - 1 * step] * k3 + image[i] * k4 + image[i + 1 * step] * k5 + image[i + 2 * step] * k6 + image[i + 3 * step] * k7 + image[i + 4 * step] * k8
}

function down9(pass: Float32Array, out: Float32Array, to: number, stride: number, rows: Int32Array, kernel: Float64Array): void {
  const k0 = kernel[0]
  const k1 = kernel[1]
  const k2 = kernel[2]
  const k3 = kernel[3]
  const k4 = kernel[4]
  const k5 = kernel[5]
  const k6 = kernel[6]
  const k7 = kernel[7]
  const k8 = kernel[8]
  const r0 = rows[0]
  const r1 = rows[1]
  const r2 = rows[2]
  const r3 = rows[3]
  const r4 = rows[4]
  const r5 = rows[5]
  const r6 = rows[6]
  const r7 = rows[7]
  const r8 = rows[8]
  for (let i = 0; i < stride; i += 1) out[to + i] = 0 + pass[r0 + i] * k0 + pass[r1 + i] * k1 + pass[r2 + i] * k2 + pass[r3 + i] * k3 + pass[r4 + i] * k4 + pass[r5 + i] * k5 + pass[r6 + i] * k6 + pass[r7 + i] * k7 + pass[r8 + i] * k8
}

function across11(image: Float32Array, pass: Float32Array, from: number, to: number, step: number, kernel: Float64Array): void {
  const k0 = kernel[0]
  const k1 = kernel[1]
  const k2 = kernel[2]
  const k3 = kernel[3]
  const k4 = kernel[4]
  const k5 = kernel[5]
  const k6 = kernel[6]
  const k7 = kernel[7]
  const k8 = kernel[8]
  const k9 = kernel[9]
  const k10 = kernel[10]
  for (let i = from; i < to; i += 1) pass[i] = 0 + image[i - 5 * step] * k0 + image[i - 4 * step] * k1 + image[i - 3 * step] * k2 + image[i - 2 * step] * k3 + image[i - 1 * step] * k4 + image[i] * k5 + image[i + 1 * step] * k6 + image[i + 2 * step] * k7 + image[i + 3 * step] * k8 + image[i + 4 * step] * k9 + image[i + 5 * step] * k10
}

function down11(pass: Float32Array, out: Float32Array, to: number, stride: number, rows: Int32Array, kernel: Float64Array): void {
  const k0 = kernel[0]
  const k1 = kernel[1]
  const k2 = kernel[2]
  const k3 = kernel[3]
  const k4 = kernel[4]
  const k5 = kernel[5]
  const k6 = kernel[6]
  const k7 = kernel[7]
  const k8 = kernel[8]
  const k9 = kernel[9]
  const k10 = kernel[10]
  const r0 = rows[0]
  const r1 = rows[1]
  const r2 = rows[2]
  const r3 = rows[3]
  const r4 = rows[4]
  const r5 = rows[5]
  const r6 = rows[6]
  const r7 = rows[7]
  const r8 = rows[8]
  const r9 = rows[9]
  const r10 = rows[10]
  for (let i = 0; i < stride; i += 1) out[to + i] = 0 + pass[r0 + i] * k0 + pass[r1 + i] * k1 + pass[r2 + i] * k2 + pass[r3 + i] * k3 + pass[r4 + i] * k4 + pass[r5 + i] * k5 + pass[r6 + i] * k6 + pass[r7 + i] * k7 + pass[r8 + i] * k8 + pass[r9 + i] * k9 + pass[r10 + i] * k10
}

function across13(image: Float32Array, pass: Float32Array, from: number, to: number, step: number, kernel: Float64Array): void {
  const k0 = kernel[0]
  const k1 = kernel[1]
  const k2 = kernel[2]
  const k3 = kernel[3]
  const k4 = kernel[4]
  const k5 = kernel[5]
  const k6 = kernel[6]
  const k7 = kernel[7]
  const k8 = kernel[8]
  const k9 = kernel[9]
  const k10 = kernel[10]
  const k11 = kernel[11]
  const k12 = kernel[12]
  for (let i = from; i < to; i += 1) pass[i] = 0 + image[i - 6 * step] * k0 + image[i - 5 * step] * k1 + image[i - 4 * step] * k2 + image[i - 3 * step] * k3 + image[i - 2 * step] * k4 + image[i - 1 * step] * k5 + image[i] * k6 + image[i + 1 * step] * k7 + image[i + 2 * step] * k8 + image[i + 3 * step] * k9 + image[i + 4 * step] * k10 + image[i + 5 * step] * k11 + image[i + 6 * step] * k12
}

function down13(pass: Float32Array, out: Float32Array, to: number, stride: number, rows: Int32Array, kernel: Float64Array): void {
  const k0 = kernel[0]
  const k1 = kernel[1]
  const k2 = kernel[2]
  const k3 = kernel[3]
  const k4 = kernel[4]
  const k5 = kernel[5]
  const k6 = kernel[6]
  const k7 = kernel[7]
  const k8 = kernel[8]
  const k9 = kernel[9]
  const k10 = kernel[10]
  const k11 = kernel[11]
  const k12 = kernel[12]
  const r0 = rows[0]
  const r1 = rows[1]
  const r2 = rows[2]
  const r3 = rows[3]
  const r4 = rows[4]
  const r5 = rows[5]
  const r6 = rows[6]
  const r7 = rows[7]
  const r8 = rows[8]
  const r9 = rows[9]
  const r10 = rows[10]
  const r11 = rows[11]
  const r12 = rows[12]
  for (let i = 0; i < stride; i += 1) out[to + i] = 0 + pass[r0 + i] * k0 + pass[r1 + i] * k1 + pass[r2 + i] * k2 + pass[r3 + i] * k3 + pass[r4 + i] * k4 + pass[r5 + i] * k5 + pass[r6 + i] * k6 + pass[r7 + i] * k7 + pass[r8 + i] * k8 + pass[r9 + i] * k9 + pass[r10 + i] * k10 + pass[r11 + i] * k11 + pass[r12 + i] * k12
}

function across17(image: Float32Array, pass: Float32Array, from: number, to: number, step: number, kernel: Float64Array): void {
  const k0 = kernel[0]
  const k1 = kernel[1]
  const k2 = kernel[2]
  const k3 = kernel[3]
  const k4 = kernel[4]
  const k5 = kernel[5]
  const k6 = kernel[6]
  const k7 = kernel[7]
  const k8 = kernel[8]
  const k9 = kernel[9]
  const k10 = kernel[10]
  const k11 = kernel[11]
  const k12 = kernel[12]
  const k13 = kernel[13]
  const k14 = kernel[14]
  const k15 = kernel[15]
  const k16 = kernel[16]
  for (let i = from; i < to; i += 1) pass[i] = 0 + image[i - 8 * step] * k0 + image[i - 7 * step] * k1 + image[i - 6 * step] * k2 + image[i - 5 * step] * k3 + image[i - 4 * step] * k4 + image[i - 3 * step] * k5 + image[i - 2 * step] * k6 + image[i - 1 * step] * k7 + image[i] * k8 + image[i + 1 * step] * k9 + image[i + 2 * step] * k10 + image[i + 3 * step] * k11 + image[i + 4 * step] * k12 + image[i + 5 * step] * k13 + image[i + 6 * step] * k14 + image[i + 7 * step] * k15 + image[i + 8 * step] * k16
}

function down17(pass: Float32Array, out: Float32Array, to: number, stride: number, rows: Int32Array, kernel: Float64Array): void {
  const k0 = kernel[0]
  const k1 = kernel[1]
  const k2 = kernel[2]
  const k3 = kernel[3]
  const k4 = kernel[4]
  const k5 = kernel[5]
  const k6 = kernel[6]
  const k7 = kernel[7]
  const k8 = kernel[8]
  const k9 = kernel[9]
  const k10 = kernel[10]
  const k11 = kernel[11]
  const k12 = kernel[12]
  const k13 = kernel[13]
  const k14 = kernel[14]
  const k15 = kernel[15]
  const k16 = kernel[16]
  const r0 = rows[0]
  const r1 = rows[1]
  const r2 = rows[2]
  const r3 = rows[3]
  const r4 = rows[4]
  const r5 = rows[5]
  const r6 = rows[6]
  const r7 = rows[7]
  const r8 = rows[8]
  const r9 = rows[9]
  const r10 = rows[10]
  const r11 = rows[11]
  const r12 = rows[12]
  const r13 = rows[13]
  const r14 = rows[14]
  const r15 = rows[15]
  const r16 = rows[16]
  for (let i = 0; i < stride; i += 1) out[to + i] = 0 + pass[r0 + i] * k0 + pass[r1 + i] * k1 + pass[r2 + i] * k2 + pass[r3 + i] * k3 + pass[r4 + i] * k4 + pass[r5 + i] * k5 + pass[r6 + i] * k6 + pass[r7 + i] * k7 + pass[r8 + i] * k8 + pass[r9 + i] * k9 + pass[r10 + i] * k10 + pass[r11 + i] * k11 + pass[r12 + i] * k12 + pass[r13 + i] * k13 + pass[r14 + i] * k14 + pass[r15 + i] * k15 + pass[r16 + i] * k16
}

/** The rectangle `placement` of a document picture, resampled to w × h (RGB, bilinear). */
export function resampleRgb(
  picture: Anime25DSourceReference,
  placement: { x: number; y: number; width: number; height: number },
  w: number,
  h: number,
): Float32Array {
  const out = new Float32Array(w * h * 3)
  const sx = placement.width / w
  const sy = placement.height / h
  const { data, width, height } = picture
  // Each column's two source columns and its weight between them.
  const left = new Int32Array(w)
  const right = new Int32Array(w)
  const across = new Float64Array(w)
  for (let x = 0; x < w; x += 1) {
    const dx = placement.x + (x + 0.5) * sx - 0.5
    const x0 = Math.max(0, Math.min(width - 1, Math.floor(dx)))
    left[x] = x0 * 4
    right[x] = Math.min(width - 1, x0 + 1) * 4
    across[x] = Math.max(0, Math.min(1, dx - x0))
  }
  let o = 0
  for (let y = 0; y < h; y += 1) {
    const dy = placement.y + (y + 0.5) * sy - 0.5
    const y0 = Math.max(0, Math.min(height - 1, Math.floor(dy)))
    const y1 = Math.min(height - 1, y0 + 1)
    const fy = Math.max(0, Math.min(1, dy - y0))
    const gy = 1 - fy
    const upper = y0 * width * 4
    const lower = y1 * width * 4
    for (let x = 0; x < w; x += 1) {
      const fx = across[x]
      const gx = 1 - fx
      const a = left[x]
      const b = right[x]
      for (let c = 0; c < 3; c += 1) {
        const top = data[upper + a + c] * gx + data[upper + b + c] * fx
        const bottom = data[lower + a + c] * gx + data[lower + b + c] * fx
        out[o++] = top * gy + bottom * fy
      }
    }
  }
  return out
}
