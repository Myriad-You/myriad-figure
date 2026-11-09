import type { Anime25DVec3 } from '../anime25drig/types'
import type { P2 } from './armRaster'
import { add2, dot2, linspace, median, mul2, sub2, unit2 } from './armRaster'

/**
 * Whether a gesture picture moved the portrait's cuff: the band the portrait's sleeve wears down by the elbow (a
 * coloured band, a turned-back cuff) drawn on at the wrist instead. The 3D arm takes its upper sleeve from the
 * portrait and its forearm from the picture, so a sleeve so drawn wears the band twice. Pictures of one
 * character mostly keep it where the portrait has it; one that does not is the generator's mistake.
 */

export interface ArmCuffPictures {
  width: number
  height: number
  /** RGB, 0–255, `width × height × 3`. */
  portrait: ArrayLike<number>
  variant: ArrayLike<number>
  /** The portrait's arm, and the picture's own (as measured for the model). */
  base: Uint8Array
  mask: Uint8Array
  /** Shoulder, elbow, wrist: the portrait's arm hanging, the picture's raised. */
  rest: [P2, P2, P2]
  raised: [P2, P2, P2]
  /** The arm's half-widths along it, shoulder to wrist. */
  radius: readonly number[]
  skin: Anime25DVec3
}

const ROWS = 50

/** True when the picture draws the portrait's band at the wrist, false when not; null with no band to look for. */
export function cuffDrawnAtWrist(p: ArmCuffPictures): boolean | null {
  const { width: W, height: H } = p
  const half = 0.4 * median([...p.radius])
  const foreR = 1.1 * median(p.radius.slice(p.radius.length >> 1))
  const vs = linspace(0.02, 0.98, ROWS)
  const profile = (img: ArrayLike<number>, mask: Uint8Array, [s, e, w]: [P2, P2, P2], keepForearm: boolean) =>
    vs.map((v) => {
      const [a, b, t] = v <= 0.5 ? [s, e, v / 0.5] : [e, w, (v - 0.5) / 0.5]
      const d = unit2(sub2(b, a))
      const nrm: P2 = [-d[1], d[0]]
      const c = add2(a, mul2(sub2(b, a), t))
      const got: Anime25DVec3[] = []
      for (const k of linspace(-half, half, 15)) {
        for (const dd of [-3, 0, 3]) {
          const q = add2(add2(c, mul2(nrm, k)), mul2(d, dd))
          const x = Math.trunc(q[0])
          const y = Math.trunc(q[1])
          // The upper arm where the raised forearm lies over it is the forearm's.
          if (keepForearm && v <= 0.5) {
            const dw = sub2(w, e)
            const t2 = Math.max(0, Math.min(1, dot2(sub2(q, e), dw) / Math.max(1e-6, dot2(dw, dw))))
            if (t2 > 0.05 && Math.hypot(...sub2(q, add2(e, mul2(dw, t2)))) < foreR) continue
          }
          if (x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x]) {
            got.push([img[(y * W + x) * 3], img[(y * W + x) * 3 + 1], img[(y * W + x) * 3 + 2]])
          }
        }
      }
      return got.length > 10 ? got : null
    })
  const off = (a: Anime25DVec3, b: Anime25DVec3) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]))
  const rest = profile(p.portrait, p.base, p.rest, false)
  const plainPixels = rest.flatMap((row, i) => (row && vs[i] > 0.1 && vs[i] < 0.3 ? row : []))
  if (plainPixels.length === 0) return null
  const plain: Anime25DVec3 = [0, 1, 2].map((k) => median(plainPixels.map((q) => q[k]))) as Anime25DVec3
  // Neither the plain sleeve nor skin.
  const far = (q: Anime25DVec3) => off(q, plain) > 60 && off(q, p.skin) > 40
  const share = (row: Anime25DVec3[], keep: (q: Anime25DVec3) => boolean) => row.filter(keep).length / row.length
  const band = rest.flatMap((row, i) => (row && vs[i] > 0.3 && share(row, far) > 0.3 ? [row.filter(far)] : []))
  if (band.length === 0) return null
  const colours = twoMeans(band.flat())
  const drawn = profile(p.variant, p.mask, p.raised, true)
  const banded = (row: Anime25DVec3[]) => share(row, (q) => far(q) && Math.min(...colours.map((c) => off(q, c))) < 35) > 0.25
  return drawn.some((row, i) => row !== null && vs[i] >= 0.6 && banded(row))
}

/** Two colours the pixels gather about (Lloyd's, from the first pixel and the one farthest from it). */
function twoMeans(pixels: Anime25DVec3[]): Anime25DVec3[] {
  const d2 = (a: Anime25DVec3, b: Anime25DVec3) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
  let centres: Anime25DVec3[] = [pixels[0], pixels.reduce((best, q) => (d2(q, pixels[0]) > d2(best, pixels[0]) ? q : best))]
  for (let round = 0; round < 20; round += 1) {
    const sums = centres.map(() => [0, 0, 0, 0])
    for (const q of pixels) {
      const k = d2(q, centres[0]) <= d2(q, centres[1]) ? 0 : 1
      for (let c = 0; c < 3; c += 1) sums[k][c] += q[c]
      sums[k][3] += 1
    }
    centres = sums.map((s, k) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : centres[k]) as Anime25DVec3)
  }
  return centres
}
