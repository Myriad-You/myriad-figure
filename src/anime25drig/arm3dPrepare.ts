import type { Arm3DMesh } from './arm3dMesh'
import type { Arm3DShape } from './arm3dMotion'
import type { Anime25DArmModel } from './types'
import { smoothstep } from './arm3dMath'

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

/** How far in from its box the ground is read, where the box cuts it. */
const BORDER = 8

/**
 * Where a held arm is cut away (on `rect` of the canvas, a pixel each; red, and its edge green): the drawing's own ground (`ground`
 * rings, canvas units) well inside it, about the upper arm and elbow as raised (`s` to `e`, out to `reach`), not
 * along the forearm (which a wave swings off the drawing). Null when there is nothing to cut.
 */
export function arm3DGroundClip(
  ground: Anime25DArmModel['armOutline'],
  s: readonly number[],
  e: readonly number[],
  w: readonly number[],
  reach: number,
  foreReach: number,
  /** The portrait's own picture on a rect of the canvas (RGBA, a pixel each), softened: where it has anything, the cut would show its stale arm, not the ground. */
  portraitOn: (rect: { x: number; y: number; w: number; h: number }) => Uint8ClampedArray,
): { pixels: Uint8ClampedArray; rect: { x: number; y: number; w: number; h: number } } | null {
  const points = ground.flat()
  if (!points.length) return null
  const x0 = Math.floor(Math.min(...points.map((q) => q[0])))
  const y0 = Math.floor(Math.min(...points.map((q) => q[1])))
  const rect = { x: x0, y: y0, w: Math.max(1, Math.ceil(Math.max(...points.map((q) => q[0]))) - x0), h: Math.max(1, Math.ceil(Math.max(...points.map((q) => q[1]))) - y0) }
  // Softened and taken well inside: the held arm still sways a few pixels off where it was drawn.
  const field = coverage(ground.map((ring) => ring.map(([x, y]) => [x - rect.x, y - rect.y] as [number, number])), rect.w, rect.h, 1, 3)
  const portrait = portraitOn(rect)
  // Red: how far it is cut away; green: its edge. Opaque, so neither is lost to premultiplying.
  const pixels = new Uint8ClampedArray(rect.w * rect.h * 4)
  for (let p = 3; p < pixels.length; p += 4) pixels[p] = 255
  const along = (x: number, y: number, a: readonly number[], b: readonly number[]) => {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / Math.max(1e-6, dx * dx + dy * dy)))
    return { t, d: Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t) }
  }
  let any = false
  for (let p = 0; p < rect.w * rect.h; p += 1) {
    const x = rect.x + (p % rect.w) + 0.5
    const y = rect.y + Math.floor(p / rect.w) + 0.5
    // Cut well inside the ground; just short of the cut, its edge (outlined there as the drawing outlines it).
    // Near its own border the ground runs on past it (to the drawing's edge, or the box it was found in): taken from
    // a little inside, or the softening there read as the ground's edge, outlined along the picture's foot.
    const f = field[Math.min(rect.h - 1 - BORDER, Math.max(BORDER, Math.floor(p / rect.w))) * rect.w + Math.min(rect.w - 1 - BORDER, Math.max(BORDER, p % rect.w))] ?? field[p]
    const cut = smoothstep(0.85, 1, f)
    const edge = smoothstep(0.35, 0.6, f) * (1 - cut)
    if (edge + cut <= 0) continue
    const up = along(x, y, s, e)
    const fore = along(x, y, e, w)
    const notFore = 1 - smoothstep(0.12, 0.25, fore.t) * (1 - smoothstep(foreReach * 0.9, foreReach * 1.1, fore.d))
    // Only where the portrait has nothing either: cut there, what lies under the arm held is the ground too. Elsewhere
    // the figure there still shows the portrait's arm beside the drawn one (a wave's cuff stood out in its band).
    const zone = (1 - smoothstep(reach * 0.9, reach * 1.1, up.d)) * notFore * (1 - smoothstep(0.02, 0.2, portrait[p * 4 + 3] / 255))
    pixels[p * 4] = Math.round(cut * zone * 255)
    pixels[p * 4 + 1] = Math.round(edge * zone * 255)
    if (cut * zone > 0.004) any = true
  }
  return any ? { pixels, rect } : null
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
  /**
   * The body without the gesture's picture beside its arm: a standing figure's layers have what its hanging arm
   * hid (its coat's side, the hair behind), and each gesture drew that place anew its own way (a cape still
   * hanging there under the one the arm had lifted, its white ground between strands of hair), another at every
   * change of gesture.
   */
  portraitOnly = false,
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
    const fa = portraitOnly ? 0 : a / 255 * (1 - armHard[p]) * near
    const pa = armHard[p] * portrait.arm[i + 3] / 255
    portraitArm[p] = pa
    // (A standing figure's arm is the modelled one wherever it is: the portrait's arm under a gesture's stood on
    // where it had hung, a ring and a sleeve's top under the armpit of an arm raised away from them.)
    const ba = portraitOnly ? 0 : fa + pa * (1 - fa)
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
    // The arm only where either picture has anything: within the model's outline but past both (off the figure's
    // edge, the portrait cut there) it was solid black, which the sleeve's texture took for cloth.
    const have = k + (1 - k) * portrait.whole[i + 3] / 255
    for (let c = 0; c < 3; c += 1) {
      hand[i + c] = v[c]
      arm[i + c] = have > 0 ? (pixels[i + c] * k + portrait.whole[i + c] * (1 - k) * portrait.whole[i + 3] / 255) / have : 0
    }
    hand[i + 3] = handA * 255
    arm[i + 3] = armA * have
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
  const tone = [0, 1, 2].map((c) => top.reduce((s, q) => s + q[c], 0) / top.length / 255) as [number, number, number]
  // A standing figure's wrist may wear a band there: what is far off its skin is not its skin.
  if (shape.restFore !== undefined && tone.some((v, c) => Math.abs(v - shape.skin[c] / 255) > 0.1)) return shape.skin.map((c) => c / 255) as [number, number, number]
  return tone
}

/**
 * A cuff's last rows as its cloth all round: the portrait draws a hanging cuff open at its mouth, the shadowed
 * inside and the wrist in it, and worn round the modelled cuff that stood on its face as a grey patch and a wrist
 * seen through the cloth. Down each column, what is no more coloured than skin (its trim and jewels stay) takes the
 * cuff's plain cloth from just above.
 */
/**
 * A baked sleeve's rows from a short sleeve's end `from` to a little past the bare elbow's row `to` (shares of its
 * height) as the nearest skin from the row `to` on, where there is any: what hangs off the sleeve over the arm as it is drawn hanging (a
 * strap's end, the hem's lower side) stayed on the skin of the arm raised, a dark block by the elbow.
 */
export function bareBelowSleeve(px: Uint8Array, w: number, h: number, from: number, to: number, skin: readonly number[], shade: readonly number[]): void {
  const y0 = Math.max(0, Math.floor(from * h))
  const y1 = Math.min(h - 1, Math.floor((to + 0.12) * h))
  const ref = Math.min(h - 1, Math.floor(to * h))
  const off = (i: number, c: readonly number[]) => Math.hypot(px[i] - c[0], px[i + 1] - c[1], px[i + 2] - c[2])
  const bare = (i: number) => px[i + 3] > 0 && Math.min(off(i, skin), off(i, shade)) < 48
  for (let x = 0; x < w; x += 1) {
    // The nearest skin at or past the elbow's row in this place round the arm; none (the arm's own outline), left.
    let src = -1
    for (let y = ref; y <= y1 && src < 0; y += 1) { if (bare((y * w + x) * 4)) src = (y * w + x) * 4
}
    if (src < 0) continue
    for (let y = y1; y >= y0; y -= 1) {
      const i = (y * w + x) * 4
      if (bare(i)) src = i
      else px.copyWithin(i, src, src + 4)
    }
  }
}

export function clothCuffMouth(px: Uint8Array, w: number, h: number): void {
  const from = Math.floor(h * 0.88)
  const above = Math.floor(h * 0.76)
  const light = (i: number) => (px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11) / 255
  const tint = (i: number) => {
    const hi = Math.max(px[i], px[i + 1], px[i + 2])
    return hi > 0 ? (hi - Math.min(px[i], px[i + 1], px[i + 2])) / hi : 1
  }
  const plain = (i: number) => tint(i) < 0.24
  // A dark band worn round the cuff's end (a wristband over the sleeve) is its trim, not its mouth: dark right round
  // the ring, row after row, where a mouth is dark only within the cloth's rim.
  const lights: number[] = []
  for (let y = above; y < from; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4
      if (px[i + 3] > 0 && plain(i)) lights.push(light(i))
    }
  }
  if (lights.length) {
    lights.sort((a, b) => a - b)
    const dark = lights[lights.length >> 1] * 0.5
    let banded = 0
    for (let y = from; y < h; y += 1) {
      let drawn = 0
      let under = 0
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4
        if (px[i + 3] === 0) continue
        drawn += 1
        if (light(i) < dark) under += 1
      }
      if (drawn > 0 && under >= 0.85 * drawn) banded += 1
    }
    if (banded >= 0.3 * (h - from)) return
  }
  for (let x = 0; x < w; x += 1) {
    const cloth: number[] = []
    for (let y = above; y < from; y += 1) {
      const i = (y * w + x) * 4
      if (px[i + 3] > 0 && plain(i)) cloth.push(i)
    }
    if (cloth.length < 3) continue
    cloth.sort((a, b) => light(a) - light(b))
    const ref = cloth[Math.floor(cloth.length * 0.75)]
    for (let y = from; y < h; y += 1) {
      const i = (y * w + x) * 4
      if (px[i + 3] > 0 && (tint(i) < 0.4 || (tint(i) < 0.6 && light(i) < light(ref) * 0.5))) px.set([px[ref], px[ref + 1], px[ref + 2]], i)
    }
  }
}

/**
 * Each row's unwritten texels (alpha 0) take the nearest written one round the ring; a row with none, the nearest row.
 * With `inset`, taken that many texels further into the written run (never past its middle): a run's edge is where
 * the picture saw the sleeve's side, its outline, and carried round the unseen side it stood as a dark wedge.
 */
export function ringFill(px: Uint8Array, w: number, h: number, inset = 0): void {
  const rowHas = Array.from({ length: h }, () => false)
  const near = new Int32Array(w)
  const dist = new Int32Array(w)
  const ahead = new Int32Array(w)
  const behind = new Int32Array(w)
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
    // Each written texel's run on from it, each way (twice round, across the seam).
    if (inset > 0) {
      ahead.fill(0)
      behind.fill(0)
      for (let k = 2 * w - 1; k >= 0; k -= 1) ahead[k % w] = dist[k % w] === 0 ? Math.min(w, 1 + ahead[(k + 1) % w]) : 0
      for (let k = 0; k < 2 * w; k += 1) behind[k % w] = dist[k % w] === 0 ? Math.min(w, 1 + behind[(k + w - 1) % w]) : 0
    }
    for (let x = 0; x < w; x += 1) {
      if (dist[x] === 0) continue
      const toward = (near[x] - x + w) % w <= w / 2 ? 1 : -1
      const run = inset > 0 ? (toward > 0 ? ahead : behind)[near[x]] : 1
      const s = row + ((near[x] + toward * Math.min(inset, (run - 1) >> 1) + w) % w) * 4
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

/**
 * A texture's unwritten texels (alpha 0) made the written ones' colours spread smoothly into them (round the ring
 * across the seam; `w` and `h` powers of two): each takes the average of what is written near it, from as far as it
 * takes to find any. For the elbow's own pieces, most of which no drawing shows: the nearest written texel carried
 * along each row (`ringFill`) stood on them as bars, a row's one dark texel at the drawing's edge drawn out all round.
 */
export function spreadFill(px: Uint8Array, w: number, h: number): void {
  if ((w & (w - 1)) !== 0 || (h & (h - 1)) !== 0) throw new Error('spreadFill: a power of two each way')
  interface Level { w: number; h: number; c: Float32Array; a: Float32Array }
  const levels: Level[] = [{ w, h, c: new Float32Array(w * h * 3), a: new Float32Array(w * h) }]
  for (let i = 0; i < w * h; i += 1) {
    if (px[i * 4 + 3] === 0) continue
    levels[0].a[i] = 1
    for (let k = 0; k < 3; k += 1) levels[0].c[i * 3 + k] = px[i * 4 + k]
  }
  // Each level half the last: what is written under each texel, summed, and how much of it is.
  while (levels[levels.length - 1].w > 1 && levels[levels.length - 1].h > 1) {
    const from = levels[levels.length - 1]
    const to: Level = { w: from.w >> 1, h: from.h >> 1, c: new Float32Array((from.w >> 1) * (from.h >> 1) * 3), a: new Float32Array((from.w >> 1) * (from.h >> 1)) }
    for (let y = 0; y < to.h; y += 1) {
      for (let x = 0; x < to.w; x += 1) {
        const o = y * to.w + x
        for (const i of [2 * y * from.w + 2 * x, 2 * y * from.w + 2 * x + 1, (2 * y + 1) * from.w + 2 * x, (2 * y + 1) * from.w + 2 * x + 1]) {
          to.a[o] += from.a[i] / 4
          for (let k = 0; k < 3; k += 1) to.c[o * 3 + k] += from.c[i * 3 + k] / 4
        }
      }
    }
    levels.push(to)
  }
  // The last level as plain colour where it has any.
  const top = levels[levels.length - 1]
  for (let i = 0; i < top.a.length; i += 1) {
    if (top.a[i] <= 0) continue
    for (let k = 0; k < 3; k += 1) top.c[i * 3 + k] /= top.a[i]
    top.a[i] = 1
  }
  // Back down: what a level lacks, from the one above it (between its texels, so no blocks show).
  for (let l = levels.length - 2; l >= 0; l -= 1) {
    const to = levels[l]
    const from = levels[l + 1]
    for (let y = 0; y < to.h; y += 1) {
      const fy = Math.min(from.h - 1, Math.max(0, (y - 0.5) / 2))
      const y0 = Math.floor(fy)
      const y1 = Math.min(from.h - 1, y0 + 1)
      const ty = fy - y0
      for (let x = 0; x < to.w; x += 1) {
        const o = y * to.w + x
        if (to.a[o] >= 1) continue
        const fx = (x - 0.5) / 2
        const x0 = ((Math.floor(fx) % from.w) + from.w) % from.w
        const x1 = (x0 + 1) % from.w
        const tx = fx - Math.floor(fx)
        let a = 0
        const c = [0, 0, 0]
        for (const [i, wt] of [[y0 * from.w + x0, (1 - tx) * (1 - ty)], [y0 * from.w + x1, tx * (1 - ty)], [y1 * from.w + x0, (1 - tx) * ty], [y1 * from.w + x1, tx * ty]] as const) {
          a += from.a[i] * wt
          for (let k = 0; k < 3; k += 1) c[k] += from.c[i * 3 + k] * wt
        }
        if (a <= 0) continue
        // (The level above is whole by now: all of what is lacking here comes from it.)
        const lack = 1 - to.a[o]
        for (let k = 0; k < 3; k += 1) to.c[o * 3 + k] += c[k] / a * lack
        to.a[o] = 1
      }
    }
  }
  const { c, a } = levels[0]
  for (let i = 0; i < w * h; i += 1) {
    if (px[i * 4 + 3] > 0 || a[i] <= 0) continue
    for (let k = 0; k < 3; k += 1) px[i * 4 + k] = Math.round(c[i * 3 + k])
    px[i * 4 + 3] = 255
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

/**
 * The gesture as drawn (its layer over the portrait it leaves showing; layer pixels, `scale` to a model unit)
 * about its upper arm and elbow alone: not its forearm, which a wave swings away from the drawing. All of it
 * there, not only what was measured as arm: a dark sleeve drawn over the portrait's dark sleeve is not in the
 * arm's outline, and left out, the portrait's hanging cuff showed under the elbow. `front`, what the portrait
 * draws in front of the arm. `over` is laid over the sleeve; `beside` where the body under the drawn arm keeps the
 * portrait's own (`portraitArm`, its share there), which the sleeve does not quite cover: its hanging cuff showed
 * in bits about the raised elbow. `fore`, for a gesture whose forearm is held still (`still`), that forearm as
 * drawn on into the heel of its hand, laid over the arm after its hand wherever the modelled hand is not: the
 * modelled forearm and its sleeve's end are a tube's, the drawing's a cloth's (a kimono's slanting sleeve mouth).
 * `foreFront`, the same where the portrait draws in front of its arm, laid on only as the arm is all but held.
 */
export function arm3DUpperArmAlone(gesture: Uint8ClampedArray, portrait: Uint8ClampedArray, front: Uint8ClampedArray, w: number, h: number, model: Anime25DArmModel, scale: number, portraitArm: Float32Array, still = false): { over: Uint8ClampedArray; beside: Uint8ClampedArray; fore: Uint8ClampedArray | null; foreFront: Uint8ClampedArray | null } {
  const out = new Uint8ClampedArray(gesture.length)
  const beside = new Uint8ClampedArray(gesture.length)
  const fore = still ? new Uint8ClampedArray(gesture.length) : null
  const foreFront = still ? new Uint8ClampedArray(gesture.length) : null
  const { shoulder: s, elbow: e, wrist: wr } = model.raised
  const R = model.radius
  const half = R.length >> 1
  const upperR = 1.25 * Math.max(...R.slice(0, half + 1))
  const foreR = 1.1 * R.slice(half).reduce((a, b) => a + b, 0) / (R.length - half)
  // Out to its widest (a sleeve's mouth), not only its mean: the modelled one is as wide there.
  const foreWide = Math.max(foreR, 1.1 * Math.max(...R.slice(half)))
  const along = (x: number, y: number, a: readonly number[], b: readonly number[]) => {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / Math.max(1e-6, dx * dx + dy * dy)))
    return { t, d: Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t) }
  }
  for (let p = 0; p < w * h; p += 1) {
    const x = (p % w) / scale
    const y = Math.floor(p / w) / scale
    const up = along(x, y, s, e)
    const forearm = along(x, y, e, wr)
    const pastElbow = smoothstep(0.12, 0.25, forearm.t)
    const notFore = 1 - pastElbow * (1 - smoothstep(foreR * 0.9, foreR * 1.1, forearm.d))
    const keep = (1 - smoothstep(upperR * 0.9, upperR * 1.1, up.d)) * notFore
    const i = p * 4
    const k = gesture[i + 3] / 255
    const a = Math.max(k, portrait[i + 3] / 255)
    for (let c = 0; c < 3; c += 1) out[i + c] = beside[i + c] = gesture[i + c] * k + portrait[i + c] * (1 - k)
    // Not where the portrait draws in front of the arm (hair over the shoulder): that is drawn again over it as it
    // moves, and the drawing's still copy showed beside it, a grey smudge.
    out[i + 3] = a * keep * (1 - front[i + 3] / 255) * 255
    // Nothing beside the forearm either, however wide its drawn cuff: a wave swings it off the drawing.
    beside[i + 3] = portraitArm[p] * (1 - pastElbow) * (1 - front[i + 3] / 255) * 255
    if (fore) {
      for (let c = 0; c < 3; c += 1) fore[i + c] = out[i + c]
      const sleeve = 1 - smoothstep(foreWide * 1.15, foreWide * 1.35, forearm.d)
      const drawn = k * pastElbow * sleeve
      const before = drawn * (1 - front[i + 3] / 255)
      fore[i + 3] = before * 255
      // Where the portrait draws in front of its arm, apart: the modelled forearm is in front of that too (only the
      // upper arm has it drawn again over it), and left out, the tube showed across a chest drawn after the arm;
      // but laid on as soon as the arm comes near, the drawn forearm showed there faintly before the arm was in it.
      // Laid over `fore`, not added to it: as much of what `fore` left as makes the two the drawing's own (the soft
      // edges of what lies in front were short of it, a faint fringe).
      foreFront![i + 3] = before < 1 ? Math.min(1, (drawn - before) / (1 - before)) * 255 : 0
      for (let c = 0; c < 3; c += 1) foreFront![i + c] = out[i + c]
    }
  }
  return { over: out, beside, fore, foreFront }
}

/**
 * The points (layer, vertex) on the picture's left and right edges, as they rest, where the edge cuts the figure:
 * a side counts when what reaches it runs straight down it a good way (a tenth of `height`), not one point of a
 * figure ending inside the picture. Empty for a side not cut.
 */
export function arm3DCutSides(layers: ReadonlyArray<{ rest: ArrayLike<number> }>, height: number): [Array<[number, number]>, Array<[number, number]>] {
  const out: [Array<[number, number]>, Array<[number, number]>] = [[], []]
  for (const [k, sign] of [[0, -1], [1, 1]] as const) {
    let edge = -Infinity
    for (const layer of layers) {
      for (let i = 0; i < layer.rest.length; i += 2) edge = Math.max(edge, sign * layer.rest[i])
    }
    const on: Array<[number, number]> = []
    let top = Infinity
    let bottom = -Infinity
    layers.forEach((layer, l) => {
      for (let i = 0; i < layer.rest.length / 2; i += 1) {
        if (sign * layer.rest[i * 2] < edge - 0.5) continue
        on.push([l, i])
        top = Math.min(top, layer.rest[i * 2 + 1])
        bottom = Math.max(bottom, layer.rest[i * 2 + 1])
      }
    })
    if (bottom - top > 0.1 * height) out[k] = on
  }
  return out
}

/** A sleeve's outline as dark as the drawings have theirs where nothing is measured (a standing figure's, always). */
export const ARM3D_INK = 0.4

/**
 * How dark the picture draws the line round its arm, of the cloth just inside it (1 as light as the cloth): the
 * modelled sleeve's outline is drawn that dark. At a fixed darkness a picture lined pale (lilac on lilac) wore a
 * near-black line where its forearm lay over its own sleeve, harder than any line it draws. `arm`: the arm alone
 * (RGBA). The darker fifth along its edge against the middle of what lies a little further in; never darker than
 * `ARM3D_INK`, and that where too little is found.
 */
export function arm3DInk(arm: Uint8ClampedArray, width: number, height: number): number {
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && arm[(y * width + x) * 4 + 3] > 250
  const ringed = (x: number, y: number, r: number) => {
    for (let k = 0; k < 8; k += 1) {
      const a = k * Math.PI / 4
      if (!solid(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r))) return false
    }
    return true
  }
  const luma = (x: number, y: number) => {
    const i = (y * width + x) * 4
    return 0.299 * arm[i] + 0.587 * arm[i + 1] + 0.114 * arm[i + 2]
  }
  const r = Math.max(2, Math.round(Math.max(width, height) / 400))
  const edge: number[] = []
  const inside: number[] = []
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      if (!solid(x, y)) continue
      if (!ringed(x, y, r * 2)) edge.push(luma(x, y))
      else if (ringed(x, y, r * 5) && !ringed(x, y, r * 9)) inside.push(luma(x, y))
    }
  }
  if (edge.length < 200 || inside.length < 200) return ARM3D_INK
  edge.sort((a, b) => a - b)
  inside.sort((a, b) => a - b)
  const cloth = inside[inside.length >> 1]
  if (cloth < 1) return ARM3D_INK
  return Math.max(ARM3D_INK, Math.min(0.8, edge[Math.floor(edge.length * 0.2)] / cloth))
}
