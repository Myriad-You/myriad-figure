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
// The trial's busts were drawn this wide: the player gives the arm's drawn sizes in its pixels.
const TRIAL_WIDTH = 540
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

// A full body's arm is cut and measured on a grid where its hand is as large as
// a bust's was on the 1152-wide one, wrist to middle knuckle (the median of the
// trial's 26 raised hands): the cut's sizes and the model's measures hold there.
const BUST_HAND = 214
// Room about the arm on a full body's grid: by the shoulders' width either side, by the arm's length below.
const FIGURE_SIDE_ROOM = 0.3
const FIGURE_FOOT_ROOM = 0.12
// A full body's crown above its nose, by the nose's height above the shoulders.
const FIGURE_CROWN_ROOM = 1.6
// A pose point the model is at least this sure of (as the backend takes a hand's).
const MIN_POINT_SCORE = 0.3

export function cutArmVariantLayers(
  layers: readonly RasterLayer[],
  neutral: Anime25DSourceReference | undefined,
  references: readonly ArmVariantReference[],
  skeleton?: PsdSkeleton,
  figure = false,
): RasterLayer[] {
  if (!neutral || references.length === 0) return []
  const usedIds = new Set(layers.map((layer) => layer.id))
  const cut: Array<{ layer: RasterLayer; cuffAtWrist: boolean | null }> = []
  const hands: RasterLayer[] = []
  const done = new Set<string>()
  for (const reference of references) {
    const key = `${reference.gesture}-${reference.side}`
    if (done.has(key)) continue
    if (reference.width !== neutral.width || reference.height !== neutral.height) continue
    const base = layers.filter((layer) => layer.role === 'handwear' && layer.side === reference.side)
    const got = cutArmVariant(neutral, reference, base, skeleton, figure)
    if (!got) continue
    done.add(key)
    const id = uniquePartId(`arm-variant-${key}`, usedIds)
    cut.push({ layer: { ...got.layer, id, sourceName: id }, cuffAtWrist: got.cuffAtWrist })
    if (got.hand) {
      const handId = `arm-variant-hand-${id.slice('arm-variant-'.length)}`
      usedIds.add(handId)
      hands.push({ ...got.hand, id: handId, sourceName: handId })
    }
  }
  dropMovedCuffs(cut)
  // A hand whose arm lost its model is never modelled: its picture goes with it.
  const modelled = new Set(cut.filter((c) => c.layer.armVariant?.model).map((c) => c.layer.id.slice('arm-variant-'.length)))
  return [...cut.map((c) => c.layer), ...hands.filter((h) => modelled.has(h.id.slice('arm-variant-hand-'.length)))]
}

function cutArmVariant(
  neutral: Anime25DSourceReference,
  reference: ArmVariantReference,
  base: readonly RasterLayer[],
  skeleton: PsdSkeleton | undefined,
  figure: boolean,
): { layer: RasterLayer; cuffAtWrist: boolean | null; hand?: RasterLayer } | null {
  const window = figure ? figureWindow(reference, skeleton) : null
  const placement = window?.frame ?? reference.placement
  if (placement.width <= 0 || placement.height <= 0) return null
  const scale = window?.scale ?? placement.width / WORK_WIDTH
  const w = window ? Math.max(1, Math.round(placement.width / scale)) : WORK_WIDTH
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
        ...(window ? { whole: true } : {}),
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
  if (!model || !layer.armVariant) return { layer, cuffAtWrist: null }
  const { cuffAtWrist, ...measured } = model
  layer.armVariant.model = placeArmModel(measured, scale, placement.x - layer.left, placement.y - layer.top)
  if (window) layer.armVariant.model.trialPixel = scale * WORK_WIDTH / TRIAL_WIDTH
  const placed = layer.armVariant.model.hand.map(([x, y]) => [x + layer.left, y + layer.top] as const)
  // The drawing's own empty ground is no part of it: held, a modelled finger a little wider than the drawn one
  // wore the canvas's white about its tip.
  const drawnOn = (x: number, y: number) => sample(keepOff, w, h, (x + 0.5 - placement.x) / scale - 0.5, (y + 0.5 - placement.y) / scale - 0.5)
  return { layer, cuffAtWrist, hand: handPicture(reference, placed, drawnOn) ?? undefined }
}

/**
 * The drawn hand (about its measured joints, `points`, on the document) and what lies about it, whole: the cut keeps
 * only what differs from the portrait, so a hand laid on bare skin lost its pale lines there. Never shown; the
 * modelled hand wears it held as drawn. See-through where the drawing has only its ground (`drawnOn`, 0–1).
 */
function handPicture(
  reference: ArmVariantReference,
  points: ReadonlyArray<readonly [number, number]>,
  drawnOn: (x: number, y: number) => number,
): RasterLayer | null {
  if (points.length < 2) return null
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const pad = 0.4 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + 8
  const left = Math.max(0, Math.floor(Math.min(...xs) - pad))
  const top = Math.max(0, Math.floor(Math.min(...ys) - pad))
  const right = Math.min(reference.width, Math.ceil(Math.max(...xs) + pad))
  const bottom = Math.min(reference.height, Math.ceil(Math.max(...ys) + pad))
  const width = right - left
  const height = bottom - top
  if (width <= 0 || height <= 0) return null
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const from = ((top + y) * reference.width + left) * 4
    data.set(reference.data.subarray(from, from + width * 4), y * width * 4)
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4 + 3
      data[i] = Math.round(data[i] * Math.min(1, Math.max(0, drawnOn(left + x, top + y))))
    }
  }
  return { id: '', role: 'arm-variant-hand', sourceName: '', order: 0, side: reference.side, group: 'body', left, top, width, height, data }
}

/**
 * A picture that moved the portrait's cuff to the wrist where most of the same arm's pictures keep it by the
 * elbow is the generator's mistake: modelled, its sleeve wore the band twice. It keeps no model and is raised
 * flat as drawn. All of them drawing it at the wrist is how they read a portrait that does not show the forearm.
 */
export function dropMovedCuffs(cut: ReadonlyArray<{ layer: RasterLayer; cuffAtWrist: boolean | null }>): void {
  for (const side of new Set(cut.map((c) => c.layer.side))) {
    const mine = cut.filter((c) => c.layer.side === side && c.layer.armVariant?.model)
    const moved = mine.filter((c) => c.cuffAtWrist === true)
    if (moved.length >= mine.filter((c) => c.cuffAtWrist === false).length) continue
    for (const { layer } of moved) delete layer.armVariant!.model
  }
}

/** Document keypoints on the working grid. */
/**
 * The part of a full body the arm is cut and measured in, on the document, and the document pixels to a grid
 * pixel there (its hand a bust's size): the arm on the variant's side as the portrait and the variant draw it,
 * the face and the other shoulder (a hand comes to the chin, across the chest), with room about them. Null
 * without the portrait's shoulders and nose; then the whole picture at the bust's grid.
 */
function figureWindow(
  reference: ArmVariantReference,
  skeleton: PsdSkeleton | undefined,
): { frame: ArmVariantReference['placement']; scale: number } | null {
  const sure = (pose: ReadonlyArray<readonly [number, number, number]> | undefined, i: number) => {
    const p = pose?.[i]
    return p && p[2] >= MIN_POINT_SCORE ? [p[0], p[1]] as const : null
  }
  const portrait = skeleton?.keypoints
  const nose = sure(portrait, 0)
  const left = sure(portrait, 5)
  const right = sure(portrait, 6)
  if (!nose || !left || !right) return null
  const shoulders = [left, right]
  const span = Math.abs(shoulders[0][0] - shoulders[1][0])
  const shoulderY = (shoulders[0][1] + shoulders[1][1]) / 2
  // The person's arm drawn on the variant's side of the picture: its shoulder there, then its elbow, wrist, hand.
  const chain = (pose: typeof portrait) => {
    const a = sure(pose, 5)
    const b = sure(pose, 6)
    if (!a || !b) return []
    const own = (a[0] < b[0]) === (reference.side === 'left') ? 0 : 1
    const joints = [5 + own, 7 + own, 9 + own].map((i) => sure(pose, i))
    const hand = Array.from({ length: 21 }, (_, k) => sure(pose, 91 + 21 * own + k))
    return [...joints, ...hand].filter((p): p is readonly [number, number] => p !== null)
  }
  const points = [nose, ...shoulders, ...chain(portrait), ...chain(reference.keypoints)]
  const armLength = (own: number) => {
    const [s, e, w] = [5 + own, 7 + own, 9 + own].map((i) => sure(portrait, i))
    return s && e && w ? Math.hypot(s[0] - e[0], s[1] - e[1]) + Math.hypot(e[0] - w[0], e[1] - w[1]) : 0
  }
  const arm = Math.max(armLength(0), armLength(1), span)
  const x0 = Math.max(0, Math.floor(Math.min(...points.map((p) => p[0])) - FIGURE_SIDE_ROOM * span))
  const x1 = Math.min(reference.width, Math.ceil(Math.max(...points.map((p) => p[0])) + FIGURE_SIDE_ROOM * span))
  const y0 = Math.max(0, Math.floor(nose[1] - FIGURE_CROWN_ROOM * Math.max(1, shoulderY - nose[1])))
  const y1 = Math.min(reference.height, Math.ceil(Math.max(...points.map((p) => p[1])) + FIGURE_FOOT_ROOM * arm))
  if (x1 - x0 < 2 || y1 - y0 < 2) return null
  // The hand as drawn: the portrait's, the surer of its two, else the variant's raised one.
  const handLength = (pose: typeof portrait) => {
    let best = 0
    for (const at of [91, 112]) {
      const wrist = sure(pose, at)
      const knuckle = sure(pose, at + 9)
      if (wrist && knuckle) best = Math.max(best, Math.hypot(wrist[0] - knuckle[0], wrist[1] - knuckle[1]))
    }
    return best
  }
  const hand = handLength(portrait) || handLength(reference.keypoints)
  if (!hand) return null
  return {
    frame: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
    scale: Math.min(3, Math.max(0.5, hand / BUST_HAND)),
  }
}

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
