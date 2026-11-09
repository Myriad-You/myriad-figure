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
export const HAND_CHAINS = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [0, 9, 10, 11, 12], [0, 13, 14, 15, 16], [0, 17, 18, 19, 20]]
