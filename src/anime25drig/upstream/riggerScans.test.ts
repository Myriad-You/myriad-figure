import assert from 'node:assert/strict'
import test from 'node:test'
import { bboxOf, cleanAlpha, dilate, labelComponents, splitSides } from './rigger'

// The loops of the port as it stood before these four were made faster (origin/main d4901bb), word for word: the
// definition. The ones in rigger.ts work only where anything can come of it and must give the same bytes, in the
// same array where the old ones wrote in place. `labelComponents` is the port's own, unchanged.

interface Bounds {
  x0: number
  y0: number
  x1: number
  y1: number
}

function plainBboxOf(
  alpha: Uint8Array,
  width: number,
  height: number,
  threshold: number,
): Bounds | null {
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y += 1) {
    const offset = y * width
    for (let x = 0; x < width; x += 1) {
      if (alpha[offset + x] <= threshold) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 }
}

function plainDilate(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  const temporary = new Uint8Array(width * height)
  const output = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    const offset = y * width
    for (let x = 0; x < width; x += 1) {
      let value = 0
      for (let k = -radius; k <= radius; k += 1) {
        const candidateX = x + k
        if (
          candidateX >= 0 &&
          candidateX < width &&
          mask[offset + candidateX]
        ) {
          value = 1
          break
        }
      }
      temporary[offset + x] = value
    }
  }
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      let value = 0
      for (let k = -radius; k <= radius; k += 1) {
        const candidateY = y + k
        if (
          candidateY >= 0 &&
          candidateY < height &&
          temporary[candidateY * width + x]
        ) {
          value = 1
          break
        }
      }
      output[y * width + x] = value
    }
  }
  return output
}

function plainCleanAlpha(
  alpha: Uint8Array,
  width: number,
  height: number,
  minPixels: number,
): Uint8Array {
  const components = labelComponents(alpha, width, height, 16)
  if (!components.count) return alpha
  const keptComponents = new Uint8Array(components.count + 1)
  let any = false
  for (let index = 1; index <= components.count; index += 1) {
    if (components.sizes[index] >= minPixels) {
      keptComponents[index] = 1
      any = true
    }
  }
  if (!any) return alpha
  let mask: Uint8Array = new Uint8Array(width * height)
  for (let index = 0; index < width * height; index += 1) {
    if (keptComponents[components.lab[index]]) mask[index] = 1
  }
  mask = plainDilate(mask, width, height, 3)
  for (let index = 0; index < width * height; index += 1) {
    if (!mask[index]) alpha[index] = 0
  }
  return alpha
}

function plainSplitSides(
  alpha: Uint8Array,
  width: number,
  height: number,
  faceCenterX: number,
): { l?: Uint8Array; r?: Uint8Array } {
  const components = labelComponents(alpha, width, height, 16)
  const sides = new Uint8Array(components.count + 1)
  for (let component = 1; component <= components.count; component += 1) {
    if (components.sizes[component] < 20) continue
    sides[component] =
      components.sumX[component] / components.sizes[component] < faceCenterX
        ? 1
        : 2
  }
  const left = new Uint8Array(width * height)
  const right = new Uint8Array(width * height)
  for (let index = 0; index < width * height; index += 1) {
    if (sides[components.lab[index]] === 1) left[index] = 1
    else if (sides[components.lab[index]] === 2) right[index] = 1
  }
  const result: { l?: Uint8Array; r?: Uint8Array } = {}
  let leftCount = 0
  let rightCount = 0
  for (let index = 0; index < width * height; index += 1) {
    leftCount += left[index]
    rightCount += right[index]
  }
  if (leftCount) result.l = plainDilate(left, width, height, 3)
  if (rightCount) result.r = plainDilate(right, width, height, 3)
  return result
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

// One pixel, a row, a column, squares, and sizes whose rows do not start on a word.
const SIZES: ReadonlyArray<readonly [number, number]> = [[1, 1], [1, 2], [2, 1], [1, 13], [13, 1], [3, 3], [4, 4], [5, 7], [8, 8], [9, 5], [16, 3], [17, 11], [31, 29], [40, 20]]
// Around the thresholds asked of the port (0, 8, 16) and the dust floor.
const VALUES = [0, 1, 8, 9, 16, 17, 40, 128, 255]
const KINDS = ['empty', 'full', 'one pixel', 'sparse', 'half', 'dense', 'corner blobs', 'far corner blobs', 'blobs', 'frame'] as const

/** An alpha (or, `binary`, a mask of ones) of each kind a layer comes as. */
function picture(random: () => number, w: number, h: number, kind: typeof KINDS[number], binary: boolean): Uint8Array {
  const int = (n: number) => Math.floor(random() * n)
  const value = () => (binary ? 1 : VALUES[int(VALUES.length)]!)
  const a = new Uint8Array(w * h)
  const scatter = (share: number) => {
    for (let i = 0; i < a.length; i += 1) {
      if (random() < share) a[i] = value()
    }
  }
  switch (kind) {
    case 'empty': return a
    case 'full': return a.fill(binary ? 1 : 255)
    case 'one pixel':
      a[int(w * h)] = binary ? 1 : 17 + int(239)
      return a
    case 'sparse':
      scatter(0.03)
      return a
    case 'half':
      scatter(0.5)
      return a
    case 'dense':
      scatter(0.95)
      return a
    case 'frame':
      // Set along every edge of the canvas, empty inside.
      for (let x = 0; x < w; x += 1) a[x] = a[(h - 1) * w + x] = binary ? 1 : 255
      for (let y = 0; y < h; y += 1) a[y * w] = a[y * w + w - 1] = binary ? 1 : 255
      return a
    default: {
      for (let blob = 1 + int(4); blob > 0; blob -= 1) {
        const bw = 1 + int(w)
        const bh = 1 + int(h)
        const bx = kind === 'corner blobs' ? 0 : kind === 'far corner blobs' ? w - bw : int(w)
        const by = kind === 'corner blobs' ? 0 : kind === 'far corner blobs' ? h - bh : int(h)
        for (let y = by; y < Math.min(h, by + bh); y += 1) {
          for (let x = bx; x < Math.min(w, bx + bw); x += 1) {
            if (random() < 0.9) a[y * w + x] = value()
          }
        }
      }
      // Dust about them.
      scatter(0.01)
      return a
    }
  }
}

/** The same bytes as a view that does not start on a word of its buffer (`shift` 1 to 3 bytes in). */
function unaligned(bytes: Uint8Array, shift: number): Uint8Array {
  const view = new Uint8Array(bytes.length + 8).subarray(shift, shift + bytes.length)
  view.set(bytes)
  assert.equal(view.byteOffset % 4, shift)
  return view
}

/** Every size and kind of picture, a few of each, as the bytes themselves and as each unaligned view of them. */
function everyPicture(seed: number, binary: boolean, check: (a: Uint8Array, w: number, h: number, what: string) => void): void {
  const random = seeded(seed)
  for (const [w, h] of SIZES) {
    for (const kind of KINDS) {
      for (let round = 0; round < 6; round += 1) {
        const a = picture(random, w, h, kind, binary)
        check(a, w, h, `${w}x${h} ${kind} [${a.join(' ')}]`)
        const shift = 1 + (round % 3)
        check(unaligned(a, shift), w, h, `${w}x${h} ${kind}, ${shift} off a word [${a.join(' ')}]`)
      }
    }
  }
}

test('the box of what is over a threshold is the one found by looking at every pixel', () => {
  everyPicture(101, false, (a, w, h, what) => {
    for (const threshold of [0, 8, 16, 254, 255]) {
      assert.deepEqual(bboxOf(a, w, h, threshold), plainBboxOf(a, w, h, threshold), `over ${threshold}: ${what}`)
    }
  })
})

test('a mask grown by counting is the mask grown by looking, a reach wider than the canvas included', () => {
  for (const binary of [true, false]) {
    everyPicture(binary ? 103 : 107, binary, (m, w, h, what) => {
      for (const radius of [0, 1, 3, 5, 12, 64]) {
        assert.deepEqual(dilate(m, w, h, radius), plainDilate(m, w, h, radius), `radius ${radius}: ${what}`)
      }
    })
  }
})

test('specks are dropped from an alpha as on the whole canvas, in place, and an alpha left alone is the same array', () => {
  everyPicture(109, false, (a, w, h, what) => {
    for (const minPixels of [1, 2, 5, 40]) {
      const fast = Uint8Array.from(a)
      const plain = Uint8Array.from(a)
      const fastResult = cleanAlpha(fast, w, h, minPixels)
      const plainResult = plainCleanAlpha(plain, w, h, minPixels)
      assert.deepEqual(fast, plain, `specks under ${minPixels}: ${what}`)
      assert.equal(fastResult, fast)
      assert.equal(plainResult, plain)
    }
  })
  // On a view off a word too: it is written through the view.
  const random = seeded(113)
  for (const [w, h] of SIZES) {
    const a = picture(random, w, h, 'blobs', false)
    const fast = unaligned(a, 3)
    const plain = Uint8Array.from(a)
    cleanAlpha(fast, w, h, 2)
    plainCleanAlpha(plain, w, h, 2)
    assert.deepEqual(Uint8Array.from(fast), plain, `${w}x${h} off a word`)
  }
})

test('a layer is split to the two sides of the face as on the whole canvas', () => {
  everyPicture(127, false, (a, w, h, what) => {
    for (const faceCenterX of [0, w / 2, w / 2 - 0.5, w, (w >> 1) + 0.25, w >> 1, -3, w + 3]) {
      const fast = splitSides(a, w, h, faceCenterX)
      const plain = plainSplitSides(a, w, h, faceCenterX)
      assert.deepEqual(Object.keys(fast), Object.keys(plain), `sides about ${faceCenterX}: ${what}`)
      assert.deepEqual(fast, plain, `about ${faceCenterX}: ${what}`)
    }
  })
})
