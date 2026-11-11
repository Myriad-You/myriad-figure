import type { Anime25DArmModel, Anime25DVec3 } from '../anime25drig/types'
import type { EyeSide } from './anime25dImportTypes'
import type { ArmCuffReading } from './armCuff'
import type { P2 } from './armRaster'
import { cuffDrawnAtWrist } from './armCuff'
import { extendFinger, FINGER_CHAINS, measureDrawnHand } from './armHand'
import {
  add2, add3, capsuleMask, closeSquare, components, convexMask, convexPatch, cropAround, cropOf, cross3, dilateSquare,
  dist2, dist3, fillHoles, gaussian, interp, linspace, median, medianColor, mul2, mul3, percentile, rings, round,
  segmentDistance, simplify, sub2, sub3, texel, unit2, unit3, widths,
} from './armRaster'

/**
 * A gesture arm measured as a 3D arm (the 2026-11-06 pure 3D arm): the drawn
 * arm is never shown, only laid on a modelled sleeve and hand as their
 * texture. Everything here is read off two pictures on the same grid, the
 * portrait and the gesture variant, with the pose model's joints on each:
 *
 * - the bones' lengths and each picture's joints lifted into 3D, the depth
 *   being what the drawn length falls short of the bone's;
 * - the sleeve's radius along the arm (the portrait's arm layer for the upper
 *   arm, the variant's arm for the forearm), where its cuff ends, how the
 *   hanging arm's outline reaches past a round tube, and how far down the
 *   upper arm the portrait's own sleeve is worn;
 * - the variant's hand: its 21 points moved onto the fingers drawn there,
 *   each finger's drawn width knuckle to tip, the palm's outline, which
 *   fingers the hand hides, its skin, shade and line colours, and the
 *   outline of the hand's own cut (its skin and lines, no sleeve or body);
 * - the outline of the variant's arm, which the gesture layer also holds
 *   the body round (what the portrait's arm leaves bare once hidden).
 *
 * Positions are on the grid (x right, y down, z toward the viewer).
 */

type Pose = ReadonlyArray<readonly [number, number, number]>

export interface ArmModelPictures {
  width: number
  height: number
  /** RGB, 0–255, `width × height × 3`. */
  portrait: ArrayLike<number>
  variant: ArrayLike<number>
  /**
   * Where the variant differs from the portrait (specks opened away, its ground left out): the arm is what of it
   * lies along the variant's own arm and hand.
   */
  changed: Uint8Array
  /** How far the variant's colour is from the portrait's at each pixel, both lightly blurred. */
  difference: Float32Array
  /** The even light ground the variant stands on, round the figure. */
  ground: Uint8Array
  /** Where the portrait drew the arm on this side (its handwear layer). */
  base: Uint8Array
  /** COCO-WholeBody keypoints `[x, y, score]` on the grid. */
  portraitPose: Pose
  variantPose: Pose
  /** The changed arm's side of the picture. */
  side: EyeSide
  /**
   * A standing figure's: its portrait draws the whole arm hanging, forearm and hand, bent as it is at the elbow. A
   * bust's runs off the picture below the elbow and is taken to hang straight on.
   */
  whole?: boolean
}

// Tuned on a 1152-wide grid (the 2026-11-03 trial): the cut's working grid.
const RADII = 12
const SLEEVE_ROWS = 1024
const SLEEVE_AROUND = 256
const HAND_SURE = 0.3
const HAND_POINTS = 15

/** The model, and (for the import to weigh) where the portrait's cuff lies and whether the picture drew it at the wrist. */
export type MeasuredArmModel = Anime25DArmModel & { cuffAtWrist: ArmCuffReading | null }

export function measureArmModel(pictures: ArmModelPictures): MeasuredArmModel | null {
  const { width: W, height: H, side } = pictures
  const portraitJoints = joints(pictures.portraitPose, side)
  const drawn = joints(pictures.variantPose, side)
  if (!portraitJoints || !drawn?.hand) return null
  const img = pictures.variant
  const held = extendFinger(drawn.hand, pictures.changed, img, W, H)
  drawn.hand = held.hand
  const mask = alongBones(pictures, drawn.s, drawn.e, drawn.w, drawn.hand)
  const on = (m: Uint8Array) => (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && m[y * W + x] > 0
  const base = on(pictures.base)
  const armAt = on(mask)
  const color = (data: ArrayLike<number>, x: number, y: number): Anime25DVec3 =>
    [data[(y * W + x) * 3], data[(y * W + x) * 3 + 1], data[(y * W + x) * 3 + 2]]

  const ps = portraitJoints.s
  let pe = portraitJoints.e
  // A portrait whose forearm comes toward the viewer has its elbow found below the picture's edge, past where the
  // drawn arm (its cuff at the elbow's height) ends: the hanging arm then ran on past the drawing and its upper arm
  // took the cuff. Off the picture, the elbow is where the upper arm's length puts it.
  if (!(pe[0] >= 0 && pe[0] < W && pe[1] >= 0 && pe[1] < H - 8)) {
    pe = add2(ps, mul2(unit2(sub2(pe, ps)), dist2(drawn.e, drawn.s)))
  }
  const U = Math.max(dist2(drawn.e, drawn.s), dist2(pe, ps))
  const pw = portraitJoints.w
  const F = dist2(drawn.w, drawn.e)
  // A figure's forearm as long as each picture draws it: the gesture's a fifth shorter than the portrait's hanging
  // one was read as pointing at the viewer, and its cuff showed as a dark ring.
  const restFore = pictures.whole ? dist2(pw, pe) : F
  const lift = (s: P2, e: P2, w: P2, f = F): [Anime25DVec3, Anime25DVec3, Anime25DVec3] => {
    const e3: Anime25DVec3 = [e[0], e[1], Math.sqrt(Math.max(0, U * U - dist2(e, s) ** 2))]
    const w3: Anime25DVec3 = [e3[0] + w[0] - e[0], e3[1] + w[1] - e[1], e3[2] + Math.sqrt(Math.max(0, f * f - dist2(w, e) ** 2))]
    return [[s[0], s[1], 0], e3, w3]
  }
  const raised = lift(drawn.s, drawn.e, drawn.w)
  // The portrait's arm hangs: a bust's forearm goes on the way its upper arm does; a figure's is drawn.
  const hang = unit2(sub2(pe, ps))
  const hangWrist = pictures.whole ? pw : add2(pe, mul2(hang, F))
  const rest = lift(ps, pe, hangWrist, restFore)

  const hand0 = drawn.hand
  const handZone = convexPatch(hand0, 15, W, H)
  const handAt = handZone.at
  let upper = widths(base, ps, pe, RADII)
  // Where the drawn sleeve ends along the forearm (0 elbow, 1 wrist): past it the forearm is bare skin, which is
  // the wrist's to draw, not the sleeve's (a sleeve run on to the wrist bakes that skin in).
  const handPixels: Anime25DVec3[] = []
  for (let y = handZone.y; y < handZone.y + handZone.h; y += 1) {
    for (let x = handZone.x; x < handZone.x + handZone.w; x += 1) {
      if (handAt(x, y) && mask[y * W + x]) handPixels.push(color(img, x, y))
    }
  }
  if (handPixels.length === 0) return null
  const tone = medianColor(handPixels)
  const across = (t: number) => {
    const c = add2(drawn.e, mul2(sub2(drawn.w, drawn.e), t))
    const d = unit2(sub2(drawn.w, drawn.e))
    return { c, nrm: [-d[1], d[0]] as P2 }
  }
  const toneOff = (x: number, y: number) => dist3(color(img, x, y), tone)
  // The drawn forearm: what changed along it, and the portrait's own arm left as it was where the forearm, raised
  // over it skin on skin, hardly changes the picture (the bare forearm then had a hole down its middle and read as
  // sleeve).
  const changedAt = on(pictures.changed)
  const forearmAt = (x: number, y: number) => armAt(x, y) || (base(x, y) && !changedAt(x, y) && toneOff(x, y) < 25)
  // How much of the drawn forearm across it is skin: within a few levels of the hand's own tone (a white cuff is 13
  // or more off it). Its shaded side and lines are off it too, so a bare forearm is seldom more than two thirds skin.
  const skinShare = (t: number) => {
    const { c, nrm } = across(t)
    let drawnThere = 0
    let skin = 0
    for (const k of linspace(-60, 60, 41)) {
      const x = Math.trunc(c[0] + nrm[0] * k)
      const y = Math.trunc(c[1] + nrm[1] * k)
      if (!forearmAt(x, y)) continue
      drawnThere += 1
      if (toneOff(x, y) < 10) skin += 1
    }
    return drawnThere > 4 ? skin / drawnThere : null
  }
  let cuff = 1
  // From the wrist down to just past the elbow (a sleeve rolled up has the whole forearm bare), until the sleeve
  // starts: nearly no skin twice running. Ended at the first sample short of half skin, a bare forearm's shaded
  // patch ended it at the wrist (a kimono's forearm modelled sleeved to the hand), and a cuff lit a little lighter
  // let it run on into the cuff.
  let short = 0
  for (const t of linspace(0.98, 0.12, 87)) {
    const share = skinShare(t)
    if (share === null) break
    if (share < 0.3) {
      if (++short >= 2) break
      continue
    }
    short = 0
    if (share >= 0.35) cuff = t
  }
  cuff = Math.max(0.15, cuff)
  const cuffPoint = add2(drawn.e, mul2(sub2(drawn.w, drawn.e), cuff))
  // The drawn bare forearm's half-width and how far its middle lies off the elbow-wrist line (along the normal; the
  // detected wrist is seldom on the forearm's middle), between the cuff and the wrist: a modelled one wider or off
  // to a side shows as a pale edge beside the drawn arm laid over it. Its skin lit and shaded, across the lines
  // drawn inside it (a muscle's): stopped at the first, it came out about half as wide as drawn.
  const bareHalf = (t: number): P2 | null => {
    const { c, nrm } = across(t)
    const R = 140
    const GAP = 6
    const skin: boolean[] = []
    for (let k = -R; k <= R; k += 1) {
      const x = Math.trunc(c[0] + nrm[0] * k)
      const y = Math.trunc(c[1] + nrm[1] * k)
      skin.push(forearmAt(x, y) && toneOff(x, y) < 30)
    }
    if (!skin.slice(R - GAP, R + GAP + 1).some(Boolean)) return null
    const reach = (from: number, step: number) => {
      let last = from
      for (let k = from; k >= 0 && k <= 2 * R && Math.abs(k - last) <= GAP; k += step) {
        if (skin[k]) last = k
      }
      return last
    }
    const lo = reach(R, -1)
    const hi = reach(R, 1)
    return [(hi - lo + 1) / 2, (hi + lo) / 2 - R]
  }
  const halves = cuff < 0.93 ? linspace(cuff + 0.02, 0.95, 12).map(bareHalf).filter((h): h is P2 => h !== null) : []
  const bareWidth = halves.length >= 3 ? median(halves.map((h) => h[0])) : undefined
  const bareShift = halves.length >= 3 ? median(halves.map((h) => h[1])) : 0
  let fore = widths((x, y) => forearmAt(x, y) && !handAt(x, y), drawn.e, cuffPoint, RADII)
  // A figure's forearm is drawn whole where it hangs, with nothing beside it: the gesture's, raised by a cape or
  // against the body, was measured with what moved next to it and came out half again as wide, a ball at the elbow.
  // Its sleeve there is the one the arm wears (the modelled sleeve is laid from the hanging arm): read to where the
  // gesture's cuff ends, one whose cuff hangs over the hand lost most of that cuff, a thin band left at the wrist.
  const hangs = pictures.whole && portraitJoints.hand
    ? hangingSleeve(base, (x, y) => color(pictures.portrait, x, y), tone, pe, pw, portraitJoints.hand)
    : null
  if (pictures.whole) {
    const hung = widths(base, pe, add2(pe, mul2(sub2(pw, pe), hangs?.end ?? cuff)), RADII)
    fore = fore.map((v, i) => (hung[i] >= 0.06 * U ? hung[i] : v))
  }
  const steady = (values: number[], least: number, fallback: number) => {
    const good = values.filter((v) => v >= least)
    const stand = good.length ? median(good) : fallback
    return values.map((v) => (v < least ? stand : v))
  }
  upper = steady(upper, 0.08 * U, 0.18 * U)
  fore = steady(fore, 0.06 * U, 0.14 * U)
  let wide: number[] | undefined
  if (pictures.whole) {
    // What a standing figure wears on its shoulder and upper arm (a pauldron, a short sleeve flaring at the elbow) is
    // drawn in its arm's layer and was measured as the arm: twice the forearm's width, a ball at the elbow of the arm
    // raised. No wider than an arm is to its own forearm near the wrist.
    const half = fore.length >> 1
    const most = 1.6 * median(fore.slice(half))
    if (upper.some((v) => v > most) || fore.some((v, i) => i < half && v > most)) wide = [...upper, ...fore]
    upper = upper.map((v) => Math.min(v, most))
    fore = fore.map((v, i) => (i < half ? Math.min(v, most) : v))
  }
  // A standing figure's short sleeve, its forearm hanging bare: where it ends along the arm.
  const shortSleeve = pictures.whole && !hangs ? hangingShortSleeve(base, (x, y) => color(pictures.portrait, x, y), tone, ps, pe, pw) : null
  const smooth = (joined: number[]) => {
    const out = joined.map((_, i) => ((joined[i - 1] ?? 0) + joined[i] + (joined[i + 1] ?? 0)) / 3)
    out[0] = joined[0]
    out[out.length - 1] = joined[joined.length - 1]
    return out
  }
  const radius = smooth([...upper, ...fore])

  const restReach = measureRestReach(base, W, H, radius, ps, pe, hangWrist, hangs?.end ?? cuff)

  // How far down the upper arm the portrait's own sleeve is worn, raised: with the elbow in the picture, a short
  // sleeve's cuff (a band and pendant) is drawn just above it, and kept on the upper arm it stayed there as the
  // forearm, wearing the variant's cuff, came up. Read off the sleeve the pictures lay on the hanging arm.
  const lane = capsuleMask(ps, pe, Math.max(3, Math.trunc(1.8 * median(upper))) / 2, W, H)
  const portraitMask = new Uint8Array(W * H)
  for (let p = 0; p < W * H; p += 1) portraitMask[p] = pictures.base[p] || lane[p] ? 1 : 0
  const restSleeve = layOnSleeve(W, H, radius, cuff, SLEEVE_ROWS / 2 + 8, [
    { img: pictures.portrait, mask: portraitMask, joints: rest },
    { img, mask, joints: raised, hand: hand0 },
  ])
  let restEnd = 0.49
  {
    const rows = SLEEVE_ROWS
    const front = (j: number) => {
      const u = (j + 0.5) / SLEEVE_AROUND
      return u < 0.12 || u > 0.88
    }
    const rowColor = (i: number) => {
      const got: Anime25DVec3[] = []
      for (let j = 0; j < SLEEVE_AROUND; j += 1) {
        if (front(j)) got.push(texel(restSleeve, i * SLEEVE_AROUND + j))
      }
      return medianColor(got)
    }
    const v = (i: number) => (i + 0.5) / rows
    const plain: Anime25DVec3[] = []
    for (let i = 0; i < rows; i += 1) {
      if (v(i) > 0.1 && v(i) < 0.3) plain.push(rowColor(i))
    }
    if (plain.length) {
      const ref = medianColor(plain)
      for (let i = 0; i < rows; i += 1) {
        if (!(v(i) > 0.3 && v(i) < 0.5)) continue
        const c = rowColor(i)
        if (Math.max(...c.map((x, k) => Math.abs(x - ref[k]))) > 60) {
          restEnd = Math.max(0.3, v(i) - 0.03)
          break
        }
      }
    }
  }

  const drawnHand = measureDrawnHand({ width: W, height: H, img, mask, found: hand0, elbow: drawn.e, wrist: drawn.w, tone, shown: held.laid === null ? [] : [held.laid] })

  const lum = handPixels.map((c) => (c[0] + c[1] + c[2]) / 3)
  // A hand of one flat colour has no lighter or darker part: all of it stands in.
  const pick = (keep: (l: number) => boolean) => {
    const got = handPixels.filter((_, i) => keep(lum[i]))
    return medianColor(got.length ? got : handPixels)
  }
  const p3 = percentile(lum, 3)
  const p12 = percentile(lum, 12)
  const p35 = percentile(lum, 35)
  const p40 = percentile(lum, 40)

  const armBox = cropOf(mask, W, H)
  const armField = new Float32Array(armBox.w * armBox.h)
  for (let k = 0; k < armField.length; k += 1) armField[k] = mask[(armBox.y + ((k / armBox.w) | 0)) * W + armBox.x + (k % armBox.w)]
  const armRings = rings(armField, armBox.w, armBox.h, 0.5).map((ring) => simplify(ring, 0.6).map(([x, y]) => [x + armBox.x, y + armBox.y] as P2))

  // The drawing's own ground about its upper arm and elbow: held, the modelled arm, rounder or lower than the drawn
  // one, stood out past it there in the portrait's hanging sleeve (a wide coat sleeve, the hand on the chest).
  const groundBox = cropAround([drawn.s, drawn.e], Math.ceil(1.5 * Math.max(...radius)), W, H)
  const groundField = new Float32Array(groundBox.w * groundBox.h)
  for (let k = 0; k < groundField.length; k += 1) groundField[k] = pictures.ground[(groundBox.y + ((k / groundBox.w) | 0)) * W + groundBox.x + (k % groundBox.w)]
  const groundRings = rings(groundField, groundBox.w, groundBox.h, 0.5).map((ring) => simplify(ring, 0.6).map(([x, y]) => [x + groundBox.x, y + groundBox.y] as P2))

  const skin = pick((l) => l > p40)
  return {
    upper: U,
    fore: F,
    radius,
    cuff: round(cuff, 3),
    ...(bareWidth === undefined ? {} : { bare: round(bareWidth, 1) }),
    bareShift: round(bareShift, 1),
    restEnd: round(restEnd, 3),
    restReach,
    rest: { shoulder: rest[0], elbow: rest[1], wrist: rest[2] },
    raised: { shoulder: raised[0], elbow: raised[1], wrist: raised[2] },
    ...drawnHand,
    ...(pictures.whole ? { restFore } : {}),
    // Past a short sleeve's end the arm is drawn bare: no wider there than it is modelled.
    ...(wide ? { drawnRadius: smooth(wide).map((v, i, all) => round(shortSleeve !== null && i / (all.length - 1) > shortSleeve ? radius[i] : v, 1)) } : {}),
    ...(shortSleeve === null ? {} : { shortSleeve: round(shortSleeve, 3) }),
    ...(hangs ? { restCuff: round(hangs.end, 3), cuffFrom: round(hangs.from, 3) } : {}),
    ...(pictures.whole && portraitJoints.hand ? { restHand: portraitJoints.hand.map(([x, y]) => [x, y] as [number, number]) } : {}),
    skin,
    shade: pick((l) => l > p12 && l < p35),
    line: pick((l) => l < p3),
    armOutline: armRings,
    ground: groundRings,
    cuffAtWrist: cuffDrawnAtWrist({
      width: W, height: H, portrait: pictures.portrait, variant: img, base: pictures.base, mask,
      rest: [ps, pe, hangWrist], raised: [drawn.s, drawn.e, drawn.w], radius, skin,
    }),
  }
}

/**
 * A standing figure's sleeve as its portrait draws it hanging, along the forearm (elbow 0, the found wrist 1; a
 * cuff worn over the hand ends past it): where it ends (back from the hand, as far as the arm is mostly skin) and
 * where its cuff begins (the sleeve's plain colour left for another). Null with no skin at the hand to go back
 * from (a glove), or a forearm bare most of its way.
 */
/**
 * Where a short sleeve ends along the arm the portrait draws hanging (shoulder 0, elbow 0.5, wrist 1), its forearm
 * bare below it: null where the forearm is not bare, or the arm bare from the shoulder.
 */
function hangingShortSleeve(
  base: (x: number, y: number) => boolean,
  color: (x: number, y: number) => Anime25DVec3,
  tone: Anime25DVec3,
  ps: P2,
  pe: P2,
  pw: P2,
): number | null {
  // The arm drawn across the bone at v is skin for at least `share` of its width.
  const skin = (v: number, share: number) => {
    const [a, b, t] = v <= 0.5 ? [ps, pe, v / 0.5] : [pe, pw, (v - 0.5) / 0.5]
    const L = dist2(a, b)
    if (L < 8) return false
    const d = unit2(sub2(b, a))
    let drawn = 0
    let bare = 0
    for (let k = -200; k <= 200; k += 1) {
      const x = Math.trunc(a[0] + d[0] * t * L - d[1] * k)
      const y = Math.trunc(a[1] + d[1] * t * L + d[0] * k)
      if (!base(x, y)) continue
      drawn += 1
      if (dist3(color(x, y), tone) < 14) bare += 1
    }
    return drawn > 4 && bare >= share * drawn
  }
  if (linspace(0.62, 0.9, 12).filter((v) => skin(v, 0.4)).length < 9) return null
  let end = 0.62
  let off = 0
  for (let v = 0.62; v >= 0.2; v -= 0.01) {
    // What hangs off the sleeve over the arm (a strap's end) leaves skin either side of it; the sleeve leaves none.
    if (skin(v, 0.2)) {
      end = v
      off = 0
    }
    else if (++off >= 3) {
      return end
    }
  }
  return null
}

function hangingSleeve(
  base: (x: number, y: number) => boolean,
  color: (x: number, y: number) => Anime25DVec3,
  tone: Anime25DVec3,
  pe: P2,
  pw: P2,
  hand: ReadonlyArray<P2>,
): { end: number; from: number } | null {
  const L = dist2(pw, pe)
  if (L < 8) return null
  const d = unit2(sub2(pw, pe))
  const across = (t: number) => {
    const got: Anime25DVec3[] = []
    for (let k = -200; k <= 200; k += 1) {
      const x = Math.trunc(pe[0] + d[0] * t * L - d[1] * k)
      const y = Math.trunc(pe[1] + d[1] * t * L + d[0] * k)
      if (base(x, y)) got.push(color(x, y))
    }
    return got
  }
  const knuckle = sub2(hand[9], pe)
  const from = Math.min(2, (knuckle[0] * d[0] + knuckle[1] * d[1]) / L)
  let end: number | null = null
  let short = 0
  for (let t = from; t >= 0.5; t -= 0.02) {
    const row = across(t)
    const share = row.length > 4 ? row.filter((c) => dist3(c, tone) < 14).length / row.length : 0
    if (share >= 0.5) {
      end = t
      short = 0
    }
    else if (end !== null && ++short >= 3) {
      break
    }
  }
  if (end === null || end < 0.75 || end > from - 0.03) return null
  // Skin again a little further back: what ended it by the hand was a band round the wrist, not a sleeve.
  for (let t = end - 0.08; t >= Math.max(0.5, end - 0.45); t -= 0.02) {
    const row = across(t)
    if (row.length > 4 && row.filter((c) => dist3(c, tone) < 14).length >= 0.5 * row.length) return null
  }
  const plain = linspace(0.15, 0.45, 16).flatMap(across)
  if (plain.length < 16) return null
  // A forearm bare most of its way: what ended the skin back from the hand was a band at the wrist, not a sleeve.
  if (plain.filter((c) => dist3(c, tone) < 14).length >= 0.5 * plain.length) return null
  const ref = medianColor(plain)
  let cuffFrom = Math.max(0.5 * end, end - 0.3)
  let off = 0
  for (let t = 0.45; t < end - 0.08; t += 0.02) {
    const row = across(t)
    if (row.length > 4 && Math.max(...medianColor(row).map((x, k) => Math.abs(x - ref[k]))) > 60) {
      if (++off >= 2) {
        cuffFrom = t - 0.02
        break
      }
    }
    else {
      off = 0
    }
  }
  return { end, from: cuffFrom }
}

/** The model moved off the grid: `x · scale + dx`, lengths `· scale`. */
export function placeArmModel(model: Anime25DArmModel, scale: number, dx: number, dy: number): Anime25DArmModel {
  const p2 = ([x, y]: readonly [number, number]): [number, number] => [x * scale + dx, y * scale + dy]
  const p3 = ([x, y, z]: Anime25DVec3): Anime25DVec3 => [x * scale + dx, y * scale + dy, z * scale]
  const joints3 = (j: Anime25DArmModel['rest']) => ({ shoulder: p3(j.shoulder), elbow: p3(j.elbow), wrist: p3(j.wrist) })
  return {
    ...model,
    upper: model.upper * scale,
    fore: model.fore * scale,
    ...(model.restFore === undefined ? {} : { restFore: model.restFore * scale }),
    radius: model.radius.map((r) => r * scale),
    ...(model.drawnRadius ? { drawnRadius: model.drawnRadius.map((r) => r * scale) } : {}),
    ...(model.bare === undefined ? {} : { bare: model.bare * scale }),
    bareShift: model.bareShift * scale,
    restReach: model.restReach.map((o) => (o ? [o[0] * scale, o[1] * scale] : null)),
    rest: joints3(model.rest),
    raised: joints3(model.raised),
    hand: model.hand.map(p2),
    ...(model.restHand ? { restHand: model.restHand.map(p2) } : {}),
    fingers: model.fingers.map((r) => r * scale),
    fingerProfile: model.fingerProfile.map((f) => f.map((r) => r * scale)),
    keyProfile: model.keyProfile.map((f) => f.map((r) => r * scale)),
    handOutline: model.handOutline.map((ring) => ring.map(p2)),
    armOutline: model.armOutline.map((ring) => ring.map(p2)),
    ...(model.ground ? { ground: model.ground.map((ring) => ring.map(p2)) } : {}),
  }
}

/**
 * The arm on `side` of the picture (the shoulder found there, the person's right one when the two cannot be told
 * apart) and the hand drawn at its wrist.
 */
function joints(pose: Pose, side: EyeSide): { s: P2; e: P2; w: P2; hand: P2[] | null } | null {
  const at = (i: number): P2 | null => (pose[i] ? [pose[i][0], pose[i][1]] : null)
  const rightOnLeft = !(at(5) && at(6)) || at(6)![0] <= at(5)![0]
  const [si, ei, wi] = (side === 'left') === rightOnLeft ? [6, 8, 10] : [5, 7, 9]
  const s = at(si)
  const e = at(ei)
  const w = at(wi)
  if (!s || !e || !w) return null
  const found = [pose.slice(91, 112), pose.slice(112, 133)]
    .filter((hand) => hand.length === 21 && hand.filter((q) => q[2] >= HAND_SURE).length >= HAND_POINTS)
    .map((hand) => hand.map((q) => [q[0], q[1]] as P2))
  // Whichever the pose model called it, the hand on this arm is the one at its wrist.
  const hand = found.reduce<P2[] | null>((got, h) => (!got || dist2(h[0], w) < dist2(got[0], w) ? h : got), null)
  return { s, e, w, hand }
}

/**
 * The arm itself: what changed near its bones and its hand's, closed, in one piece with the hand, holes filled.
 * The image model redraws a little of the body round a moved arm too (a shirt's folds, a sleeve's shadow on it):
 * closed and filled before it is kept to the bones, the body between a forearm across the chest and the upper arm
 * came in whole, and measured as a forearm twice as thick.
 */
function alongBones(pictures: ArmModelPictures, s: P2, e: P2, w: P2, hand: P2[]): Uint8Array {
  const { width: W, height: H, changed: cut, ground } = pictures
  const U = dist2(e, s)
  const size = dist2(hand[9], hand[0])
  const bones: Array<[P2, P2, number]> = [[s, e, 0.34 * U], [e, w, 0.34 * U], ...hand.map((q): [P2, P2, number] => [w, q, 0.16 * U])]
  // Worked on a box round the bones and the hand, a little over.
  const ends = bones.flatMap(([a, b, r]) => [[a[0] - r, a[1] - r], [a[0] + r, a[1] + r], [b[0] - r, b[1] - r], [b[0] + r, b[1] + r]] as P2[])
  const reach = Math.ceil(0.5 * size) + 8
  const box = cropAround([...ends, ...hand.flatMap((q) => [[q[0] - reach, q[1] - reach], [q[0] + reach, q[1] + reach]] as P2[])], 8, W, H)
  const at = (k: number) => (box.y + ((k / box.w) | 0)) * W + box.x + (k % box.w)
  const near = new Uint8Array(box.w * box.h)
  for (const [a, b, r] of bones) {
    const x0 = Math.max(box.x, Math.floor(Math.min(a[0], b[0]) - r))
    const x1 = Math.min(box.x + box.w - 1, Math.ceil(Math.max(a[0], b[0]) + r))
    const y0 = Math.max(box.y, Math.floor(Math.min(a[1], b[1]) - r))
    const y1 = Math.min(box.y + box.h - 1, Math.ceil(Math.max(a[1], b[1]) + r))
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        if (cut[y * W + x] && segmentDistance([x, y], a, b) < r) near[(y - box.y) * box.w + x - box.x] = 1
      }
    }
  }
  const closed = closeSquare(near, box.w, box.h, 11)
  const { labels } = components(closed, box.w, box.h)
  const seeds = new Set<number>()
  for (const [x, y] of hand) {
    const lx = Math.trunc(x) - box.x
    const ly = Math.trunc(y) - box.y
    const label = lx >= 0 && ly >= 0 && lx < box.w && ly < box.h ? labels[ly * box.w + lx] : 0
    if (label) seeds.add(label)
  }
  if (!seeds.size) return cut
  const m = Uint8Array.from(labels, (label) => (seeds.has(label) ? 1 : 0))
  fillHoles(m, box.w, box.h)
  fingersOverSkin(m, box, pictures, hand)
  const out = new Uint8Array(W * H)
  for (let k = 0; k < m.length; k += 1) {
    // Closing and filling take in the ground between fingers, or between a forearm and the body: never the arm's.
    if (m[k] && !ground[at(k)]) out[at(k)] = 1
  }
  return out
}

/**
 * Fingers laid over skin (a chin, a neck) hardly change the picture there and drop out of what changed: right on
 * a finger's bone, what is skin-coloured is the finger, and the outline strokes between such pixels close over.
 * Skin beside the fingers, off them and the palm, that changed only a little is the chin or neck the image model
 * redrew: dropped (it stayed put while the head turned under the hand).
 */
function fingersOverSkin(
  m: Uint8Array,
  box: { x: number; y: number; w: number; h: number },
  { width: W, variant, difference }: ArmModelPictures,
  hand: P2[],
): void {
  const { w, h } = box
  const at = (k: number) => (box.y + ((k / w) | 0)) * W + box.x + (k % w)
  const size = dist2(hand[9], hand[0])
  const local = (q: P2): P2 => [Math.trunc(q[0]) - box.x, Math.trunc(q[1]) - box.y]
  const along = new Uint8Array(w * h)
  const core = new Uint8Array(w * h)
  const stroke = (into: Uint8Array, a: P2, b: P2, thickness: number) => {
    const line = capsuleMask(local(a), local(b), thickness / 2, w, h)
    for (let k = 0; k < w * h; k += 1) {
      if (line[k]) into[k] = 1
    }
  }
  for (const chain of FINGER_CHAINS) {
    const joints = [0, ...chain]
    for (let i = 1; i < joints.length; i += 1) stroke(along, hand[joints[i - 1]], hand[joints[i]], Math.max(3, Math.trunc(0.22 * size)))
    // The tip point sits short of the fingertip: the last bone carried on a little.
    const pts = chain.map((i) => hand[i])
    pts[3] = add2(pts[3], mul2(sub2(pts[3], pts[2]), 0.2))
    for (let i = 1; i < pts.length; i += 1) stroke(core, pts[i - 1], pts[i], Math.max(3, Math.trunc(0.11 * size)))
  }
  const inner = convexMask([0, 1, 5, 9, 13, 17].map((i) => [hand[i][0] - box.x, hand[i][1] - box.y] as P2), w, h)
  for (let k = 0; k < w * h; k += 1) {
    if (inner[k]) along[k] = 1
  }
  const color = (k: number): Anime25DVec3 => texel(variant, at(k))
  const onPalm: Anime25DVec3[] = []
  for (let k = 0; k < w * h; k += 1) {
    if (inner[k] && m[k]) onPalm.push(color(k))
  }
  if (onPalm.length <= 50) return
  const skin = medianColor(onPalm)
  const like = new Uint8Array(w * h)
  for (let k = 0; k < w * h; k += 1) {
    if (along[k]) like[k] = Math.max(...color(k).map((v, c) => Math.abs(v - skin[c]))) < 48 ? 1 : 0
  }
  const grown = closeSquare(Uint8Array.from(m, (inArm, k) => (inArm || (core[k] && like[k]) ? 1 : 0)), w, h, 5)
  const reach = Math.trunc(0.15 * size) | 1
  const nearFinger = dilateSquare(core, w, h, 5)
  const nearPalm = dilateSquare(inner, w, h, reach)
  for (let k = 0; k < w * h; k += 1) {
    if (!along[k]) continue
    // Only skin the picture left as the portrait had it: a palm laid over the chest changed it.
    m[k] = like[k] && !nearFinger[k] && !nearPalm[k] && difference[at(k)] < 20 ? 0 : grown[k]
  }
  // The hand's own piece, not crumbs; holes left inside the hand are the hand.
  const { labels, sizes } = components(m, w, h)
  if (sizes.length > 2) {
    const most = Math.max(...sizes.slice(1))
    for (let k = 0; k < w * h; k += 1) {
      if (m[k] && sizes[labels[k]] < 0.02 * most) m[k] = 0
    }
  }
  const filled = Uint8Array.from(m)
  fillHoles(filled, w, h)
  for (let k = 0; k < w * h; k += 1) {
    if (along[k]) m[k] = filled[k]
  }
}

/**
 * Hanging, how far the drawn arm reaches either side of the bone (+ along (-dy, dx), - the other way) at the
 * radius's places along it, null where the bone is off the drawn arm. The modelled arm is shown hanging too, and a
 * round tube's outline is not the drawing's: a sleeve flaring out at its foot let the body show beside the tube.
 */
function measureRestReach(
  base: (x: number, y: number) => boolean,
  W: number,
  H: number,
  radius: number[],
  a2: P2,
  e2: P2,
  w2: P2,
  cuff: number,
): Array<[number, number] | null> {
  const out = linspace(0, 1, radius.length).map((v, i): [number, number] | null => {
    const [a, b, t] = v <= 0.5 ? [a2, e2, v / 0.5] : [e2, add2(e2, mul2(sub2(w2, e2), cuff)), (v - 0.5) / 0.5]
    const d = unit2(sub2(b, a))
    const nrm: P2 = [-d[1], d[0]]
    const c = add2(a, mul2(sub2(b, a), t))
    const drawn = (step: number) => base(Math.trunc(c[0] + nrm[0] * step), Math.trunc(c[1] + nrm[1] * step))
    // Measured wherever the drawn arm is within the tube's own width of the bone (a sleeve's foot may lie to one
    // side of it), from its far edge on that side.
    const r = Math.trunc(radius[i])
    const near: number[] = []
    for (let k = -r; k <= r; k += 1) {
      if (drawn(k)) near.push(k)
    }
    if (!near.length) return null
    const reach = [1, -1].map((sgn) => {
      if (!near.some((k) => k * sgn > 0)) return 0
      let got = 0
      let gap = 0
      for (let step = 1; step < Math.trunc(3 * radius[i]) + 20; step += 1) {
        const x = Math.trunc(c[0] + nrm[0] * sgn * step)
        const y = Math.trunc(c[1] + nrm[1] * sgn * step)
        // To the picture's edge and no further: past it the portrait laid on the sleeve is its edge pixels drawn
        // out in streaks.
        if (!(x >= 0 && y >= 0 && x < W && y < H)) break
        if (base(x, y)) {
          got = step
          gap = 0
        } else if (++gap > 3) {
          break
        }
      }
      return got
    })
    return [reach[0], reach[1]]
  })
  // Smoothed along the arm (a ragged drawn edge would ripple the outline as it rises).
  for (const k of [0, 1]) {
    const values = out.map((o) => (o ? o[k] : null))
    out.forEach((o, i) => {
      if (!o) return
      const near = values.slice(Math.max(0, i - 1), i + 2).filter((x): x is number => x !== null)
      o[k] = round(median(near), 1)
    })
  }
  return out
}

interface SleevePicture {
  img: ArrayLike<number>
  mask: Uint8Array
  joints: [Anime25DVec3, Anime25DVec3, Anime25DVec3]
  hand?: P2[]
}

/**
 * The sleeve laid out from the pictures in order (RGB, SLEEVE_ROWS along by SLEEVE_AROUND round, u 0 toward the
 * viewer): each one fills only what the ones before it left, one picture per texel and never an average (the
 * pictures' sleeves do not line up); the back nobody drew is the front turned over, and what is still unseen takes
 * the nearest seen texel round its own ring.
 */
function layOnSleeve(W: number, H: number, radius: number[], cuff: number, rows: number, order: SleevePicture[]): Uint8Array {
  // Only the first `rows` of it, from the shoulder: what is wanted of it is the upper arm.
  const TV = rows
  const TU = SLEEVE_AROUND
  const acc = new Uint8Array(TV * TU * 3)
  const best = new Float32Array(TV * TU)
  const seen = new Uint8Array(TV * TU)
  const around = Array.from({ length: TU }, (_, j) => {
    const th = ((j + 0.5) / TU) * 2 * Math.PI
    return [Math.cos(th), Math.sin(th)] as const
  })
  for (const pic of order) {
    const zone = pic.hand ? convexPatch(pic.hand, 11, W, H).at : () => false
    const usable = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && pic.mask[y * W + x] > 0 && !zone(x, y)
    // Near the edge of what was drawn a picture counts for less: no seams where two meet.
    const inside = (x: number, y: number) => {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!usable(x + dx, y + dy) && x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < H) return false
        }
      }
      return true
    }
    const [s3, e3, w3] = pic.joints
    for (let i = 0; i < TV; i += 1) {
      const v = (i + 0.5) / SLEEVE_ROWS
      const [a, b, t] = v <= 0.5 ? [s3, e3, v / 0.5] : [e3, add3(e3, mul3(sub3(w3, e3), cuff)), (v - 0.5) / 0.5]
      const { f, sd } = tubeFrame(sub3(b, a))
      const r = interp(v, linspace(0, 1, radius.length), radius)
      const c = add3(a, mul3(sub3(b, a), t))
      for (let j = 0; j < TU; j += 1) {
        const k = i * TU + j
        if (seen[k]) continue
        const n = add3(mul3(f, around[j][0]), mul3(sd, around[j][1]))
        if (n[2] < 0.15) continue
        const x = Math.trunc(c[0] + n[0] * r)
        const y = Math.trunc(c[1] + n[1] * r)
        // The picture's bottom rows run on below its edge: never taken.
        if (!(x >= 0 && y >= 0 && x < W && y < H - 8) || !usable(x, y) || !inside(x, y)) continue
        for (let ch = 0; ch < 3; ch += 1) acc[k * 3 + ch] = pic.img[(y * W + x) * 3 + ch]
        best[k] = n[2]
        seen[k] = 1
      }
    }
  }
  const front = (j: number) => {
    const u = (j + 0.5) / TU
    return u < 0.12 || u > 0.88
  }
  for (let i = 0; i < TV; i += 1) {
    const v = (i + 0.5) / SLEEVE_ROWS
    const ring: Anime25DVec3[] = []
    for (let j = 0; j < TU; j += 1) {
      if (seen[i * TU + j] && front(j)) ring.push(texel(acc, i * TU + j))
    }
    if (ring.length < 4) continue
    // Taken at a slant, a texel far from the colour its ring has facing the viewer is the body or lining beside the
    // drawn arm, not the sleeve.
    const ref = medianColor(ring)
    const limit = v > 0.85 ? 40 : 70
    for (let j = 0; j < TU; j += 1) {
      const k = i * TU + j
      const off = Math.max(...[0, 1, 2].map((ch) => Math.abs(acc[k * 3 + ch] - ref[ch]))) > limit
      if (off && best[k] < 0.68) seen[k] = 0
    }
    // The forearm's end (the cuff) is bands round the arm: its sides are its front carried round.
    let square = 0
    for (let j = 0; j < TU; j += 1) {
      if (seen[i * TU + j] && best[i * TU + j] >= 0.8) square += 1
    }
    if (v > 0.75 && square >= 4) {
      for (let j = 0; j < TU; j += 1) {
        if (best[i * TU + j] < 0.8) seen[i * TU + j] = 0
      }
    }
  }
  const tex = Uint8Array.from(acc)
  const known = Uint8Array.from(seen)
  for (let i = 0; i < TV; i += 1) {
    for (let j = 0; j < TU; j += 1) {
      const k = i * TU + j
      const m = i * TU + (TU - 1 - j)
      if (!seen[k] && seen[m]) {
        tex.copyWithin(k * 3, m * 3, m * 3 + 3)
        known[k] = 1
      }
    }
  }
  const filled = Uint8Array.from(tex)
  const ringOk: number[] = []
  for (let i = 0; i < TV; i += 1) {
    const have: number[] = []
    for (let j = 0; j < TU; j += 1) {
      if (known[i * TU + j]) have.push(j)
    }
    if (!have.length) continue
    ringOk.push(i)
    for (let j = 0; j < TU; j += 1) {
      if (known[i * TU + j]) continue
      let pick = have[0]
      let nearest = Infinity
      for (const h of have) {
        const d = Math.min(Math.abs(h - j), TU - Math.abs(h - j))
        if (d < nearest) {
          nearest = d
          pick = h
        }
      }
      filled.set(tex.subarray((i * TU + pick) * 3, (i * TU + pick) * 3 + 3), (i * TU + j) * 3)
    }
  }
  if (!ringOk.length) return filled
  for (let i = 0; i < TV; i += 1) {
    if (ringOk.includes(i)) continue
    let row = ringOk[0]
    for (const r of ringOk) {
      if (Math.abs(r - i) < Math.abs(row - i)) row = r
    }
    filled.copyWithin(i * TU * 3, row * TU * 3, (row + 1) * TU * 3)
  }
  // Only what was carried round is softened, a little, along the ring and the arm.
  const out = Uint8Array.from(filled)
  for (let ch = 0; ch < 3; ch += 1) {
    const plane = new Float32Array(TV * TU)
    for (let k = 0; k < TV * TU; k += 1) plane[k] = filled[k * 3 + ch]
    const soft = gaussian(plane, TU, TV, 1.5, true)
    for (let k = 0; k < TV * TU; k += 1) {
      if (!known[k]) out[k * 3 + ch] = Math.max(0, Math.min(255, Math.trunc(soft[k])))
    }
  }
  return out
}

/** The tube's frame for bone direction d: 'front' as close to the viewer as d allows, and the side. */
function tubeFrame(d0: Anime25DVec3): { f: Anime25DVec3; sd: Anime25DVec3 } {
  const d = unit3(d0)
  const f = unit3(sub3([0, 0, 1], mul3(d, d[2])))
  return { f, sd: cross3(d, f) }
}
