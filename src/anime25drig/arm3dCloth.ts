import type { V3 } from './arm3dMath'
import { smoothstep } from './arm3dMath'

/**
 * A figure's cloth that lies on its upper arm without being the arm's (a cape off the shoulder), as a piece of
 * its own: cut out of the layer that draws it, hung from where it was cut, and moved as cloth is, by its weight
 * and by the arm under it. Left in its layer it stayed hanging in the air over a lifted arm; turned about the
 * shoulder with the arm it was a board, parted from the coat at one end and from the arm at the other.
 */

/** A pixel this opaque is drawn. */
const DRAWN = 16
/** The cut reaches this far above the shoulder and below the elbow (shares of the upper arm). */
const ABOVE = -0.25
const BELOW = 1.6
/** And this far toward the body from the arm's axis (shares of its radius): what lies further in is the body's. */
const INWARD = 0.9
/** The piece's picture goes on this many pixels past the cut, under what it was cut from. */
const OVERLAP = 3

export interface Arm3DClothCut {
  /** Per pixel of the layer: 1 the cloth, 2 the layer's own just past the cut (in both pictures), 3 the cloth's soft rim; 0 not the piece's. */
  piece: Uint8Array
  /** 1 on the cloth's pixels that touch what they were cut from. */
  seam: Uint8Array
  /** The piece's pixels lie within these (the far sides excluded). */
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * The cloth in a layer's picture (`rgba`, `width` × `height`) that lies on the outer half of the upper arm
 * from shoulder `s` to elbow `e` (the layer's pixels), `radius` thick, on the picture's side `side` (1 right, -1
 * left): all that is drawn joined to it, short of the body. Null where no cloth lies there.
 */
export function cutArm3DCloth(rgba: ArrayLike<number>, width: number, height: number, s: readonly number[], e: readonly number[], radius: number, side: number): Arm3DClothCut | null {
  const dx = e[0] - s[0]
  const dy = e[1] - s[1]
  const length = Math.hypot(dx, dy)
  if (length < 4 || radius < 2) return null
  const ux = dx / length
  const uy = dy / length
  const piece = new Uint8Array(width * height)
  const stack = new Int32Array(width * height)
  let top = 0
  let seeds = 0
  // 1 may be the cloth's, 2 a place it is sure to be (over the outer half of the upper arm).
  const may = (p: number): number => {
    if (rgba[p * 4 + 3] < DRAWN) return 0
    const x = p % width - s[0]
    const y = Math.floor(p / width) - s[1]
    const t = (x * ux + y * uy) / length
    const out = side * (uy * x - ux * y)
    if (t <= ABOVE || t >= BELOW || out <= -INWARD * radius) return 0
    return t > 0.2 && t < 0.6 && out > 0 && out < radius ? 2 : 1
  }
  const x0 = Math.max(0, Math.floor(Math.min(s[0], e[0]) - radius))
  const x1 = Math.min(width, Math.ceil(Math.max(s[0], e[0]) + radius) + 1)
  const y0 = Math.max(0, Math.floor(Math.min(s[1], e[1]) - radius))
  const y1 = Math.min(height, Math.ceil(Math.max(s[1], e[1]) + radius) + 1)
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const p = y * width + x
      if (may(p) !== 2) continue
      piece[p] = 1
      stack[top++] = p
      seeds += 1
    }
  }
  // Cloth on a good part of it, not the edge of a coat beside the arm.
  if (seeds < 0.25 * 0.4 * length * radius) return null
  const next = (p: number, k: number): number => {
    const x = p % width
    if (k === 0) return x > 0 ? p - 1 : -1
    if (k === 1) return x < width - 1 ? p + 1 : -1
    if (k === 2) return p >= width ? p - width : -1
    return p < width * (height - 1) ? p + width : -1
  }
  while (top > 0) {
    const p = stack[--top]
    for (let k = 0; k < 4; k += 1) {
      const q = next(p, k)
      if (q < 0 || piece[q] || !may(q)) continue
      piece[q] = 1
      stack[top++] = q
    }
  }
  // Past the cut: what is drawn there is the layer's still (the piece's picture goes on under it, no gap between
  // the two as they part); what is not is the cloth's soft rim, and goes with it.
  const seam = new Uint8Array(width * height)
  let front: number[] = []
  for (let p = 0; p < piece.length; p += 1) {
    if (piece[p] === 1) front.push(p)
  }
  for (let round = 0; round < OVERLAP; round += 1) {
    const grown: number[] = []
    for (const p of front) {
      for (let k = 0; k < 4; k += 1) {
        const q = next(p, k)
        if (q < 0 || piece[q]) continue
        const drawn = rgba[q * 4 + 3] >= DRAWN
        if (drawn && piece[p] === 1) seam[p] = 1
        // A soft rim does not lead on into another thing drawn beside the cloth.
        if (drawn && piece[p] === 3) continue
        piece[q] = drawn ? 2 : 3
        grown.push(q)
      }
    }
    front = grown
  }
  const box = { x0: width, y0: height, x1: 0, y1: 0 }
  for (let p = 0; p < piece.length; p += 1) {
    if (!piece[p]) continue
    const x = p % width
    const y = Math.floor(p / width)
    box.x0 = Math.min(box.x0, x)
    box.x1 = Math.max(box.x1, x + 1)
    box.y0 = Math.min(box.y0, y)
    box.y1 = Math.max(box.y1, y + 1)
  }
  return { piece, seam, ...box }
}

export interface Arm3DClothMesh {
  /** The nodes in the layer's pixels (x, y pairs). */
  pos: Float32Array
  idx: Uint16Array
  /** How far each node is from the seam, in grid cells (Infinity without a seam). */
  fromSeam: Float32Array
  /** Pairs of nodes kept apart as they rest: along the grid and across its cells, then every other one along it. */
  links: Uint32Array
  /** How many of `links`' pairs are the first kind. */
  near: number
}

/** A grid of `spacing` over the piece: the cells that hold any of it. Null for one too small or too large to be a cloth. */
export function arm3DClothMesh(cut: Arm3DClothCut, width: number, spacing: number): Arm3DClothMesh | null {
  const nx = Math.ceil((cut.x1 - cut.x0) / spacing)
  const ny = Math.ceil((cut.y1 - cut.y0) / spacing)
  if (nx < 2 || ny < 2) return null
  const cells = new Uint8Array(nx * ny)
  const seams: number[] = []
  for (let y = cut.y0; y < cut.y1; y += 1) {
    for (let x = cut.x0; x < cut.x1; x += 1) {
      const p = y * width + x
      if (!cut.piece[p]) continue
      cells[Math.floor((y - cut.y0) / spacing) * nx + Math.floor((x - cut.x0) / spacing)] = 1
      if (cut.seam[p]) seams.push(x, y)
    }
  }
  const node = new Int32Array((nx + 1) * (ny + 1)).fill(-1)
  const pos: number[] = []
  const at = (i: number, j: number): number => {
    const k = j * (nx + 1) + i
    if (node[k] < 0) {
      node[k] = pos.length / 2
      pos.push(cut.x0 + i * spacing, cut.y0 + j * spacing)
    }
    return node[k]
  }
  const idx: number[] = []
  const seen = new Set<number>()
  const links: number[] = []
  const link = (a: number, b: number) => {
    const key = Math.min(a, b) * 65536 + Math.max(a, b)
    if (seen.has(key)) return
    seen.add(key)
    links.push(a, b)
  }
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      if (!cells[j * nx + i]) continue
      const a = at(i, j)
      const b = at(i + 1, j)
      const c = at(i, j + 1)
      const d = at(i + 1, j + 1)
      idx.push(a, b, c, b, d, c)
      link(a, b)
      link(a, c)
      link(b, d)
      link(c, d)
      link(a, d)
      link(b, c)
    }
  }
  const count = pos.length / 2
  if (count < 9 || count > 65535) return null
  const near = links.length / 2
  const has = (i: number, j: number) => i <= nx && j <= ny ? node[j * (nx + 1) + i] : -1
  for (let j = 0; j <= ny; j += 1) {
    for (let i = 0; i <= nx; i += 1) {
      const a = has(i, j)
      if (a < 0) continue
      if (has(i + 1, j) >= 0 && has(i + 2, j) >= 0) link(a, has(i + 2, j))
      if (has(i, j + 1) >= 0 && has(i, j + 2) >= 0) link(a, has(i, j + 2))
    }
  }
  const fromSeam = new Float32Array(count).fill(Infinity)
  for (let k = 0; k < count; k += 1) {
    let least = Infinity
    for (let q = 0; q < seams.length; q += 2) {
      const d = (seams[q] - pos[k * 2]) ** 2 + (seams[q + 1] - pos[k * 2 + 1]) ** 2
      if (d < least) least = d
    }
    fromSeam[k] = Math.sqrt(least) / spacing
  }
  return { pos: Float32Array.from(pos), idx: Uint16Array.from(idx), fromSeam, links: Uint32Array.from(links), near }
}

/**
 * How far toward the viewer cloth lies at `d` from a limb's axis as it hangs over it, the limb `r` thick: over
 * the limb and off it in a slope (a round limb's own side is a wall, and cloth laid down it had that much more
 * of itself there than its picture shows).
 */
export function arm3DClothOver(d: number, r: number): number {
  const k = d / (2 * r)
  return k >= 1 ? 0 : r * (1 - k * k) ** 2
}

/** A limb the cloth lies on: round, from `a` to `b`. */
export interface Arm3DClothLimb {
  a: V3
  b: V3
  r: number
  /** The cloth is worn over this one: whatever of it crosses the limb on the picture lies on the viewer's side of it. */
  worn?: boolean
}

/** The longest step taken at once (seconds): a frame is as many as it needs. */
const STEP = 1 / 240
const MOST_STEPS = 12
const ROUNDS = 8
/** How stiffly it keeps its lengths, and its flatness (every other node's distance). */
const STIFF = 0.9
const FLAT = 0.6
/** The fall of a thing let go, in upper arms a second squared (an upper arm about 0.3 m). */
const FALL = 33
/** The air's hold on it (a second): little along its own surface, much against its face (it sails, and swings on edge). */
const AIR = 0.9
const SAIL = 9
/** How much of its slide along the limb is lost at each touch. */
const RUB = 0.6
/** How fast it goes back to where it was drawn once the arm hangs again (a second). */
const BACK = 14
/** It is never further from what holds it than this much more than it was drawn. */
const REACH = 1.04

/**
 * The cloth's nodes as weights joined at their drawn distances: each frame they fall, are held where they are
 * fixed, kept off the limbs under them, and kept as far from each other as drawn.
 */
export class Arm3DClothSim {
  /** Where the nodes are (x, y, z triples; z toward the viewer). */
  readonly x: Float32Array
  private was: Float32Array
  private held: Float32Array
  private long: Float32Array
  private tether: Int32Array
  private tetherLong: Float32Array
  private limbs: Arm3DClothLimb[] | null = null
  private blown: Float32Array

  /**
   * `rest`, the nodes as drawn; `pin`, how fixed each is (1 goes wherever it is told, 0 is free); `links` and
   * `near` as the mesh gives them; `unit`, the upper arm's length; `faces`, its triangles (the air takes it by them).
   */
  constructor(rest: Float32Array, private pin: Float32Array, private links: Uint32Array, private near: number, private unit: number, private faces: ArrayLike<number> = []) {
    this.x = Float32Array.from(rest)
    this.was = Float32Array.from(rest)
    this.held = Float32Array.from(rest)
    this.blown = new Float32Array(rest.length / 3 * 4)
    this.long = new Float32Array(links.length / 2)
    for (let k = 0; k < this.long.length; k += 1) this.long[k] = dist(rest, links[k * 2], rest, links[k * 2 + 1])
    const count = pin.length
    this.tether = new Int32Array(count).fill(-1)
    this.tetherLong = new Float32Array(count)
    for (let i = 0; i < count; i += 1) {
      if (pin[i] >= 1) continue
      let least = Infinity
      for (let j = 0; j < count; j += 1) {
        if (pin[j] < 1) continue
        const d = dist(rest, i, rest, j)
        if (d < least) {
          least = d
          this.tether[i] = j
        }
      }
      this.tetherLong[i] = least * REACH
    }
  }

  /** At rest where it is told (`to`, as `x`), with nothing of an earlier motion in it. */
  reset(to: Float32Array): void {
    this.x.set(to)
    this.was.set(to)
    this.held.set(to)
    this.limbs = null
  }

  /**
   * `dt` on: the nodes are wanted at `to` (the fixed ones go there), the limbs lie as `limbs`; `active`, how far
   * the arm is from hanging (0 hanging: the cloth goes back to `to`, where it was drawn; 1: it is its own).
   */
  step(to: Float32Array, limbs: readonly Arm3DClothLimb[], active: number, dt: number): void {
    if (!(dt > 0)) return
    const { x, was, held, pin, links, long } = this
    const count = pin.length
    const steps = Math.max(1, Math.min(MOST_STEPS, Math.ceil(dt / STEP - 1e-6)))
    const h = dt / steps
    const from = this.limbs && this.limbs.length === limbs.length ? this.limbs : limbs
    const fall = FALL * this.unit * active * h * h
    const air = Math.exp(-AIR * h)
    const back = 1 - Math.exp(-(1 - active) * BACK * h)
    const sail = 1 - Math.exp(-SAIL * h)
    const now: Arm3DClothLimb[] = limbs.map((l) => ({ a: [0, 0, 0], b: [0, 0, 0], r: l.r, worn: l.worn }))
    const before: Arm3DClothLimb[] = limbs.map((l) => ({ a: [0, 0, 0], b: [0, 0, 0], r: l.r }))
    const want = new Float32Array(3)
    for (let s = 1; s <= steps; s += 1) {
      const f = s / steps
      for (let k = 0; k < limbs.length; k += 1) {
        for (let c = 0; c < 3; c += 1) {
          before[k].a[c] = from[k].a[c] + (limbs[k].a[c] - from[k].a[c]) * (s - 1) / steps
          before[k].b[c] = from[k].b[c] + (limbs[k].b[c] - from[k].b[c]) * (s - 1) / steps
          now[k].a[c] = from[k].a[c] + (limbs[k].a[c] - from[k].a[c]) * f
          now[k].b[c] = from[k].b[c] + (limbs[k].b[c] - from[k].b[c]) * f
        }
      }
      this.sail(sail)
      for (let i = 0; i < count; i += 1) {
        const o = i * 3
        if (pin[i] >= 1) {
          for (let c = 0; c < 3; c += 1) {
            was[o + c] = x[o + c]
            x[o + c] = held[o + c] + (to[o + c] - held[o + c]) * f
          }
          continue
        }
        for (let c = 0; c < 3; c += 1) {
          const v = (x[o + c] - was[o + c]) * air
          was[o + c] = x[o + c]
          x[o + c] += v
        }
        x[o + 1] += fall
      }
      for (let round = 0; round < ROUNDS; round += 1) {
        for (let k = 0; k < long.length; k += 1) {
          const a = links[k * 2]
          const b = links[k * 2 + 1]
          const wa = 1 - pin[a]
          const wb = 1 - pin[b]
          if (wa + wb <= 0) continue
          const ax = a * 3
          const bx = b * 3
          const dx = x[bx] - x[ax]
          const dy = x[bx + 1] - x[ax + 1]
          const dz = x[bx + 2] - x[ax + 2]
          const d = Math.hypot(dx, dy, dz)
          if (d < 1e-6) continue
          const by = (k < this.near ? STIFF : FLAT) * (d - long[k]) / d / (wa + wb)
          x[ax] += dx * by * wa
          x[ax + 1] += dy * by * wa
          x[ax + 2] += dz * by * wa
          x[bx] -= dx * by * wb
          x[bx + 1] -= dy * by * wb
          x[bx + 2] -= dz * by * wb
        }
        for (let i = 0; i < count; i += 1) {
          const j = this.tether[i]
          if (j < 0) continue
          const d = dist(x, i, x, j)
          const most = this.tetherLong[i]
          if (d <= most) continue
          for (let c = 0; c < 3; c += 1) x[i * 3 + c] = x[j * 3 + c] + (x[i * 3 + c] - x[j * 3 + c]) * most / d
        }
        for (let i = 0; i < count; i += 1) {
          if (pin[i] >= 1) continue
          const o = i * 3
          for (let k = 0; k < now.length; k += 1) {
            const limb = now[k]
            const u = along(x, o, limb)
            let nx = x[o] - (limb.a[0] + (limb.b[0] - limb.a[0]) * u)
            let ny = x[o + 1] - (limb.a[1] + (limb.b[1] - limb.a[1]) * u)
            let nz = x[o + 2] - (limb.a[2] + (limb.b[2] - limb.a[2]) * u)
            // (Worn over it, what got behind it is brought round to the front.)
            if (limb.worn && nz < 0 && Math.hypot(nx, ny) < limb.r) nz = -nz
            const d = Math.hypot(nx, ny, nz)
            if (d >= limb.r) continue
            // (On the axis itself: out toward the viewer.)
            if (d < 1e-6) {
              nx = 0
              ny = 0
              nz = 1
            }
            else {
              nx /= d
              ny /= d
              nz /= d
            }
            const cx = limb.a[0] + (limb.b[0] - limb.a[0]) * u
            const cy = limb.a[1] + (limb.b[1] - limb.a[1]) * u
            const cz = limb.a[2] + (limb.b[2] - limb.a[2]) * u
            x[o] = cx + nx * limb.r
            x[o + 1] = cy + ny * limb.r
            x[o + 2] = cz + nz * limb.r
            // It goes with the limb it lies on, less what slides.
            const old = before[k]
            let slide = 0
            for (let c = 0; c < 3; c += 1) {
              const moved = limb.a[c] + (limb.b[c] - limb.a[c]) * u - (old.a[c] + (old.b[c] - old.a[c]) * u)
              want[c] = x[o + c] - was[o + c] - moved
            }
            slide = want[0] * nx + want[1] * ny + want[2] * nz
            x[o] -= RUB * (want[0] - slide * nx)
            x[o + 1] -= RUB * (want[1] - slide * ny)
            x[o + 2] -= RUB * (want[2] - slide * nz)
          }
          // The body is behind it.
          if (x[o + 2] < 0) x[o + 2] = 0
        }
      }
      for (let i = 0; i < count; i += 1) {
        if (pin[i] >= 1) continue
        const hold = Math.max(pin[i], back)
        if (hold <= 0) continue
        const o = i * 3
        for (let c = 0; c < 3; c += 1) x[o + c] += (held[o + c] + (to[o + c] - held[o + c]) * f - x[o + c]) * hold
      }
    }
    held.set(to)
    this.limbs = limbs.map((l) => ({ a: [...l.a] as V3, b: [...l.b] as V3, r: l.r }))
  }

  /** The air against each face: `by` of every free node's speed across the faces it is a corner of is lost. */
  private sail(by: number): void {
    const { x, was, pin, faces, blown } = this
    if (!faces.length) return
    blown.fill(0)
    for (let t = 0; t < faces.length; t += 3) {
      const a = faces[t] * 3
      const b = faces[t + 1] * 3
      const c = faces[t + 2] * 3
      const ux = x[b] - x[a]
      const uy = x[b + 1] - x[a + 1]
      const uz = x[b + 2] - x[a + 2]
      const vx = x[c] - x[a]
      const vy = x[c + 1] - x[a + 1]
      const vz = x[c + 2] - x[a + 2]
      let nx = uy * vz - uz * vy
      let ny = uz * vx - ux * vz
      let nz = ux * vy - uy * vx
      const n = Math.hypot(nx, ny, nz)
      if (n < 1e-9) continue
      nx /= n
      ny /= n
      nz /= n
      const across = ((x[a] - was[a] + x[b] - was[b] + x[c] - was[c]) * nx + (x[a + 1] - was[a + 1] + x[b + 1] - was[b + 1] + x[c + 1] - was[c + 1]) * ny + (x[a + 2] - was[a + 2] + x[b + 2] - was[b + 2] + x[c + 2] - was[c + 2]) * nz) / 3
      for (const i of [faces[t], faces[t + 1], faces[t + 2]]) {
        blown[i * 4] += across * nx
        blown[i * 4 + 1] += across * ny
        blown[i * 4 + 2] += across * nz
        blown[i * 4 + 3] += 1
      }
    }
    for (let i = 0; i < pin.length; i += 1) {
      const n = blown[i * 4 + 3]
      if (pin[i] >= 1 || !n) continue
      for (let c = 0; c < 3; c += 1) was[i * 3 + c] += by * blown[i * 4 + c] / n
    }
  }

  /** Brought `by` of the way to `to` (1: there, and still). */
  settle(to: Float32Array, by: number): void {
    for (let i = 0; i < this.x.length; i += 1) {
      this.x[i] += (to[i] - this.x[i]) * by
      this.was[i] += (to[i] - this.was[i]) * by
    }
  }

  /** The furthest any node is from `to`. */
  off(to: Float32Array): number {
    let most = 0
    for (let i = 0; i < this.pin.length; i += 1) most = Math.max(most, dist(this.x, i, to, i))
    return most
  }
}

function dist(a: Float32Array, i: number, b: Float32Array, j: number): number {
  return Math.hypot(a[i * 3] - b[j * 3], a[i * 3 + 1] - b[j * 3 + 1], a[i * 3 + 2] - b[j * 3 + 2])
}

/** How far along the limb (0 at `a`, 1 at `b`) the node at `o` lies nearest. */
function along(x: Float32Array, o: number, limb: Arm3DClothLimb): number {
  const dx = limb.b[0] - limb.a[0]
  const dy = limb.b[1] - limb.a[1]
  const dz = limb.b[2] - limb.a[2]
  const l = dx * dx + dy * dy + dz * dz
  if (l < 1e-9) return 0
  return Math.max(0, Math.min(1, ((x[o] - limb.a[0]) * dx + (x[o + 1] - limb.a[1]) * dy + (x[o + 2] - limb.a[2]) * dz) / l))
}

/** How fixed a node is: all the way at the shoulder and at the seam, free down the arm. */
export function arm3DClothPin(t: number, fromSeam: number): number {
  return Math.max(1 - smoothstep(0.02, 0.2, t), 1 - smoothstep(1, 2.5, fromSeam))
}
