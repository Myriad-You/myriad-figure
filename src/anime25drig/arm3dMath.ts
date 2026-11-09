/** Small 3D vector helpers for the modelled gesture arm (x right, y down, z toward the viewer). */
export type V3 = [number, number, number]

export function add(a: V3, b: V3): V3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

export function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

export function mul(a: V3, k: number): V3 {
  return [a[0] * k, a[1] * k, a[2] * k]
}

export function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

export function len(a: V3): number {
  return Math.hypot(a[0], a[1], a[2])
}

export function norm(a: V3): V3 {
  return mul(a, 1 / (len(a) || 1))
}

export function lerp(a: V3, b: V3, t: number): V3 {
  return add(a, mul(sub(b, a), t))
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** Between two unit directions along the great circle. */
export function slerp(a: V3, b: V3, t: number): V3 {
  const c = Math.max(-1, Math.min(1, dot(a, b)))
  if (c > 0.9995) return norm(lerp(a, b, t))
  const th = Math.acos(c)
  const s = Math.sin(th)
  return add(mul(a, Math.sin((1 - t) * th) / s), mul(b, Math.sin(t * th) / s))
}

/** v turned by the least turn that takes direction a to direction b. */
export function carry(v: V3, a: V3, b: V3): V3 {
  const ax = cross(a, b)
  const sn = len(ax)
  const co = dot(a, b)
  if (sn < 1e-9) return v
  const k = mul(ax, 1 / sn)
  return add(add(mul(v, co), mul(cross(k, v), sn)), mul(k, dot(k, v) * (1 - co)))
}

/** v turned about the view axis (z) by a, in the picture's plane. */
export function spin(v: V3, a: number): V3 {
  return [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a), v[2]]
}

/** Cubic B-spline: near the points, not through them. */
export function bspline(p0: V3, p1: V3, p2: V3, p3: V3, u: number): V3 {
  const a = (1 - u) ** 3
  const b = 3 * u ** 3 - 6 * u ** 2 + 4
  const c = -3 * u ** 3 + 3 * u ** 2 + 3 * u + 1
  const d = u ** 3
  return [0, 1, 2].map((i) => (p0[i] * a + p1[i] * b + p2[i] * c + p3[i] * d) / 6) as V3
}

/** Catmull–Rom: through the points. */
export function catmull(p0: V3, p1: V3, p2: V3, p3: V3, t: number): V3 {
  const t2 = t * t
  const t3 = t2 * t
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]), f(p0[2], p1[2], p2[2], p3[2])]
}

/** COCO-WholeBody's hand: the thumb and four fingers, each from the wrist (0) to its tip. */
/**
 * The turn, scale and shift taking points `from` nearest to `to` in x, y (least squares), as its two rows: x' = r0 · (x, y, 1),
 * y' = r1 · (x, y, 1). Null for points all in one place.
 */
export function similarity2D(from: readonly V3[], to: readonly V3[]): [V3, V3] | null {
  const n = Math.min(from.length, to.length)
  if (n === 0) return null
  let fx = 0
  let fy = 0
  let tx = 0
  let ty = 0
  for (let i = 0; i < n; i += 1) {
    fx += from[i][0] / n
    fy += from[i][1] / n
    tx += to[i][0] / n
    ty += to[i][1] / n
  }
  let along = 0
  let across = 0
  let spread = 0
  for (let i = 0; i < n; i += 1) {
    const ax = from[i][0] - fx
    const ay = from[i][1] - fy
    const bx = to[i][0] - tx
    const by = to[i][1] - ty
    along += ax * bx + ay * by
    across += ax * by - ay * bx
    spread += ax * ax + ay * ay
  }
  if (spread <= 0) return null
  const a = along / spread
  const b = across / spread
  return [[a, -b, tx - a * fx + b * fy], [b, a, ty - b * fx - a * fy]]
}

/** How nearly the hand is in the drawn shape on screen, turned whole in the picture's plane (1 within `full` trial pixels, 0 from `none`). */
export function handExactness(drawn: V3[], hand: V3[], px: number, full: number, none: number): number {
  const rel = (h: V3[], i: number) => [h[i][0] - h[0][0], h[i][1] - h[0][1]]
  let sx = 0
  let sc = 0
  for (let i = 1; i < drawn.length; i += 1) {
    const [ax, ay] = rel(drawn, i)
    const [bx, by] = rel(hand, i)
    sc += ax * bx + ay * by
    sx += ax * by - ay * bx
  }
  const th = Math.atan2(sx, sc)
  const co = Math.cos(th)
  const si = Math.sin(th)
  let worst = 0
  for (let i = 1; i < drawn.length; i += 1) {
    const [ax, ay] = rel(drawn, i)
    const [bx, by] = rel(hand, i)
    worst = Math.max(worst, Math.hypot(bx - (co * ax - si * ay), by - (si * ax + co * ay)) / px)
  }
  return 1 - Math.min(1, Math.max(0, (worst - full) / (none - full)))
}

export const HAND_CHAINS = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [0, 9, 10, 11, 12], [0, 13, 14, 15, 16], [0, 17, 18, 19, 20]]
