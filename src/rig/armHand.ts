import type { Anime25DArmModel, Anime25DVec3 } from '../anime25drig/types'
import type { P2 } from './armRaster'
import {
  add2, area, components, convexMask, cropAround, dilateEllipse, dilateSquare, dist2, dist3, dot2, erodeEllipse,
  gaussian, interp, linspace, median, mul2, resample, rings, round, searchLeft, segmentDistance, simplify, sub2,
  toFloat, unit2, widths,
} from './armRaster'

/**
 * The gesture's drawn hand, measured for the modelled hand it textures: its
 * 21 points moved onto the fingers drawn there, each finger's drawn width
 * knuckle to tip, the palm's outline, which fingers it hides, and the outline
 * of its own cut (its skin and lines, no sleeve or body).
 */

export const FINGER_CHAINS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]
// The cut-out's edge is softened and rounded a little inside the drawn edge (and its pale line): put back.
const LINE_HALF = 2.5

export type DrawnHand = Pick<
  Anime25DArmModel,
  'hand' | 'fingers' | 'fingerProfile' | 'keyProfile' | 'palmOutline' | 'hiddenFingers' | 'handOutline'
>

export interface DrawnHandPicture {
  width: number
  height: number
  /** The gesture variant, RGB. */
  img: ArrayLike<number>
  /** Its changed arm. */
  mask: Uint8Array
  /** The hand's 21 points as the pose model found them. */
  found: P2[]
  elbow: P2
  wrist: P2
  /** The hand's own skin tone. */
  tone: Anime25DVec3
}

export function measureDrawnHand({ width: W, height: H, img, mask, found, elbow, wrist, tone }: DrawnHandPicture): DrawnHand {
  const drawn = { e: elbow, w: wrist }
  const color = (data: ArrayLike<number>, x: number, y: number): Anime25DVec3 =>
    [data[(y * W + x) * 3], data[(y * W + x) * 3 + 1], data[(y * W + x) * 3 + 2]]
  const size = dist2(found[9], found[0])
  const reach = Math.trunc(0.4 * size) | 1
  const crop = cropAround(found, reach + 32, W, H)
  const cw = crop.w
  const ch = crop.h
  const atCrop = (data: ArrayLike<number>, k: number) => {
    const x = crop.x + (k % cw)
    const y = crop.y + ((k / cw) | 0)
    return color(data, x, y)
  }
  const zone = dilateSquare(convexMask(found.map((q) => [q[0] - crop.x, q[1] - crop.y] as P2), cw, ch), cw, ch, reach)
  let al: Float32Array = new Float32Array(cw * ch)
  for (let k = 0; k < cw * ch; k += 1) al[k] = zone[k] && mask[(crop.y + ((k / cw) | 0)) * W + crop.x + (k % cw)] ? 1 : 0
  al = gaussian(al, cw, ch, 1)
  const pixels = Array.from({ length: cw * ch }, (_, k) => atCrop(img, k))
  al = wholeHand(edgePale(pixels, skinOnly(pixels, al, cw, ch, tone), cw, ch), cw, ch)
  // Its outline rounded: what the cleaning took leaves ragged bites (a fingertip torn where the white between it
  // and the thumb went), and bent with the hand they show as torn paper.
  const softened = gaussian(al, cw, ch, 2)
  const outline = new Float32Array(cw * ch)
  for (let k = 0; k < cw * ch; k += 1) {
    const s = Math.min(1, Math.max(0, (softened[k] - 0.3) / 0.4))
    outline[k] = s * s * (3 - 2 * s)
  }
  // Whole by the wrist point, fading only below it, over the modelled wrist: faded across the heel of the palm,
  // wider there than the modelled wrist, the body showed through it as a smear.
  const fd = unit2(sub2(drawn.w, drawn.e))
  const cutAlpha = new Float32Array(cw * ch)
  for (let k = 0; k < cw * ch; k += 1) {
    const along = (crop.x + (k % cw) - found[0][0]) * fd[0] + (crop.y + ((k / cw) | 0) - found[0][1]) * fd[1]
    cutAlpha[k] = outline[k] * Math.min(1, Math.max(0, (along + 0.12 * size) / (0.08 * size)))
  }
  const handCut = new Uint8Array(cw * ch)
  for (let k = 0; k < cw * ch; k += 1) handCut[k] = cutAlpha[k] > 0.5 ? 1 : 0
  const handSkin = drawnSkin(pixels, handCut)
  const inCrop = (m: Uint8Array) => (x: number, y: number) => {
    const cx = x - crop.x
    const cy = y - crop.y
    return cx >= 0 && cy >= 0 && cx < cw && cy < ch && m[cy * cw + cx] > 0
  }
  const skinAt = inCrop(handSkin)
  const cutAt = inCrop(handCut)
  const hand = refineHand(found, skinAt)

  const fingerWidths = FINGER_CHAINS.map((chain) => {
    const rs: number[] = []
    for (let i = 1; i < chain.length; i += 1) {
      const a = hand[chain[i - 1]]
      const b = hand[chain[i]]
      if (dist2(b, a) < 4) continue
      rs.push(...widths(skinAt, a, b, 3))
    }
    const kept = rs.filter((r) => r > 1)
    return kept.length ? median(kept) : 0
  })
  const fingerProfile = FINGER_CHAINS.map((chain, ci) => {
    const pts = chain.map((i) => hand[i])
    const seg = pts.slice(1).map((q, i) => dist2(q, pts[i]))
    const cum = seg.map((_, i) => seg.slice(0, i + 1).reduce((s, x) => s + x, 0))
    const total = cum[cum.length - 1]
    const prof = linspace(0.06, 0.94, 9).map((t) => {
      const at = t * total
      const i = Math.min(seg.length - 1, searchLeft(cum, at))
      const f = (at - cum[i] + seg[i]) / Math.max(1e-6, seg[i])
      const a = pts[i]
      const b = pts[i + 1]
      const c = add2(a, mul2(sub2(b, a), f))
      const from = sub2(c, mul2(sub2(b, a), 0.01))
      const to = add2(c, mul2(sub2(b, a), 0.01))
      // Out to the cut-out's edge (its shading and lines are the finger's too: stopped at the darker side shade,
      // the modelled fingers came out thin), and no further than half way to the next finger, where fingers are
      // drawn touching.
      let w = widths(cutAt, from, to, 1)[0]
      let near = Infinity
      for (const other of FINGER_CHAINS) {
        if (other === chain) continue
        for (let k = 1; k < other.length; k += 1) near = Math.min(near, segmentDistance(c, hand[other[k - 1]], hand[other[k]]))
      }
      // Never under the width inside its lines (fingers drawn over each other are near without touching), nor much
      // over the finger's own middle (a thumb drawn across the palm measured the palm).
      const inner = widths(skinAt, from, to, 1)[0]
      w = Math.max(Math.min(w, 0.5 * near), inner)
      if (fingerWidths[ci] > 1) w = Math.min(w, 1.35 * fingerWidths[ci])
      return w > 1 ? w + LINE_HALF : 0
    })
    // Where the measure ran across the palm (a finger's root) or off the drawing: taken from the finger's
    // believable measures either side.
    let good = prof.map((v) => v > 1)
    if (good.filter(Boolean).length >= 3) {
      const med = median(prof.filter((_, i) => good[i]))
      good = good.map((g, i) => g && prof[i] > 0.55 * med && prof[i] < 1.45 * med)
    }
    if (good.filter(Boolean).length < 2) return []
    const xs = prof.map((_, i) => i).filter((i) => good[i])
    const filled = prof.map((_, i) => interp(i, xs, xs.map((x) => prof[x])))
    // Its root runs into the webs either side and measures wide: no wider than a little over its middle.
    const cap = median(filled) * 1.1
    return filled.map((v) => round(Math.min(v, cap), 1))
  })
  const hiddenFingers = hidden(hand)
  const keyProfile = believable(fingerProfile)
  const palmOutline = palm(hand, drawn, cutAt, W, H, hiddenFingers, keyProfile, fingerProfile, fingerWidths)

  const handRings = rings(outline, cw, ch, 0.5).map((ring) => simplify(ring, 0.4).map(([x, y]) => [x + crop.x, y + crop.y] as P2))
  return {
    hand,
    fingers: fingerWidths,
    fingerProfile,
    keyProfile,
    palmOutline,
    hiddenFingers,
    handOutline: handRings,
  }
}

/** Only the skin and the lines drawn on it: scraps of sleeve or body that changed beside the hand. */
function skinOnly(pixels: Anime25DVec3[], al: Float32Array, w: number, h: number, tone: Anime25DVec3): Float32Array {
  const tw = tone[0] - tone[2]
  const skin = new Uint8Array(w * h)
  for (let k = 0; k < w * h; k += 1) {
    const f = pixels[k]
    const warm = f[0] - f[2]
    // Warm as skin is: white cloth and paper are as light as it, and within its distance, but not warm.
    skin[k] = dist3(f, tone) < 55 && warm > Math.max(8, tw - 15) && warm - tw < 30 && al[k] > 0.5 ? 1 : 0
  }
  const cleaned = dilateEllipse(erodeEllipse(erodeEllipse(dilateEllipse(skin, w, h, 9), w, h, 9), w, h, 5), w, h, 5)
  const keep = gaussian(toFloat(dilateEllipse(cleaned, w, h, 7)), w, h, 1)
  return al.map((a, k) => a * keep[k])
}

/** Without the pale, colourless patches open to the outside of the cut: white cloth caught between the fingers. */
function edgePale(pixels: Anime25DVec3[], al: Float32Array, w: number, h: number): Float32Array {
  const pale = new Uint8Array(w * h)
  for (let k = 0; k < w * h; k += 1) {
    const f = pixels[k]
    pale[k] = (f[0] + f[1] + f[2]) / 3 > 165 && f[0] - f[2] < 16 && al[k] > 0.05 ? 1 : 0
  }
  const grown = dilateSquare(pale, w, h, 3)
  for (let k = 0; k < w * h; k += 1) grown[k] = grown[k] && al[k] > 0.05 ? 1 : 0
  // A highlight inside the hand is ringed by skin; only what reaches the cut's edge goes.
  const outside = new Uint8Array(w * h)
  for (let k = 0; k < w * h; k += 1) outside[k] = al[k] < 0.05 ? 1 : 0
  const out = dilateSquare(outside, w, h, 3)
  const { labels } = components(grown, w, h)
  const open = new Set<number>()
  for (let k = 0; k < w * h; k += 1) {
    if (out[k] && labels[k]) open.add(labels[k])
  }
  const gone = new Uint8Array(w * h)
  for (let k = 0; k < w * h; k += 1) gone[k] = open.has(labels[k]) ? 1 : 0
  const take = gaussian(toFloat(dilateSquare(gone, w, h, 3)), w, h, 1)
  return al.map((a, k) => a * (1 - take[k]))
}

/** Only the hand itself: the loose bound also takes in crumbs of changed body beside it. */
function wholeHand(al: Float32Array, w: number, h: number): Float32Array {
  const solid = new Uint8Array(w * h)
  for (let k = 0; k < w * h; k += 1) solid[k] = al[k] > 0.5 ? 1 : 0
  // Opened first: crumbs attached at the hand's edge go too (a finger is twice this wide).
  const opened = dilateEllipse(erodeEllipse(solid, w, h, 15), w, h, 15)
  const { labels, sizes } = components(opened, w, h)
  if (sizes.length <= 1) return al
  const big = Math.max(...sizes.slice(1))
  const keep = new Uint8Array(w * h)
  for (let k = 0; k < w * h; k += 1) keep[k] = labels[k] && sizes[labels[k]] >= 0.03 * big ? 1 : 0
  const take = gaussian(toFloat(dilateSquare(keep, w, h, 3)), w, h, 1)
  return al.map((a, k) => a * take[k])
}

/**
 * The drawn hand without its lines: across fingers drawn touching, the line between them is all that tells one
 * from the next.
 */
function drawnSkin(pixels: Anime25DVec3[], cut: Uint8Array): Uint8Array {
  const lum = pixels.map((c) => (c[0] + c[1] + c[2]) / 3)
  const inHand = lum.filter((_, k) => cut[k])
  const med = inHand.length ? median(inHand) : 0
  return cut.map((c, k) => (c && lum[k] > med * 0.72 ? 1 : 0))
}

/**
 * The finger joints found moved across onto the middle of the finger drawn there, and each fingertip out to the
 * drawn tip: found a little to one side, the modelled finger took half its neighbour's gap as its skin, and its tip
 * stopped short of the drawn one.
 */
function refineHand(found: P2[], skinAt: (x: number, y: number) => boolean): P2[] {
  const h = found.map((q) => [q[0], q[1]] as P2)
  const size = dist2(h[9], h[0])
  const inside = (q: P2) => skinAt(Math.round(q[0]), Math.round(q[1]))
  const run = (q: P2, d: P2, most: number) => {
    let r = 0
    while (r < most && inside(add2(q, mul2(d, r + 1)))) r += 1
    return r
  }
  for (const chain of FINGER_CHAINS) {
    for (let k = 1; k < chain.length; k += 1) {
      const a = h[chain[k - 1]]
      const j = h[chain[k]]
      const d = mul2(sub2(j, a), 1 / Math.max(1e-6, dist2(j, a)))
      const n: P2 = [-d[1], d[0]]
      if (!inside(j)) continue
      const up = run(j, n, 0.25 * size)
      const down = run(j, mul2(n, -1), 0.25 * size)
      // A finger's width, not the palm's or two fingers': else left where it was found.
      if (up + down < 0.32 * size) h[chain[k]] = add2(j, mul2(n, (up - down) / 2))
    }
    const a = h[chain[chain.length - 2]]
    const t = h[chain[chain.length - 1]]
    const d = mul2(sub2(t, a), 1 / Math.max(1e-6, dist2(t, a)))
    if (inside(t)) h[chain[chain.length - 1]] = add2(t, mul2(d, Math.max(0, run(t, d, 0.5 * dist2(t, a)) - 2)))
  }
  return h
}

/**
 * A finger measured far wider than the other fingers (a thumb laid over the palm, mostly): left out, for the
 * modelled default to stand in.
 */
function believable(profiles: number[][]): number[][] {
  const means = profiles.map((q) => (q.length ? q.reduce((s, x) => s + x, 0) / q.length : 0))
  const others = means.slice(1).filter((m) => m > 1)
  if (!others.length) return profiles
  const med = median(others)
  return profiles.map((q, i) => (q.length && means[i] <= 1.6 * med ? q : []))
}

/**
 * Fingers a drawn hand hides behind itself: their points only guessed, they lie across the others'. The one
 * crossing the most is taken, until none cross.
 */
function hidden(h: P2[]): number[] {
  const chains = [[0, 1, 2, 3, 4], ...[5, 9, 13, 17].map((f) => [0, f, f + 1, f + 2, f + 3])]
  const bones = chains.map((chain, ci) => {
    const from = ci === 0 ? 0 : 1
    return chain.slice(from, -1).map((a, i) => [h[a], h[chain[from + i + 1]]] as const)
  })
  const side = (a: P2, b: P2, c: P2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const crosses = (f: number, g: number) =>
    bones[f].some(([p, q]) => bones[g].some(([r, t]) => side(p, q, r) * side(p, q, t) < 0 && side(r, t, p) * side(r, t, q) < 0))
  const out: number[] = []
  for (;;) {
    const n = [0, 1, 2, 3, 4].map((f) =>
      out.includes(f) ? -1 : [0, 1, 2, 3, 4].filter((g) => g !== f && !out.includes(g) && crosses(f, g)).length)
    const most = Math.max(...n)
    if (most < 1) return out
    out.push(n.indexOf(most))
  }
}

/**
 * The drawn palm's outline (the hand's cut less its fingers and forearm), 24 points in the palm's own frame: `a`
 * along wrist → middle knuckle, `b` across it toward the little finger, both in that length. Counter-clockwise,
 * from the point straight out from its middle along the hand.
 */
function palm(
  h: P2[],
  drawn: { e: P2; w: P2 },
  cutAt: (x: number, y: number) => boolean,
  W: number,
  H: number,
  hid: number[],
  own: number[][],
  profiles: number[][],
  fingers: number[],
): Array<[number, number]> | null {
  const size = dist2(h[9], h[0])
  const x0 = Math.max(0, Math.floor(Math.min(...h.map((q) => q[0])) - size))
  const y0 = Math.max(0, Math.floor(Math.min(...h.map((q) => q[1])) - size))
  const x1 = Math.min(W, Math.ceil(Math.max(...h.map((q) => q[0])) + size))
  const y1 = Math.min(H, Math.ceil(Math.max(...h.map((q) => q[1])) + size))
  const w = x1 - x0
  const hh = y1 - y0
  if (w <= 0 || hh <= 0) return null
  const fore = unit2(sub2(drawn.e, drawn.w))
  const palmSegs = [[0, 1], [1, 2], [0, 5], [0, 9], [0, 13], [0, 17], [5, 9], [9, 13], [13, 17]].map(([a, b]) => [h[a], h[b]] as const)
  // A finger claims the skin from halfway along its first bone (a hand seen from the back has its knuckles found
  // back toward the wrist); a finger the drawing hides claims none.
  const starts = [2, 5, 9, 13, 17]
  const fingerSegs = (ci: number) => {
    const f = starts[ci]
    const out: Array<readonly [P2, P2]> = []
    for (let a = f; a < f + (ci === 0 ? 2 : 3); a += 1) out.push([ci && a === f ? mul2(add2(h[a], h[a + 1]), 0.5) : h[a], h[a + 1]])
    return out
  }
  const shown = [0, 1, 2, 3, 4].filter((ci) => !hid.includes(ci))
  const segs = shown.map(fingerSegs)
  const thick = shown.map((ci) => {
    const prof = own[ci]?.length ? own[ci] : profiles[ci]
    return prof.length ? median(prof) : fingers[ci] + LINE_HALF
  })
  const nearest = (q: P2, list: ReadonlyArray<readonly [P2, P2]>) => {
    let d = Infinity
    for (const [a, b] of list) d = Math.min(d, segmentDistance(q, a, b))
    return d
  }
  const region = new Uint8Array(w * hh)
  for (let y = 0; y < hh; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const q: P2 = [x0 + x, y0 + y]
      if (!cutAt(q[0], q[1])) continue
      // Not up the forearm past the wrist point (the wrist is modelled on its own).
      if ((q[0] - h[0][0]) * fore[0] + (q[1] - h[0][1]) * fore[1] >= 0.05 * size) continue
      const dp = nearest(q, palmSegs)
      const dist = segs.map((list) => nearest(q, list))
      const owner = Math.min(Infinity, ...dist)
      // Skin nearer a finger's bones than the palm's but out past how thick that finger is drawn is the palm's
      // too: else it was nobody's, and the body showed through it.
      const df = dist.some((d, k) => d > thick[k] && d <= owner + 1e-6) ? Infinity : owner
      if (dp <= df) region[y * w + x] = 1
    }
  }
  const { labels, sizes } = components(region, w, hh)
  if (sizes.length < 2) return null
  let largest = 1
  for (let l = 2; l < sizes.length; l += 1) {
    if (sizes[l] > sizes[largest]) largest = l
  }
  const field = new Float32Array(w * hh)
  for (let k = 0; k < w * hh; k += 1) field[k] = labels[k] === largest ? 1 : 0
  const ring = rings(field, w, hh, 0.5).reduce<P2[] | null>((got, r) => (!got || Math.abs(area(r)) > Math.abs(area(got)) ? r : got), null)
  if (!ring) return null
  const pts = resample(ring.map(([x, y]) => [x + x0, y + y0] as P2), 24)
  const u = sub2(h[9], h[0])
  let v: P2 = [-u[1], u[0]]
  if (dot2(v, sub2(h[17], h[5])) < 0) v = mul2(v, -1)
  const uu = dot2(u, u)
  let o = pts.map((q) => [dot2(sub2(q, h[0]), u) / uu, dot2(sub2(q, h[0]), v) / uu] as P2)
  if (area(o) < 0) o = o.reverse()
  const c = mul2(o.reduce((s, q) => add2(s, q), [0, 0] as P2), 1 / o.length)
  let first = 0
  o.forEach((q, i) => {
    if (Math.abs(Math.atan2(q[1] - c[1], q[0] - c[0])) < Math.abs(Math.atan2(o[first][1] - c[1], o[first][0] - c[0]))) first = i
  })
  return [...o.slice(first), ...o.slice(0, first)].map((q) => [round(q[0], 4), round(q[1], 4)])
}
