import type { Arm3DMesh } from './arm3dMesh'
import type { Arm3DShape } from './arm3dMotion'
import type { Anime25DArmModel } from './types'

/** A picture cut out of the playback canvas: its pixels (straight RGBA) and where it lies. */
export interface Arm3DPicture {
  pixels: Uint8ClampedArray
  width: number
  height: number
  /** Its rectangle on the playback canvas. */
  x: number
  y: number
  w: number
  h: number
}

/** A layer as it lies at rest and where its pixels are in the atlas. */
export interface Arm3DSourceLayer {
  x: number
  y: number
  w: number
  h: number
  atlas: { x: number; y: number; w: number; h: number }
}

function canvasOf(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('canvas 2d unavailable')
  return context
}

/**
 * Layers drawn in order, at rest, into `rect` of the playback canvas: one canvas pixel each, or
 * `size` pixels in all; softened by `blur` of those pixels.
 */
export function composeArm3DPicture(
  atlas: HTMLImageElement,
  layers: readonly Arm3DSourceLayer[],
  rect: { x: number; y: number; w: number; h: number },
  size?: { width: number; height: number },
  blur = 0,
): Arm3DPicture {
  const width = Math.max(1, Math.round(size?.width ?? rect.w))
  const height = Math.max(1, Math.round(size?.height ?? rect.h))
  const context = canvasOf(width, height)
  context.setTransform(width / rect.w, 0, 0, height / rect.h, 0, 0)
  if (blur > 0) context.filter = `blur(${blur}px)`
  for (const layer of layers) {
    context.drawImage(
      atlas,
      layer.atlas.x * atlas.width,
      layer.atlas.y * atlas.height,
      layer.atlas.w * atlas.width,
      layer.atlas.h * atlas.height,
      layer.x - rect.x,
      layer.y - rect.y,
      layer.w,
      layer.h,
    )
  }
  const pixels = context.getImageData(0, 0, width, height).data
  context.canvas.width = 0
  return { pixels, width, height, x: rect.x, y: rect.y, w: rect.w, h: rect.h }
}

/** Rings filled even-odd on a w × h grid, `scale` grid pixels to a ring unit, softened by `blur` pixels. */
function coverage(rings: Anime25DArmModel['armOutline'], w: number, h: number, scale: number, blur = 0): Float32Array {
  const context = canvasOf(w, h)
  if (blur > 0) context.filter = `blur(${blur}px)`
  context.fillStyle = '#fff'
  context.beginPath()
  for (const ring of rings) {
    ring.forEach(([x, y], i) => (i === 0 ? context.moveTo(x * scale, y * scale) : context.lineTo(x * scale, y * scale)))
    context.closePath()
  }
  context.fill('evenodd')
  const data = context.getImageData(0, 0, w, h).data
  context.canvas.width = 0
  const out = new Float32Array(w * h)
  for (let i = 0; i < out.length; i += 1) out[i] = data[i * 4 + 3] / 255
  return out
}

/**
 * The gesture layer split by its model's outlines: the hand alone (its skin and lines, fading across the
 * wrist below the drawn wrist point), the arm as the sleeve's source (its edge softened and steepened), and
 * the body the portrait's arm leaves bare. That body is the gesture's own picture beside its arm, and the
 * portrait's under it (neither picture has anything else there), only about where the portrait's arm was.
 */
export function splitArm3DLayer(
  layer: { pixels: Uint8ClampedArray; width: number; height: number },
  model: Anime25DArmModel,
  /** Layer pixels to a model unit (the atlas may hold the layer smaller than drawn). */
  scale: number,
  /** On the layer's pixels: the portrait as it rests, its arm alone, and that arm spread a little. */
  portrait: { whole: Uint8ClampedArray; arm: Uint8ClampedArray; near: Uint8ClampedArray },
): { hand: Uint8ClampedArray; arm: Uint8ClampedArray; body: Uint8ClampedArray; portraitArm: Float32Array } {
  const { width: w, height: h, pixels } = layer
  const handCover = coverage(model.handOutline, w, h, scale)
  const armCover = coverage(model.armOutline, w, h, scale, 2 * scale)
  const armHard = coverage(model.armOutline, w, h, scale)
  const [hx, hy] = model.hand[0]
  const size = Math.hypot(model.hand[9][0] - hx, model.hand[9][1] - hy)
  const fx = model.raised.wrist[0] - model.raised.elbow[0]
  const fy = model.raised.wrist[1] - model.raised.elbow[1]
  const fl = Math.hypot(fx, fy) || 1
  const hand = new Uint8ClampedArray(pixels.length)
  const arm = new Uint8ClampedArray(pixels.length)
  const body = new Uint8ClampedArray(pixels.length)
  const portraitArm = new Float32Array(w * h)
  // The forearm's sleeve within its tube's core (0–255): a dark sleeve drawn over a dark coat differs from
  // the portrait too little to be in the measured outline, which then keeps only scraps of it.
  const [ex, ey] = model.raised.elbow
  const cuffX = ex + fx * model.cuff
  const cuffY = ey + fy * model.cuff
  const R = model.radius
  const core = (p: number) => {
    const x = (p % w) / scale
    const y = Math.floor(p / w) / scale
    const vx = cuffX - ex
    const vy = cuffY - ey
    const t = Math.max(0, Math.min(1, ((x - ex) * vx + (y - ey) * vy) / Math.max(1e-6, vx * vx + vy * vy)))
    const k = (0.5 + 0.5 * t) * (R.length - 1)
    const j = Math.min(R.length - 2, Math.floor(k))
    const r = 0.8 * (R[j] + (R[j + 1] - R[j]) * (k - j))
    const d = Math.hypot(x - ex - vx * t, y - ey - vy * t)
    return Math.max(0, Math.min(1, (r - d) * scale + 0.5)) * 255
  }
  // How far down the raised forearm (0 elbow, 1 wrist); a forearm modelled bare past its cuff.
  const bare = model.bare !== undefined
  const alongFore = (p: number) => (((p % w) / scale - ex) * fx + (Math.floor(p / w) / scale - ey) * fy) / (fl * fl)
  // Within the bare forearm as measured (its middle off the bone by its shift), up to its wrist: its skin drawn over
  // the portrait's own skin hardly changes the picture, so is not in the measured outline, and the forearm took next
  // to none of it. Past the wrist the band ran on up a finger held out along the forearm, hollowing it.
  const bareAt = (p: number) => {
    const x = (p % w) / scale - ex
    const y = Math.floor(p / w) / scale - ey
    const across = (x * -fy + y * fx) / fl - model.bareShift
    return Math.max(0, Math.min(1, ((model.bare ?? 0) - Math.abs(across)) * scale + 0.5))
  }
  for (let p = 0; p < w * h; p += 1) {
    const i = p * 4
    const a = pixels[i + 3]
    // The body: the gesture's beside its arm, over the portrait's under it.
    const near = Math.min(1, portrait.near[i + 3] / 255 * 3)
    const fa = a / 255 * (1 - armHard[p]) * near
    const pa = armHard[p] * portrait.arm[i + 3] / 255
    portraitArm[p] = pa
    const ba = fa + pa * (1 - fa)
    if (ba > 0) {
      for (let c = 0; c < 3; c += 1) body[i + c] = (pixels[i + c] * fa + portrait.whole[i + c] * pa * (1 - fa)) / ba
      body[i + 3] = ba * 255
    }
    // The gesture's picture itself: the layer keeps only what differs from the portrait, so where it is
    // see-through the gesture drew what the portrait has (a dark sleeve over a dark coat). Left out, the
    // sleeve's texture had holes there that its rings filled as streaks.
    const armA = Math.max(core(p), Math.max(0, Math.min(255, (armCover[p] * 255 - 128) * 2.5 + 128)))
    const k = a / 255
    const v = [0, 1, 2].map((c) => pixels[i + c] * k + portrait.whole[i + c] * (1 - k))
    // The hand, and the bare forearm the wrist is modelled as: from just past the cuff on, the drawn skin.
    const handA = Math.max(
      handCover[p] * Math.min(1, Math.max(0, (((p % w) / scale - hx) * fx + (Math.floor(p / w) / scale - hy) * fy) / fl + 0.12 * size) / (0.08 * size)),
      bare ? bareAt(p) * Math.min(1, Math.max(0, (alongFore(p) - model.cuff - 0.02) / 0.05), Math.max(0, (1.04 - alongFore(p)) / 0.04)) : 0,
    )
    if (handA <= 0 && armA <= 0) continue
    for (let c = 0; c < 3; c += 1) {
      hand[i + c] = v[c]
      arm[i + c] = v[c]
    }
    hand[i + 3] = handA * 255
    arm[i + 3] = armA
  }
  return { hand, arm, body, portraitArm }
}

/** The drawn skin just up the hand from its wrist point: the brighter half of what is opaque there, 0–1 rgb. */
export function arm3DWristTone(hand: Uint8ClampedArray, w: number, h: number, shape: Arm3DShape, toLayer: (x: number, y: number) => [number, number]): [number, number, number] {
  const [wx, wy] = toLayer(...shape.hand[0])
  const [kx, ky] = toLayer(...shape.hand[9])
  const cx = wx + (kx - wx) * 0.15
  const cy = wy + (ky - wy) * 0.15
  const r = Math.max(4, Math.hypot(kx - wx, ky - wy) * 0.25)
  const got: number[][] = []
  for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(h, Math.ceil(cy + r)); y += 1) {
    for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(w, Math.ceil(cx + r)); x += 1) {
      const i = (y * w + x) * 4
      if (hand[i + 3] > 240 && Math.hypot(x - cx, y - cy) < r) got.push([hand[i], hand[i + 1], hand[i + 2]])
    }
  }
  if (got.length < 20) return shape.skin.map((c) => c / 255) as [number, number, number]
  got.sort((a, b) => b[0] + b[1] + b[2] - (a[0] + a[1] + a[2]))
  const top = got.slice(Math.floor(got.length * 0.1), Math.floor(got.length * 0.5))
  return [0, 1, 2].map((c) => top.reduce((s, q) => s + q[c], 0) / top.length / 255) as [number, number, number]
}

/** Each row's unwritten texels (alpha 0) take the nearest written one round the ring; a row with none, the nearest row. */
export function ringFill(px: Uint8Array, w: number, h: number): void {
  const rowHas = Array.from({ length: h }, () => false)
  const near = new Int32Array(w)
  const dist = new Int32Array(w)
  for (let y = 0; y < h; y += 1) {
    const row = y * w * 4
    near.fill(-1)
    dist.fill(1 << 30)
    let any = false
    for (let x = 0; x < w; x += 1) {
      if (px[row + x * 4 + 3] > 0) {
        near[x] = x
        dist[x] = 0
        any = true
      }
    }
    if (!any) continue
    rowHas[y] = true
    // Twice round each way, so the nearest written texel is found across the seam too.
    for (let pass = 0; pass < 2; pass += 1) {
      for (let k = 1; k < 2 * w; k += 1) {
        const x = k % w
        const p = (k - 1) % w
        if (near[p] >= 0 && dist[p] + 1 < dist[x]) {
          near[x] = near[p]
          dist[x] = dist[p] + 1
        }
      }
      for (let k = 2 * w - 2; k >= 0; k -= 1) {
        const x = k % w
        const p = (k + 1) % w
        if (near[p] >= 0 && dist[p] + 1 < dist[x]) {
          near[x] = near[p]
          dist[x] = dist[p] + 1
        }
      }
    }
    for (let x = 0; x < w; x += 1) {
      if (dist[x] === 0) continue
      const s = row + near[x] * 4
      const d = row + x * 4
      px[d] = px[s]
      px[d + 1] = px[s + 1]
      px[d + 2] = px[s + 2]
      px[d + 3] = 255
    }
  }
  for (let y = 0; y < h; y += 1) {
    if (rowHas[y]) continue
    let best = -1
    for (let k = 1; k < h && best < 0; k += 1) {
      if (y - k >= 0 && rowHas[y - k]) best = y - k
      else if (y + k < h && rowHas[y + k]) best = y + k
    }
    if (best >= 0) px.copyWithin(y * w * 4, best * w * 4, (best + 1) * w * 4)
  }
}

/** Where each vertex of the hand lies in its picture, and how squarely the picture saw it (less over the tips). */
export function arm3DProject(m: Arm3DMesh, toPicture: (x: number, y: number) => [number, number]): [Float32Array, Float32Array] {
  const n = m.pos.length / 3
  const uv = new Float32Array(n * 2)
  const wt = new Float32Array(n)
  for (let i = 0; i < n; i += 1) {
    const [u, v] = toPicture(m.pos[i * 3], m.pos[i * 3 + 1])
    uv[i * 2] = u
    uv[i * 2 + 1] = v
    const t = Math.min(1, Math.max(0, (m.nrm[i * 3 + 2] - 0.1) / 0.3))
    wt[i] = t * t * (3 - 2 * t) * (1 - (m.tip?.[i] ?? 0))
  }
  return [uv, wt]
}
