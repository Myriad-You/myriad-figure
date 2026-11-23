import type { Anime25DArmSide } from './armVariantPresenter'
import type { ContinuousMouthShape } from './continuousMouth'
import type { Anime25DDriver } from './driver'
import type { Anime25DRenderFrame } from './renderer'
import type { ThinkingStickerFrame } from './thinkingSticker'

// One drawn frame of the figure as plain data: everything its drawing reads that changes from frame to frame, taken
// after the figure has moved and before it is drawn. Drawn again (Anime25DPlayer.renderPose), by this player or
// another of the same package, at any size, it is the same picture to the pixel.

/** How one layer is drawn. */
export interface Anime25DLayerPose {
  transform: Float32Array
  opacity: number
  multiply: Float32Array | null
  behindFace: number
  /** Its vertices as they lie on the GPU; null for a layer whose vertices never move. */
  vertices: Float32Array | null
}

/** One modelled arm as drawn, in the picture of one gesture. */
export interface Anime25DDrawnArmPose {
  gesture: string
  /** How far round the elbow's rings turned the frame before. */
  twist: number | null
  /** The sleeve as worn this frame. */
  cuff: number
  radius: number[]
  restEnd: number
  ink: number | null
  joints: { s: number[]; e: number[]; w: number[]; hand: number[][] }
  presence: number
  handRest: number
  hanging: number
  restNear: number
  unlined: number
  foot: number[][]
  sides: number[]
  held: { pos: Float32Array; near: number; exact: number; toDrawn: number[] | null } | null
  rest: { corners: number[]; alpha: number } | null
  also: { gesture: string; weight: number }[] | null
}

/** A cloth of an arm as drawn: its nodes, and which of its triangles lie under the forearm and over it. */
export interface Anime25DClothPose {
  nodes: Float32Array
  under: Uint16Array
  front: Uint16Array
}

/** One side's modelled arm: where it is, what it fades from, its cloths (null for one that is its layer's picture). */
export interface Anime25DArmPose {
  side: Anime25DArmSide
  now: Anime25DDrawnArmPose | null
  leaving: Anime25DDrawnArmPose | null
  cloths: (Anime25DClothPose | null)[]
}

export interface Anime25DPose {
  version: 1
  /** The package it was taken of: it is drawn on no other. */
  figure: string
  time: number
  /** What the figure was asked to be, as every driver stood: the pose's meaning, not read to draw it. */
  driver: Anime25DDriver
  frame: Anime25DRenderFrame
  /** The layers' places in drawing order. */
  order: Uint16Array
  layers: Anime25DLayerPose[]
  collar: Float32Array | null
  mouth: ContinuousMouthShape | null
  sticker: ThinkingStickerFrame | null
  arms: Anime25DArmPose[]
}

/** The pose as JSON: exact, its vertices as base64. */
export function poseToJSON(pose: Readonly<Anime25DPose>): string {
  return JSON.stringify(pose, (_key, value: unknown) => {
    if (value instanceof Float32Array) return { f32: toBase64(value) }
    if (value instanceof Uint16Array) return { u16: toBase64(value) }
    if (typeof value === 'number' && !Number.isFinite(value)) return { number: String(value) }
    return value
  })
}

/** What poseToJSON wrote, back. Throws on what is not JSON; whether it is a pose of her, renderPose says. */
export function poseFromJSON(text: string): Anime25DPose {
  return JSON.parse(text, (_key, value: unknown) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
    const keys = Object.keys(value)
    if (keys.length !== 1) return value
    const coded = (value as Record<string, unknown>)[keys[0]!]
    if (typeof coded !== 'string') return value
    if (keys[0] === 'f32') return new Float32Array(fromBase64(coded))
    if (keys[0] === 'u16') return new Uint16Array(fromBase64(coded))
    if (keys[0] === 'number') return Number(coded)
    return value
  }) as Anime25DPose
}

/**
 * Between two poses of one package, `share` of the way from `a` to `b`: for frames between two neighbouring ones
 * (slow motion, another frame rate). What cannot be between (the order, whether an arm is there) is the nearer one's;
 * so are two poses of different packages.
 */
export function blendPoses(a: Anime25DPose, b: Anime25DPose, share: number): Anime25DPose {
  if (share <= 0 || a.figure !== b.figure) return share < 0.5 || share <= 0 ? a : b
  if (share >= 1) return b
  return blend(a, b, share) as Anime25DPose
}

function blend(a: unknown, b: unknown, share: number): unknown {
  const nearer = share < 0.5 ? a : b
  if (a === b) return a
  if (typeof a === 'number' && typeof b === 'number') return Number.isFinite(a) && Number.isFinite(b) ? a + (b - a) * share : nearer
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return nearer
  if (a instanceof Float32Array && b instanceof Float32Array) {
    if (a.length !== b.length) return nearer
    return a.map((value, i) => Number.isFinite(value) && Number.isFinite(b[i]!) ? value + (b[i]! - value) * share : (nearer as Float32Array)[i]!)
  }
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) return nearer
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length ? a.map((value, i) => blend(value, b[i], share)) : nearer
  }
  const from = a as Record<string, unknown>
  const to = b as Record<string, unknown>
  // An arm on its way between two gestures is in one picture or the other.
  if ('gesture' in from && from.gesture !== to.gesture) return nearer
  return Object.fromEntries(Object.keys(nearer as object).map(key =>
    [key, key in from && key in to ? blend(from[key], to[key], share) : (nearer as Record<string, unknown>)[key]]))
}

function toBase64(values: Float32Array | Uint16Array): string {
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength)
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

function fromBase64(text: string): ArrayBuffer {
  return Uint8Array.from(atob(text), char => char.charCodeAt(0)).buffer
}
