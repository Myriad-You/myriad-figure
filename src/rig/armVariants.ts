import type { Anime25DArmLift } from '../anime25drig/types'
import type { Anime25DSourceReference, EyeSide, RasterLayer } from './anime25dImportTypes'
import type { PsdSkeleton } from './skeleton'
import { trimRaster, uniquePartId } from './anime25dRaster'
import { measureArmModel, placeArmModel } from './armModel'
import { components } from './armRaster'

/**
 * Gesture arms drawn by an image model: the portrait with one arm changed
 * (waving, a finger raised, a hand on the chest, a chin in the hand). Each
 * one becomes a single hidden layer holding the changed arm and what the
 * portrait's own arm leaves bare once hidden, drawn above everything; the
 * runtime raises it in from below the picture over that arm. With the pose
 * model's joints on both pictures the arm is also measured as a 3D arm
 * (armModel), which the layer then only textures.
 */
export const ARM_VARIANT_GESTURES = ['wave', 'point', 'chest', 'chin'] as const
export type ArmVariantGesture = (typeof ARM_VARIANT_GESTURES)[number]

/** A raised hand moves whole; an arm across the body stays on its shoulder. */
export const ARM_VARIANT_LIFT = {
  wave: 'whole',
  point: 'whole',
  chest: 'shoulder',
  chin: 'shoulder',
} as const satisfies Record<ArmVariantGesture, Anime25DArmLift>

export function isArmVariantGesture(value: unknown): value is ArmVariantGesture {
  return typeof value === 'string' && (ARM_VARIANT_GESTURES as readonly string[]).includes(value)
}

export interface ArmVariantReference extends Anime25DSourceReference {
  gesture: ArmVariantGesture
  /** The arm the variant changed, on the picture (handwear's sides). */
  side: EyeSide
  /** The portrait's rectangle on the document: the cut works at the portrait's own scale. */
  placement: { x: number; y: number; width: number; height: number }
  /** Points on the changed hand, in document pixels; without them the largest change is the arm. */
  hand?: ReadonlyArray<readonly [number, number]>
  /** The pose model's joints on the variant (COCO-WholeBody `[x, y, score]`), in document pixels. */
  keypoints?: ReadonlyArray<readonly [number, number, number]>
}

// The cut works on the portrait resampled to this width, the size it was
// tuned at (the 2026-11-03 trial, 26 variants on 8 busts).
const WORK_WIDTH = 1152
// Channel distance after a light blur of both pictures: shading the model
// redrew stays out, a moved sleeve comes through.
const DIFF_BLUR = 1.5
const DIFF_LIMIT = 28
const OPEN_SIZE = 3
const CLOSE_SIZE = 15
const ARM_FEATHER = 1
// The portrait's own arm, once hidden, leaves its shoulder and upper arm
// bare where the variant drew them the same: that region is filled from the
// variant too, in the same layer, or the two would part when the body sways.
const VACATED_ALPHA = 8
const VACATED_REACH = 3
const VACATED_FEATHER = 0.8
// The generated pictures stand on an even light ground.
const BACKGROUND_TOLERANCE = 17
// Where the portrait's arm layer is drawn, as the 3D arm measures it.
const BASE_ALPHA = 128

export function cutArmVariantLayers(
  layers: readonly RasterLayer[],
  neutral: Anime25DSourceReference | undefined,
  references: readonly ArmVariantReference[],
  skeleton?: PsdSkeleton,
): RasterLayer[] {
  if (!neutral || references.length === 0) return []
  const usedIds = new Set(layers.map((layer) => layer.id))
  const cut: RasterLayer[] = []
  const done = new Set<string>()
  for (const reference of references) {
    const key = `${reference.gesture}-${reference.side}`
    if (done.has(key)) continue
    if (reference.width !== neutral.width || reference.height !== neutral.height) continue
    const base = layers.filter((layer) => layer.role === 'handwear' && layer.side === reference.side)
    const layer = cutArmVariant(neutral, reference, base, skeleton)
    if (!layer) continue
    done.add(key)
    const id = uniquePartId(`arm-variant-${key}`, usedIds)
    cut.push({ ...layer, id, sourceName: id })
  }
  return cut
}

function cutArmVariant(
  neutral: Anime25DSourceReference,
  reference: ArmVariantReference,
  base: readonly RasterLayer[],
  skeleton: PsdSkeleton | undefined,
): RasterLayer | null {
  const { placement } = reference
  if (placement.width <= 0 || placement.height <= 0) return null
  const scale = placement.width / WORK_WIDTH
  const w = WORK_WIDTH
  const h = Math.max(1, Math.round(placement.height / scale))
  const variant = resample(reference, placement, w, h)
  const portrait = resample(neutral, placement, w, h)

  const changed = new Uint8Array(w * h)
  const difference = new Float32Array(w * h)
  {
    const a = blurChannels(variant, w, h, DIFF_BLUR)
    const b = blurChannels(portrait, w, h, DIFF_BLUR)
    for (let p = 0; p < w * h; p += 1) {
      const dr = a[p * 3] - b[p * 3]
      const dg = a[p * 3 + 1] - b[p * 3 + 1]
      const db = a[p * 3 + 2] - b[p * 3 + 2]
      difference[p] = Math.sqrt(dr * dr + dg * dg + db * db)
      changed[p] = difference[p] > DIFF_LIMIT ? 1 : 0
    }
  }
  const opened = open(changed, w, h, OPEN_SIZE)
  const mask = close(opened, w, h, CLOSE_SIZE)
  const { labels, sizes } = components(mask, w, h)
  const keep = new Set<number>()
  for (const [x, y] of reference.hand ?? []) {
    const px = Math.floor((x - placement.x) / scale)
    const py = Math.floor((y - placement.y) / scale)
    if (px < 0 || py < 0 || px >= w || py >= h) continue
    const label = labels[py * w + px]
    if (label) keep.add(label)
  }
  if (!reference.hand?.length) {
    let largest = 0
    for (let label = 1; label < sizes.length; label += 1) { if (sizes[label] > (sizes[largest] ?? 0)) largest = label
}
    if (largest) keep.add(largest)
  }
  if (keep.size === 0) return null
  const arm = new Uint8Array(w * h)
  for (let p = 0; p < w * h; p += 1) arm[p] = keep.has(labels[p]) ? 1 : 0
  fillHoles(arm, w, h)

  const background = groundOf(variant, portrait, w, h)
  const notGround = new Float32Array(w * h)
  for (let p = 0; p < w * h; p += 1) notGround[p] = background[p] ? 0 : 1
  const armAlpha = blur(toFloat(arm), w, h, ARM_FEATHER)
  const keepOff = blur(notGround, w, h, VACATED_FEATHER)
  for (let p = 0; p < w * h; p += 1) armAlpha[p] *= keepOff[p]

  // What the portrait's arm covered, less the ground, and not already in the cut.
  const covered = new Uint8Array(w * h)
  for (const layer of base) stampAlpha(covered, layer, placement, scale, w, h, VACATED_ALPHA)
  const vacated = dilate(covered, w, h, VACATED_REACH * 2 + 1)
  for (let p = 0; p < w * h; p += 1) { if (background[p]) vacated[p] = 0
}
  const filled = open(vacated, w, h, OPEN_SIZE)
  const stay = new Uint8Array(w * h)
  for (let p = 0; p < w * h; p += 1) stay[p] = filled[p] && armAlpha[p] < 0.5 ? 1 : 0
  const stayAlpha = blur(toFloat(open(stay, w, h, OPEN_SIZE)), w, h, VACATED_FEATHER)
  const alpha = new Float32Array(w * h)
  for (let p = 0; p < w * h; p += 1) alpha[p] = Math.max(armAlpha[p], stayAlpha[p])

  // Back on the document, at its resolution, in the variant's own pixels.
  const left = Math.max(0, Math.floor(placement.x))
  const top = Math.max(0, Math.floor(placement.y))
  const right = Math.min(reference.width, Math.ceil(placement.x + placement.width))
  const bottom = Math.min(reference.height, Math.ceil(placement.y + placement.height))
  const width = right - left
  const height = bottom - top
  if (width <= 0 || height <= 0) return null
  const data = new Uint8ClampedArray(width * height * 4)
  let any = false
  for (let y = 0; y < height; y += 1) {
    const wy = (top + y + 0.5 - placement.y) / scale - 0.5
    for (let x = 0; x < width; x += 1) {
      const wx = (left + x + 0.5 - placement.x) / scale - 0.5
      const a = sample(alpha, w, h, wx, wy)
      if (a <= 0.004) continue
      const source = ((top + y) * reference.width + left + x) * 4
      const target = (y * width + x) * 4
      data[target] = reference.data[source]
      data[target + 1] = reference.data[source + 1]
      data[target + 2] = reference.data[source + 2]
      data[target + 3] = Math.round(a * reference.data[source + 3])
      any = true
    }
  }
  if (!any) return null
  const model = skeleton && reference.keypoints?.length
    ? measureArmModel({
        width: w,
        height: h,
        side: reference.side,
        portrait,
        variant,
        changed: Uint8Array.from(opened, (moved, p) => (moved && !background[p] ? 1 : 0)),
        difference,
        ground: background,
        base: (() => {
          const drawn = new Uint8Array(w * h)
          for (const layer of base) stampAlpha(drawn, layer, placement, scale, w, h, BASE_ALPHA)
          return drawn
        })(),
        portraitPose: onGrid(skeleton.keypoints, placement, scale),
        variantPose: onGrid(reference.keypoints, placement, scale),
      })
    : null
  const layer = trimRaster({
    id: '',
    role: 'arm-variant',
    sourceName: '',
    order: 0,
    side: reference.side,
    group: 'body',
    left,
    top,
    width,
    height,
    data,
    armVariant: { gesture: reference.gesture, lift: ARM_VARIANT_LIFT[reference.gesture] },
  })
  if (model && layer.armVariant) {
    layer.armVariant.model = placeArmModel(model, scale, placement.x - layer.left, placement.y - layer.top)
  }
  return layer
}

/** Document keypoints on the working grid. */
function onGrid(
  keypoints: ReadonlyArray<readonly [number, number, number]>,
  placement: ArmVariantReference['placement'],
  scale: number,
): Array<[number, number, number]> {
  return keypoints.map(([x, y, score]) => [(x - placement.x) / scale, (y - placement.y) / scale, score])
}

/** The portrait's rectangle of a document picture, resampled to w × h (RGB). */
function resample(
  picture: Anime25DSourceReference,
  placement: ArmVariantReference['placement'],
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

/** Marks where a document layer is drawn (alpha above `least`) on the working grid. */
function stampAlpha(
  out: Uint8Array,
  layer: RasterLayer,
  placement: ArmVariantReference['placement'],
  scale: number,
  w: number,
  h: number,
  least: number,
): void {
  for (let y = 0; y < h; y += 1) {
    const ly = Math.floor(placement.y + (y + 0.5) * scale) - layer.top
    if (ly < 0 || ly >= layer.height) continue
    for (let x = 0; x < w; x += 1) {
      const lx = Math.floor(placement.x + (x + 0.5) * scale) - layer.left
      if (lx < 0 || lx >= layer.width) continue
      if (layer.data[(ly * layer.width + lx) * 4 + 3] > least) out[y * w + x] = 1
    }
  }
}

/** Ground: pixels of the portrait's border colour, in either picture, connected to the border. */
function groundOf(variant: Float32Array, portrait: Float32Array, w: number, h: number): Uint8Array {
  const border: number[][] = [[], [], []]
  const take = (p: number) => {
    for (let c = 0; c < 3; c += 1) border[c].push(portrait[p * 3 + c])
  }
  for (let x = 0; x < w; x += 4) {
    take(x)
    take((h - 1) * w + x)
  }
  for (let y = 0; y < h; y += 4) {
    take(y * w)
    take(y * w + w - 1)
  }
  const ground = border.map((values) => values.sort((a, b) => a - b)[values.length >> 1])
  const like = new Uint8Array(w * h)
  for (let p = 0; p < w * h; p += 1) {
    let far = 0
    for (let c = 0; c < 3; c += 1) far = Math.max(far, Math.abs(variant[p * 3 + c] - ground[c]))
    like[p] = far <= BACKGROUND_TOLERANCE ? 1 : 0
  }
  const { labels } = components(like, w, h)
  const touching = new Set<number>()
  for (let x = 0; x < w; x += 1) {
    touching.add(labels[x])
    touching.add(labels[(h - 1) * w + x])
  }
  for (let y = 0; y < h; y += 1) {
    touching.add(labels[y * w])
    touching.add(labels[y * w + w - 1])
  }
  touching.delete(0)
  const out = new Uint8Array(w * h)
  for (let p = 0; p < w * h; p += 1) out[p] = touching.has(labels[p]) ? 1 : 0
  return out
}

/** Closes what the mask encloses: everything the top corners cannot reach (4-connected) is arm. */
function fillHoles(mask: Uint8Array, w: number, h: number): void {
  const outside = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  let top = 0
  for (const start of [0, w - 1]) {
    if (mask[start] || outside[start]) continue
    outside[start] = 1
    stack[top++] = start
  }
  while (top > 0) {
    const p = stack[--top]
    const x = p % w
    for (const n of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
      if (n < 0 || n >= w * h || mask[n] || outside[n]) continue
      outside[n] = 1
      stack[top++] = n
    }
  }
  for (let p = 0; p < w * h; p += 1) { if (!outside[p]) mask[p] = 1
}
}

/** Square min or max filter of odd `size`, separable. */
function morph(mask: Uint8Array, w: number, h: number, size: number, grow: boolean): Uint8Array {
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

const dilate = (mask: Uint8Array, w: number, h: number, size: number) => morph(mask, w, h, size, true)
const erode = (mask: Uint8Array, w: number, h: number, size: number) => morph(mask, w, h, size, false)
const open = (mask: Uint8Array, w: number, h: number, size: number) => dilate(erode(mask, w, h, size), w, h, size)
const close = (mask: Uint8Array, w: number, h: number, size: number) => erode(dilate(mask, w, h, size), w, h, size)

function toFloat(mask: Uint8Array): Float32Array {
  return Float32Array.from(mask)
}

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

/** Separable Gaussian of a single-channel image, edges clamped. */
function blur(image: Float32Array, w: number, h: number, sigma: number): Float32Array {
  return blurStride(image, w, h, sigma, 1)
}

function blurChannels(image: Float32Array, w: number, h: number, sigma: number): Float32Array {
  return blurStride(image, w, h, sigma, 3)
}

function blurStride(image: Float32Array, w: number, h: number, sigma: number, channels: number): Float32Array {
  const kernel = gaussianKernel(sigma)
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

/** Bilinear sample of a single-channel image, zero outside. */
function sample(image: Float32Array, w: number, h: number, x: number, y: number): number {
  if (x < -0.5 || y < -0.5 || x > w - 0.5 || y > h - 0.5) return 0
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(x)))
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(y)))
  const x1 = Math.min(w - 1, x0 + 1)
  const y1 = Math.min(h - 1, y0 + 1)
  const fx = Math.max(0, Math.min(1, x - x0))
  const fy = Math.max(0, Math.min(1, y - y0))
  const top = image[y0 * w + x0] * (1 - fx) + image[y0 * w + x1] * fx
  const bottom = image[y1 * w + x0] * (1 - fx) + image[y1 * w + x1] * fx
  return top * (1 - fy) + bottom * fy
}
