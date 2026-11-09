import type { Anime25DArmModel, Anime25DVec3 } from '../anime25drig/types'
import type { P2 } from './armRaster'
import {
  add2, area, closeSquare, components, convexMask, cropAround, dilateEllipse, dilateSquare, dist2, dist3, dot2, erodeEllipse,
  gaussian, interp, linspace, median, medianColor, mul2, percentile, resample, rings, round, searchLeft,
  segmentDistance, simplify, sub2, toFloat, unit2, widths,
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
  /** Fingers seen held out on the drawing, never taken as hidden. */
  shown?: number[]
}

export function measureDrawnHand({ width: W, height: H, img, mask, found, elbow, wrist, tone, shown = [] }: DrawnHandPicture): DrawnHand {
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
  const skin = skinOnly(pixels, al, cw, ch, tone)
  // Its outline rounded: what the cleaning took leaves ragged bites (a fingertip torn where the white between it
  // and the thumb went), and bent with the hand they show as torn paper.
  const rounded = (a: Float32Array) => {
    const softened = gaussian(a, cw, ch, 2)
    return softened.map((v) => {
      const s = Math.min(1, Math.max(0, (v - 0.3) / 0.4))
      return s * s * (3 - 2 * s)
    })
  }
  // Measured (the fingers' widths, the palm's outline) on the cut as it was settled; the picture the hand wears
  // keeps all of the drawn hand: its pale edge inside its own line and the shadows between curled fingers (left
  // out, the modelled fist showed a side and pockets of its own shading where the drawing has them). Measured on
  // that, the fingers claimed a hidden thumb's skin from the palm, which then stopped short of the drawn thumb.
  const outline = rounded(wholeHand(edgePale(pixels, skin, cw, ch, false), cw, ch))
  const lit = highlightsFilled(pixels, wholeHand(edgePale(pixels, skin, cw, ch, true), cw, ch), cw, ch, 0.15 * size)
  const worn = rounded(shadowsFilled(pixels, lit, cw, ch, 0.15 * size))
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
  const hiddenFingers = hiddenFingersOf(hand, shown)
  const keyProfile = believable(fingerProfile)
  const palmOutline = palm(hand, drawn, cutAt, W, H, hiddenFingers, keyProfile, fingerProfile, fingerWidths)

  const handRings = rings(worn, cw, ch, 0.5).map((ring) => simplify(ring, 0.4).map(([x, y]) => [x + crop.x, y + crop.y] as P2))
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

/**
 * Without the pale, colourless patches open to the outside of the cut: white cloth caught between the fingers. With
 * `inkCloses`, not open across the hand's own ink line (the skin test took it off the cut): a fist's near-white
 * highlight inside its outline went as cloth, the side of the fist with it.
 */
function edgePale(pixels: Anime25DVec3[], al: Float32Array, w: number, h: number, inkCloses: boolean): Float32Array {
  const lum = pixels.map((c) => (c[0] + c[1] + c[2]) / 3)
  const inHand = lum.filter((_, k) => al[k] > 0.5)
  const ink = inkCloses ? (inHand.length ? median(inHand) : 0) * 0.72 : -1
  const pale = new Uint8Array(w * h)
  for (let k = 0; k < w * h; k += 1) {
    const f = pixels[k]
    pale[k] = (f[0] + f[1] + f[2]) / 3 > 165 && f[0] - f[2] < 16 && al[k] > 0.05 ? 1 : 0
  }
  const grown = dilateSquare(pale, w, h, 3)
  for (let k = 0; k < w * h; k += 1) grown[k] = grown[k] && al[k] > 0.05 ? 1 : 0
  // A highlight inside the hand is ringed by skin; only what reaches the cut's edge goes.
  const outside = new Uint8Array(w * h)
  for (let k = 0; k < w * h; k += 1) outside[k] = al[k] < 0.05 && lum[k] > ink ? 1 : 0
  const out = dilateSquare(outside, w, h, inkCloses ? 1 : 3)
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
 * A highlight the skin test left out (near white, so not warm as skin), where the hand's own skin runs on into it
 * along much of its edge and its ink line closes the rest: the knuckle and finger edges of a hand drawn on white
 * ground went with the ground, and held as drawn the modelled hand showed its pale rim where the drawing has its
 * line. Not what the hand's line rings all round (body or ground seen through a ring of finger and thumb).
 */
function highlightsFilled(pixels: Anime25DVec3[], al: Float32Array, w: number, h: number, most: number): Float32Array {
  const lum = pixels.map((c) => (c[0] + c[1] + c[2]) / 3)
  const inHand = lum.filter((_, k) => al[k] > 0.5)
  const ink = (inHand.length ? median(inHand) : 0) * 0.72
  const open = new Uint8Array(w * h)
  for (let k = 0; k < w * h; k += 1) open[k] = al[k] < 0.5 && lum[k] > ink ? 1 : 0
  const { labels, sizes } = components(open, w, h)
  const edge = new Set<number>()
  for (let x = 0; x < w; x += 1) {
    edge.add(labels[x])
    edge.add(labels[(h - 1) * w + x])
  }
  for (let y = 0; y < h; y += 1) {
    edge.add(labels[y * w])
    edge.add(labels[y * w + w - 1])
  }
  // Of each patch's bordering pixels, how many are the hand's skin: warm, as white ground the cut took in at its
  // edge is not.
  const ring = new Float64Array(sizes.length)
  const ringHand = new Float64Array(sizes.length)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const l = labels[y * w + x]
      if (!l) continue
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || labels[ny * w + nx] === l) continue
        ring[l] += 1
        const j = ny * w + nx
        if (al[j] > 0.5 && pixels[j][0] - pixels[j][2] > 4) ringHand[l] += 1
      }
    }
  }
  const fill = new Uint8Array(w * h)
  for (let k = 0; k < w * h; k += 1) {
    const l = labels[k]
    fill[k] = l && !edge.has(l) && sizes[l] < most * most && ringHand[l] >= 0.3 * ring[l] ? 1 : 0
  }
  const take = gaussian(toFloat(dilateSquare(fill, w, h, 1)), w, h, 1)
  return al.map((a, k) => Math.max(a, take[k]))
}

/**
 * Small holes the hand closes all round, filled where they are dark and warm as its shadow is: the pocket between
 * curled fingers, which left out had the modelled fist show its own pale shading there. A slit between fingers
 * laid flat goes in too (its drawn edges make it so): held as drawn, the hand then shows the slit the drawing has.
 * Not skin of the body seen through a ring of finger and thumb (as light as the hand), nor any as wide as `most`.
 */
function shadowsFilled(pixels: Anime25DVec3[], al: Float32Array, w: number, h: number, most: number): Float32Array {
  const open = new Uint8Array(w * h)
  for (let k = 0; k < w * h; k += 1) open[k] = al[k] < 0.5 ? 1 : 0
  const { labels, sizes } = components(open, w, h)
  const lum = pixels.map((c) => (c[0] + c[1] + c[2]) / 3)
  const inHand = lum.filter((_, k) => al[k] > 0.5)
  const med = inHand.length ? median(inHand) : 0
  const sumL = new Float64Array(sizes.length)
  const sumW = new Float64Array(sizes.length)
  for (let k = 0; k < w * h; k += 1) {
    sumL[labels[k]] += lum[k]
    sumW[labels[k]] += pixels[k][0] - pixels[k][2]
  }
  const shadow = (l: number) => sumL[l] / sizes[l] < 0.85 * med && sumW[l] / sizes[l] > 12
  const edge = new Set<number>()
  for (let x = 0; x < w; x += 1) {
    edge.add(labels[x])
    edge.add(labels[(h - 1) * w + x])
  }
  for (let y = 0; y < h; y += 1) {
    edge.add(labels[y * w])
    edge.add(labels[y * w + w - 1])
  }
  const fill = new Uint8Array(w * h)
  for (let k = 0; k < w * h; k += 1) fill[k] = labels[k] && !edge.has(labels[k]) && sizes[labels[k]] < most * most && shadow(labels[k]) ? 1 : 0
  const take = gaussian(toFloat(dilateSquare(fill, w, h, 1)), w, h, 1)
  return al.map((a, k) => Math.max(a, take[k]))
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
 * crossing the most is taken, until none cross. Of fingers crossing as many, the thumb, the one a hand most
 * lays across the others; else the more bent (points guessed wrong kink: a ring finger's tip found on the middle
 * finger's turned it 74°, and the straight middle finger was taken). Not bent over the thumb: curled fingers bend
 * a lot by right.
 * One seen held out is neither taken nor counted: rising from its knuckle it crosses the fist's folded fingers,
 * which are drawn in front.
 */
export function hiddenFingersOf(h: P2[], shown: readonly number[]): number[] {
  const chains = [[0, 1, 2, 3, 4], ...[5, 9, 13, 17].map((f) => [0, f, f + 1, f + 2, f + 3])]
  const bones = chains.map((chain, ci) => {
    const from = ci === 0 ? 0 : 1
    return chain.slice(from, -1).map((a, i) => [h[a], h[chain[from + i + 1]]] as const)
  })
  const side = (a: P2, b: P2, c: P2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const crosses = (f: number, g: number) =>
    bones[f].some(([p, q]) => bones[g].some(([r, t]) => side(p, q, r) * side(p, q, t) < 0 && side(r, t, p) * side(r, t, q) < 0))
  const bent = chains.map((chain) => {
    let sum = 0
    for (let i = 2; i < chain.length; i += 1) {
      const a = sub2(h[chain[i - 1]], h[chain[i - 2]])
      const b = sub2(h[chain[i]], h[chain[i - 1]])
      sum += Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]))
    }
    return sum
  })
  const out: number[] = []
  for (;;) {
    const n = [0, 1, 2, 3, 4].map((f) =>
      out.includes(f) || shown.includes(f) ? -1 : [0, 1, 2, 3, 4].filter((g) => g !== f && !out.includes(g) && !shown.includes(g) && crosses(f, g)).length)
    const most = Math.max(...n)
    if (most < 1) return out
    const tied = [0, 1, 2, 3, 4].filter((f) => n[f] === most)
    out.push(tied.includes(0) ? 0 : tied.reduce((a, b) => (bent[b] > bent[a] ? b : a)))
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

/**
 * A finger the pose model found curled where the drawing holds it out (a pointing finger read as folded into the
 * fist): the drawn skin runs on well past every point it found, as narrow as a finger. That finger is laid straight
 * along it from its knuckle. Left as found, the cut and the modelled hand both stopped at the fist.
 */
export function extendFinger(found: P2[], changed: Uint8Array, img: ArrayLike<number>, W: number, H: number): { hand: P2[]; laid: number | null } {
  const kept = { hand: found, laid: null }
  const size = dist2(found[9], found[0])
  if (size < 8) return kept
  const dir = unit2(sub2(found[9], found[0]))
  const nrm: P2 = [-dir[1], dir[0]]
  const along = (q: P2) => dot2(sub2(q, found[0]), dir)
  const across = (q: P2) => dot2(sub2(q, found[0]), nrm)
  const knuckles = [5, 9, 13, 17]
  const centre = mul2(knuckles.reduce<P2>((s, i) => add2(s, found[i]), found[0]), 1 / 5)
  const box = cropAround(found, Math.ceil(1.4 * size), W, H)
  const color = (x: number, y: number): Anime25DVec3 => [img[(y * W + x) * 3], img[(y * W + x) * 3 + 1], img[(y * W + x) * 3 + 2]]
  // The hand's skin: what changed by its palm.
  const near: Anime25DVec3[] = []
  for (let y = Math.max(0, Math.floor(centre[1] - 0.25 * size)); y < Math.min(H, centre[1] + 0.25 * size); y += 1) {
    for (let x = Math.max(0, Math.floor(centre[0] - 0.25 * size)); x < Math.min(W, centre[0] + 0.25 * size); x += 1) {
      if (changed[y * W + x]) near.push(color(x, y))
    }
  }
  if (near.length < 20) return kept
  const tone = medianColor(near)
  const skin = new Uint8Array(box.w * box.h)
  for (let k = 0; k < skin.length; k += 1) {
    const x = box.x + (k % box.w)
    const y = box.y + ((k / box.w) | 0)
    skin[k] = changed[y * W + x] && dist3(color(x, y), tone) < 45 ? 1 : 0
  }
  // Across the lines drawn where a finger leaves the fist.
  const { labels } = components(closeSquare(skin, box.w, box.h, 7), box.w, box.h)
  const at = (q: P2) => {
    const x = Math.round(q[0]) - box.x
    const y = Math.round(q[1]) - box.y
    return x >= 0 && y >= 0 && x < box.w && y < box.h ? labels[y * box.w + x] : 0
  }
  const hand = new Set(knuckles.map((i) => at(found[i])).filter(Boolean))
  if (at(centre)) hand.add(at(centre))
  if (!hand.size) return kept
  const reach = Math.max(...found.map(along))
  const beyond: P2[] = []
  for (let k = 0; k < labels.length; k += 1) {
    if (!hand.has(labels[k]) || !skin[k]) continue
    const q: P2 = [box.x + (k % box.w), box.y + ((k / box.w) | 0)]
    if (along(q) > reach + 0.15 * size) beyond.push(q)
  }
  if (beyond.length < 20) return kept
  const tipAlong = percentile(beyond.map(along), 99)
  const side = beyond.map(across)
  // Out well past the fist, and a finger's width across (not the back of a hand turned toward the viewer).
  if (tipAlong < reach + 0.35 * size || percentile(side, 90) - percentile(side, 10) > 0.45 * size) return kept
  const mid = median(side)
  const knuckle = knuckles.reduce((best, i) => (Math.abs(across(found[i]) - mid) < Math.abs(across(found[best]) - mid) ? i : best))
  const top = beyond.filter((q) => along(q) >= tipAlong - 3)
  const tip = mul2(top.reduce<P2>((s, q) => add2(s, q), [0, 0]), 1 / top.length)
  const out = found.map((q) => [q[0], q[1]] as P2)
  const k = found[knuckle]
  const end = add2(tip, mul2(unit2(sub2(k, tip)), LINE_HALF))
  for (const [i, t] of [[1, 0.45], [2, 0.75], [3, 1]] as const) out[knuckle + i] = add2(k, mul2(sub2(end, k), t))
  return { hand: out, laid: (knuckle - 1) / 4 }
}
