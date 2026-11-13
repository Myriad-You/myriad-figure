import type { Arm3DShape } from './arm3dMotion'
import type { Anime25DArmModel } from './types'

/** What an arm looks like whatever it does: its sleeve's widths, its fingers', its palm, its colours. */
export type Arm3DLook = Pick<Anime25DArmModel, 'radius' | 'drawnRadius' | 'shortSleeve' | 'cuff' | 'restCuff' | 'cuffFrom' | 'bare' | 'bareShift' | 'restEnd' | 'restBand' | 'restReach' | 'fingers' | 'fingerProfile' | 'keyProfile' | 'palmOutline' | 'hiddenFingers' | 'skin' | 'shade' | 'line'>

/**
 * A bust's sleeve, lifted, is the gestures' own drawing of it about the elbow (along the arm: shoulder 0, elbow
 * 0.5, wrist 1): the portrait's above the elbow met the gesture's below it with whatever the two draw there (a
 * band) worn twice. No further down: past it the sleeve is the gesture's anyway, and baked for this stretch alone
 * a long sleeve came out without its cuff.
 */
export const ARM3D_BUST_LIFTED: readonly [number, number] = [0.3, 0.62]

/**
 * One look for an arm out of its gestures' pictures: each picture measured the same arm a little differently (a
 * sleeve a few pixels wider, a finger thinner), and the arm going from one gesture to another changed its looks
 * on the way (a bust's was two arms, one fading over the other). A standing figure's sleeve, palm and colours are the leading
 * gesture's (the wave, its hand open and whole; else the first, a bust's the one folded least); each finger's widths the first picture's that
 * shows it, a finger no picture shows left hidden. A standing figure's (every gesture with its drawn hanging
 * hand) or a bust's (`bust`: none with one, nor a hanging forearm's length; its arm hangs as the leading one, and
 * held is each gesture's own as its picture draws it, turned from one into another on the way,
 * `arm3DMixedWear`); null for any other, whose gestures each keep their own.
 */
export function arm3DOneLook(gestures: ReadonlyArray<{ gesture: string; model: Anime25DArmModel }>): { lead: number; look: Arm3DLook; bust: boolean } | null {
  if (gestures.length === 0) return null
  const bust = gestures.every((g) => !g.model.restHand && g.model.restFore === undefined)
  if (!bust && gestures.some((g) => !g.model.restHand)) return null
  // (A bust's, without a wave, the one folded least: a cuff folded up by the elbow lies over its own sleeve in the
  // picture, and led, that picture's sleeve had the cuff on it where every other pose shows it.)
  const led = (bust ? ['wave', 'chest', 'point'] : ['wave']).map((name) => gestures.findIndex((g) => g.gesture === name)).find((i) => i >= 0)
  const lead = led ?? 0
  const first = gestures[lead].model
  const order = [first, ...gestures.filter((_, i) => i !== lead).map((g) => g.model)]
  const fingers = [...first.fingers]
  const fingerProfile = [...first.fingerProfile]
  const keyProfile = [...first.keyProfile]
  const hiddenFingers: number[] = []
  for (let ci = 0; ci < 5; ci += 1) {
    const from = order.find((m) => !m.hiddenFingers.includes(ci) && (m.fingers[ci] ?? 0) > 0)
    if (!from) {
      if (first.hiddenFingers.includes(ci)) hiddenFingers.push(ci)
      continue
    }
    fingers[ci] = from.fingers[ci]
    fingerProfile[ci] = from.fingerProfile[ci] ?? []
    const key = from.keyProfile[ci]
    if (key) keyProfile[ci] = key
    else delete keyProfile[ci]
  }
  return {
    lead,
    bust,
    look: {
      radius: first.radius,
      ...(first.drawnRadius ? { drawnRadius: first.drawnRadius } : {}),
      ...(first.shortSleeve === undefined ? {} : { shortSleeve: first.shortSleeve }),
      cuff: first.cuff,
      ...(first.restCuff === undefined || first.cuffFrom === undefined ? {} : { restCuff: first.restCuff, cuffFrom: first.cuffFrom }),
      ...(first.bare === undefined ? {} : { bare: first.bare }),
      bareShift: first.bareShift,
      restEnd: first.restEnd,
      ...(first.restBand ? { restBand: first.restBand } : {}),
      restReach: first.restReach,
      fingers,
      fingerProfile,
      keyProfile,
      palmOutline: first.palmOutline,
      hiddenFingers,
      skin: first.skin,
      shade: first.shade,
      line: first.line,
    },
  }
}

/** A gesture's arm (its own bones and poses) in the look all its side's gestures share. */
export function arm3DInLook(shape: Arm3DShape, look: Arm3DLook): Arm3DShape {
  const { bare: _bare, restBand: _band, drawnRadius: _drawn, shortSleeve: _short, restCuff: _end, cuffFrom: _from, ...own } = shape
  return { ...own, ...look }
}

/** What of a bust's sleeve turns from one gesture's into another's on the way between them: its widths, where the portrait's ends, how dark it is lined. */
export type Arm3DWear = Pick<Arm3DShape, 'radius' | 'restEnd'> & { ink: number }

/**
 * How much a bust's sleeve is each of its gestures' (shares, summing to 1), a step on toward being all `to`'s: the
 * others give way in the shares they had, so turned again on the way nothing of it jumps.
 */
export function arm3DTurnWear(shares: readonly number[], to: number, step: number): number[] {
  if (to < 0 || to >= shares.length) return [...shares]
  const was = Math.max(0, Math.min(1, shares[to] ?? 0))
  const now = Math.min(1, was + Math.max(0, step))
  const rest = was < 1 ? (1 - now) / (1 - was) : 0
  return shares.map((share, i) => (i === to ? now : share * rest))
}

/**
 * A bust's sleeve this frame: its gestures' own by their shares, and `hung` (1 hanging) the leading gesture's, the
 * arm all its gestures hang as. Widths measured at other places than gesture `of`'s (the one shown) are left out.
 */
export function arm3DMixedWear(wears: readonly Arm3DWear[], shares: readonly number[], of: number, lead: number, hung: number): Arm3DWear {
  const main = wears[of]
  const fits = (w: Arm3DWear | undefined): w is Arm3DWear => w !== undefined && w.radius.length === main.radius.length
  let sum = 0
  const mixed: Arm3DWear = { radius: main.radius.map(() => 0), restEnd: 0, ink: 0 }
  wears.forEach((w, i) => {
    const share = fits(w) ? Math.max(0, shares[i] ?? 0) : 0
    if (share <= 0) return
    sum += share
    w.radius.forEach((r, k) => { mixed.radius[k] += r * share })
    mixed.restEnd += w.restEnd * share
    mixed.ink += w.ink * share
  })
  const own: Arm3DWear = sum > 0 ? { radius: mixed.radius.map((r) => r / sum), restEnd: mixed.restEnd / sum, ink: mixed.ink / sum } : main
  const h = fits(wears[lead]) ? Math.max(0, Math.min(1, hung)) : 0
  if (h <= 0) return own
  const to = wears[lead]
  return { radius: own.radius.map((r, k) => r + (to.radius[k] - r) * h), restEnd: own.restEnd + (to.restEnd - own.restEnd) * h, ink: own.ink + (to.ink - own.ink) * h }
}

/**
 * Whose drawings of the sleeve the arm wears this frame, drawn in gesture `drawn`'s: [another gesture, how much of
 * it] (null with none), then how much of what that gives is the leading one's (`hung`). Of the two gestures with
 * the most share its drawing changes over where they are even, quickly: half of each, the sleeve wore two cuffs
 * faintly.
 */
export function arm3DWearDrawn(shares: readonly number[], drawn: number, lead: number, hung: number): { other: [number, number] | null; lead: number } {
  const order = shares.map((share, i) => [share, i] as const).filter(([share]) => share > 0).sort((a, b) => b[0] - a[0] || a[1] - b[1])
  const h = lead >= 0 ? Math.max(0, Math.min(1, hung)) : 0
  // (Drawn in the leading one's own, hanging is less of the other's, not more of the leading one's over it.)
  const led = lead === drawn ? 0 : h
  const less = lead === drawn ? 1 - h : 1
  const other = (of: number, much: number): [number, number] | null => (much * less > 0 ? [of, much * less] : null)
  if (order.length === 0) return { other: null, lead: led }
  const [first, second] = order
  if (!second) return { other: first[1] === drawn ? null : other(first[1], 1), lead: led }
  // The pair in a set order, so that nothing turns over as their shares cross.
  const [p, q] = first[1] < second[1] ? [first, second] : [second, first]
  const t = q[0] / (p[0] + q[0])
  const ofQ = t <= 0.4 ? 0 : t >= 0.6 ? 1 : ((t - 0.4) / 0.2) ** 2 * (3 - 2 * (t - 0.4) / 0.2)
  if (drawn === p[1]) return { other: other(q[1], ofQ), lead: led }
  if (drawn === q[1]) return { other: other(p[1], 1 - ofQ), lead: led }
  return { other: other(ofQ >= 0.5 ? q[1] : p[1], 1), lead: led }
}
