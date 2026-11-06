import type { Anime25DVec3 } from '../anime25drig/types'

/** Pixel and geometry helpers for measuring a drawn arm (armModel, armHand), on a w × h grid of row-major pixels. */

export type P2 = [number, number]

/** Half the drawn width across the bone a → b (how far `inside` runs either side of it) at n places along it. */
export function widths(inside: (x: number, y: number) => boolean, a: P2, b: P2, n: number): number[] {
  const d = unit2(sub2(b, a))
  const nrm: P2 = [-d[1], d[0]]
  return linspace(0.08, 0.92, n).map((t) => {
    const c = add2(a, mul2(sub2(b, a), t))
    const reach = [1, -1].map((sgn) => {
      let r = 0
      for (let step = 1; step < 260; step += 1) {
        if (!inside(Math.trunc(c[0] + nrm[0] * sgn * step), Math.trunc(c[1] + nrm[1] * sgn * step))) break
        r = step
      }
      return r
    })
    return (reach[0] + reach[1]) / 2
  })
}

/** Closed rings where `field` crosses `level` (marching squares, the field taken as 0 off the grid). */
export function rings(field: Float32Array, w: number, h: number, level: number): P2[][] {
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? field[y * w + x] : 0)
  const W1 = w + 2
  const hEdge = (x: number, y: number) => ((y + 1) * W1 + x + 1) * 2
  const vEdge = (x: number, y: number) => ((y + 1) * W1 + x + 1) * 2 + 1
  const points = new Map<number, P2>()
  const point = (id: number, ax: number, ay: number, bx: number, by: number) => {
    let p = points.get(id)
    if (!p) {
      const a = at(ax, ay)
      const b = at(bx, by)
      const t = a === b ? 0.5 : (level - a) / (b - a)
      p = [ax + (bx - ax) * t, ay + (by - ay) * t]
      points.set(id, p)
    }
    return id
  }
  const segments: Array<[number, number]> = []
  for (let y = -1; y < h; y += 1) {
    for (let x = -1; x < w; x += 1) {
      const tl = at(x, y) >= level
      const tr = at(x + 1, y) >= level
      const br = at(x + 1, y + 1) >= level
      const bl = at(x, y + 1) >= level
      const code = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0)
      if (code === 0 || code === 15) continue
      const top = () => point(hEdge(x, y), x, y, x + 1, y)
      const bottom = () => point(hEdge(x, y + 1), x, y + 1, x + 1, y + 1)
      const left = () => point(vEdge(x, y), x, y, x, y + 1)
      const right = () => point(vEdge(x + 1, y), x + 1, y, x + 1, y + 1)
      // Diagonal corners inside join (as 8-connected regions do) when the cell's middle is inside too.
      const joined = (at(x, y) + at(x + 1, y) + at(x + 1, y + 1) + at(x, y + 1)) / 4 >= level
      switch (code) {
        case 1: case 14: segments.push([left(), bottom()]); break
        case 2: case 13: segments.push([bottom(), right()]); break
        case 3: case 12: segments.push([left(), right()]); break
        case 4: case 11: segments.push([top(), right()]); break
        case 6: case 9: segments.push([top(), bottom()]); break
        case 7: case 8: segments.push([left(), top()]); break
        case 5:
          if (joined) segments.push([left(), top()], [bottom(), right()])
          else segments.push([top(), right()], [left(), bottom()])
          break
        case 10:
          if (joined) segments.push([top(), right()], [left(), bottom()])
          else segments.push([left(), top()], [bottom(), right()])
          break
      }
    }
  }
  const byEdge = new Map<number, number[]>()
  segments.forEach(([a, b], i) => {
    for (const e of [a, b]) {
      const list = byEdge.get(e)
      if (list) list.push(i)
      else byEdge.set(e, [i])
    }
  })
  const used = new Uint8Array(segments.length)
  const out: P2[][] = []
  for (let start = 0; start < segments.length; start += 1) {
    if (used[start]) continue
    const ring: P2[] = []
    let seg = start
    let edge = segments[start][0]
    while (!used[seg]) {
      used[seg] = 1
      ring.push(points.get(edge)!)
      edge = segments[seg][0] === edge ? segments[seg][1] : segments[seg][0]
      seg = (byEdge.get(edge) ?? []).find((s) => !used[s]) ?? seg
    }
    if (ring.length >= 3) out.push(ring)
  }
  return out
}

/** A closed ring with the points that stray less than `tolerance` from it dropped (Douglas–Peucker). */
export function simplify(ring: P2[], tolerance: number): P2[] {
  if (ring.length < 4) return ring
  let far = 0
  for (let i = 1; i < ring.length; i += 1) {
    if (dist2(ring[i], ring[0]) > dist2(ring[far], ring[0])) far = i
  }
  const keep = new Uint8Array(ring.length + 1)
  const span = (a: number, b: number) => {
    const stack = [[a, b]]
    while (stack.length) {
      const [i, j] = stack.pop()!
      let most = -1
      let at = -1
      for (let k = i + 1; k < j; k += 1) {
        const d = segmentDistance(ring[k % ring.length], ring[i % ring.length], ring[j % ring.length])
        if (d > most) {
          most = d
          at = k
        }
      }
      if (most > tolerance) {
        keep[at] = 1
        stack.push([i, at], [at, j])
      }
    }
  }
  keep[0] = 1
  keep[far] = 1
  span(0, far)
  span(far, ring.length)
  return ring.filter((_, i) => keep[i]).map(([x, y]) => [round(x, 2), round(y, 2)])
}

/** n points spaced evenly along a closed ring, from its first point. */
export function resample(ring: P2[], n: number): P2[] {
  const closed = [...ring, ring[0]]
  const at = [0]
  for (let i = 1; i < closed.length; i += 1) at.push(at[i - 1] + dist2(closed[i], closed[i - 1]))
  const total = at[at.length - 1]
  return Array.from({ length: n }, (_, k) => {
    const s = (k / n) * total
    const i = Math.max(0, Math.min(closed.length - 2, searchLeft(at, s) - 1))
    const t = (s - at[i]) / Math.max(1e-9, at[i + 1] - at[i])
    return add2(closed[i], mul2(sub2(closed[i + 1], closed[i]), t))
  })
}

export function area(ring: P2[]): number {
  let sum = 0
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length]
    sum += p[0] * q[1] - q[0] * p[1]
  })
  return sum / 2
}

/** Pixels (whole coordinates) inside the convex hull of `points`, edges included. */
export function convexMask(points: readonly P2[], w: number, h: number): Uint8Array {
  const hull = convexHull(points.map((q) => [Math.trunc(q[0]), Math.trunc(q[1])] as P2))
  const out = new Uint8Array(w * h)
  const ys = hull.map((q) => q[1])
  for (let y = Math.max(0, Math.min(...ys)); y <= Math.min(h - 1, Math.max(...ys)); y += 1) {
    const xs: number[] = []
    hull.forEach((a, i) => {
      const b = hull[(i + 1) % hull.length]
      if (y < Math.min(a[1], b[1]) || y > Math.max(a[1], b[1])) return
      if (a[1] === b[1]) xs.push(a[0], b[0])
      else xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]))
    })
    if (!xs.length) continue
    for (let x = Math.max(0, Math.ceil(Math.min(...xs) - 1e-6)); x <= Math.min(w - 1, Math.floor(Math.max(...xs) + 1e-6)); x += 1) out[y * w + x] = 1
  }
  return out
}

export function convexHull(points: P2[]): P2[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (pts.length < 3) return pts
  const turn = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: P2[] = []
  for (const p of pts) {
    while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: P2[] = []
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

/** The convex hull of `points` grown by a square `grow` across, on a patch of the grid. */
export function convexPatch(points: readonly P2[], grow: number, w: number, h: number) {
  const box = cropAround(points, (grow >> 1) + 2, w, h)
  const local = dilateSquare(convexMask(points.map((q) => [q[0] - box.x, q[1] - box.y] as P2), box.w, box.h), box.w, box.h, grow)
  const at = (x: number, y: number) => {
    const lx = x - box.x
    const ly = y - box.y
    return lx >= 0 && ly >= 0 && lx < box.w && ly < box.h && local[ly * box.w + lx] > 0
  }
  return { ...box, at }
}

/** The bounding box of a mask, a pixel round it. */
export function cropOf(mask: Uint8Array, w: number, h: number) {
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!mask[y * w + x]) continue
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w: 1, h: 1 }
  const x = Math.max(0, x0 - 1)
  const y = Math.max(0, y0 - 1)
  return { x, y, w: Math.min(w, x1 + 2) - x, h: Math.min(h, y1 + 2) - y }
}

/** Pixels within `radius` of the segment a–b (a thick line with round ends). */
export function capsuleMask(a: P2, b: P2, radius: number, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h)
  const ta: P2 = [Math.trunc(a[0]), Math.trunc(a[1])]
  const tb: P2 = [Math.trunc(b[0]), Math.trunc(b[1])]
  const r = Math.ceil(radius)
  for (let y = Math.max(0, Math.min(ta[1], tb[1]) - r); y <= Math.min(h - 1, Math.max(ta[1], tb[1]) + r); y += 1) {
    for (let x = Math.max(0, Math.min(ta[0], tb[0]) - r); x <= Math.min(w - 1, Math.max(ta[0], tb[0]) + r); x += 1) {
      if (segmentDistance([x, y], ta, tb) <= radius) out[y * w + x] = 1
    }
  }
  return out
}

/** The bounding box of `points` grown by `margin`, on the grid. */
export function cropAround(points: readonly P2[], margin: number, w: number, h: number) {
  const x = Math.max(0, Math.floor(Math.min(...points.map((q) => q[0]))) - margin)
  const y = Math.max(0, Math.floor(Math.min(...points.map((q) => q[1]))) - margin)
  const x1 = Math.min(w, Math.ceil(Math.max(...points.map((q) => q[0]))) + margin)
  const y1 = Math.min(h, Math.ceil(Math.max(...points.map((q) => q[1]))) + margin)
  return { x, y, w: Math.max(1, x1 - x), h: Math.max(1, y1 - y) }
}

/** 8-connected components of a mask; label 0 is unset. */
export function components(mask: Uint8Array, w: number, h: number): { labels: Int32Array; sizes: number[] } {
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
      const p = stack[--top]
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

/** Each row's mask grown (or shrunk) by `half` either side, off the grid counted as `outside`. */
export function rowSpread(mask: Uint8Array, w: number, h: number, half: number, grow: boolean): Uint8Array {
  const out = new Uint8Array(w * h)
  const sum = new Int32Array(w + 1)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) sum[x + 1] = sum[x] + mask[y * w + x]
    for (let x = 0; x < w; x += 1) {
      const a = Math.max(0, x - half)
      const b = Math.min(w - 1, x + half)
      const count = sum[b + 1] - sum[a]
      // Shrinking, what lies off the grid does not count against a pixel.
      out[y * w + x] = grow ? (count > 0 ? 1 : 0) : count === b - a + 1 ? 1 : 0
    }
  }
  return out
}

/** Grown or shrunk by an ellipse `size` across (OpenCV's MORPH_ELLIPSE). */
export function morphEllipse(mask: Uint8Array, w: number, h: number, size: number, grow: boolean): Uint8Array {
  const r = size >> 1
  const rows = new Map<number, Uint8Array>()
  const out = new Uint8Array(w * h).fill(grow ? 0 : 1)
  for (let dy = -r; dy <= r; dy += 1) {
    const half = Math.round(Math.sqrt(r * r - dy * dy))
    let spread = rows.get(half)
    if (!spread) {
      spread = rowSpread(mask, w, h, half, grow)
      rows.set(half, spread)
    }
    for (let y = 0; y < h; y += 1) {
      const sy = y + dy
      if (sy < 0 || sy >= h) continue
      for (let x = 0; x < w; x += 1) {
        if (grow) {
          if (spread[sy * w + x]) out[y * w + x] = 1
        } else if (!spread[sy * w + x]) {
          out[y * w + x] = 0
        }
      }
    }
  }
  return out
}

export const dilateEllipse = (mask: Uint8Array, w: number, h: number, size: number) => morphEllipse(mask, w, h, size, true)
export const erodeEllipse = (mask: Uint8Array, w: number, h: number, size: number) => morphEllipse(mask, w, h, size, false)

export function transpose(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) out[x * h + y] = mask[y * w + x]
  }
  return out
}

export function morphSquare(mask: Uint8Array, w: number, h: number, size: number, grow: boolean): Uint8Array {
  const half = size >> 1
  const across = rowSpread(mask, w, h, half, grow)
  return transpose(rowSpread(transpose(across, w, h), h, w, half, grow), h, w)
}

export const dilateSquare = (mask: Uint8Array, w: number, h: number, size: number) => morphSquare(mask, w, h, size, true)
export function closeSquare(mask: Uint8Array, w: number, h: number, size: number): Uint8Array {
  return morphSquare(morphSquare(mask, w, h, size, true), w, h, size, false)
}

/** Closes what the mask encloses: everything the grid's edge cannot reach (4-connected) is inside. */
export function fillHoles(mask: Uint8Array, w: number, h: number): void {
  const outside = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  let top = 0
  const visit = (p: number) => {
    if (mask[p] || outside[p]) return
    outside[p] = 1
    stack[top++] = p
  }
  for (let x = 0; x < w; x += 1) {
    visit(x)
    visit((h - 1) * w + x)
  }
  for (let y = 0; y < h; y += 1) {
    visit(y * w)
    visit(y * w + w - 1)
  }
  while (top > 0) {
    const p = stack[--top]
    const x = p % w
    if (x > 0) visit(p - 1)
    if (x < w - 1) visit(p + 1)
    if (p >= w) visit(p - w)
    if (p < (h - 1) * w) visit(p + w)
  }
  for (let p = 0; p < w * h; p += 1) {
    if (!outside[p]) mask[p] = 1
  }
}

export function toFloat(mask: Uint8Array): Float32Array {
  return Float32Array.from(mask)
}

/**
 * Gaussian blur as OpenCV does it on floats: 8σ + 1 taps, edges mirrored without repeating the edge (or, with
 * `wrap`, the rows running round).
 */
export function gaussian(image: Float32Array, w: number, h: number, sigma: number, wrap = false): Float32Array {
  const size = Math.round(sigma * 8 + 1) | 1
  const r = size >> 1
  const kernel = new Float32Array(size)
  let total = 0
  for (let i = 0; i < size; i += 1) {
    kernel[i] = Math.exp(-((i - r) ** 2) / (2 * sigma * sigma))
    total += kernel[i]
  }
  for (let i = 0; i < size; i += 1) kernel[i] /= total
  // Where each tap lands, from r before the first pixel to r past the last.
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
      for (let k = 0; k < size; k += 1) sum += image[row + xs[x + k]] * kernel[k]
      pass[row + x] = sum
    }
  }
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let sum = 0
      for (let k = 0; k < size; k += 1) sum += pass[ys[y + k] * w + x] * kernel[k]
      out[y * w + x] = sum
    }
  }
  return out
}

export function texel(data: ArrayLike<number>, k: number): Anime25DVec3 {
  return [data[k * 3], data[k * 3 + 1], data[k * 3 + 2]]
}

export function median(values: readonly number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function medianColor(colors: readonly Anime25DVec3[]): Anime25DVec3 {
  return [0, 1, 2].map((ch) => median(colors.map((c) => c[ch]))) as Anime25DVec3
}

/** numpy's percentile: linear between the two nearest ranks. */
export function percentile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const at = ((sorted.length - 1) * q) / 100
  const lo = Math.floor(at)
  const hi = Math.min(sorted.length - 1, lo + 1)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo)
}

export function linspace(a: number, b: number, n: number): number[] {
  if (n === 1) return [a]
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1))
}

/** numpy's interp: piecewise linear through (xs, ys), held at the ends. */
export function interp(x: number, xs: readonly number[], ys: readonly number[]): number {
  if (x <= xs[0]) return ys[0]
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1]
  const i = searchLeft(xs, x) - 1
  return ys[i] + ((ys[i + 1] - ys[i]) * (x - xs[i])) / (xs[i + 1] - xs[i])
}

/** The first index whose value is not below `x` (numpy's searchsorted, side left). */
export function searchLeft(sorted: readonly number[], x: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] < x) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function segmentDistance(c: P2, a: P2, b: P2): number {
  const d = sub2(b, a)
  const t = Math.min(1, Math.max(0, dot2(sub2(c, a), d) / Math.max(1e-12, dot2(d, d))))
  return dist2(c, add2(a, mul2(d, t)))
}

export function round(x: number, digits: number): number {
  const k = 10 ** digits
  return Math.round(x * k) / k
}

export const add2 = (a: P2, b: P2): P2 => [a[0] + b[0], a[1] + b[1]]
export const sub2 = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]]
export const mul2 = (a: P2, k: number): P2 => [a[0] * k, a[1] * k]
export const dot2 = (a: P2, b: P2) => a[0] * b[0] + a[1] * b[1]
export const dist2 = (a: P2, b: P2) => Math.hypot(a[0] - b[0], a[1] - b[1])
export const unit2 = (a: P2): P2 => mul2(a, 1 / (Math.hypot(a[0], a[1]) || 1))
export const add3 = (a: Anime25DVec3, b: Anime25DVec3): Anime25DVec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub3 = (a: Anime25DVec3, b: Anime25DVec3): Anime25DVec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const mul3 = (a: Anime25DVec3, k: number): Anime25DVec3 => [a[0] * k, a[1] * k, a[2] * k]
export const dist3 = (a: Anime25DVec3, b: Anime25DVec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
export const unit3 = (a: Anime25DVec3): Anime25DVec3 => mul3(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1))
export function cross3(a: Anime25DVec3, b: Anime25DVec3): Anime25DVec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
