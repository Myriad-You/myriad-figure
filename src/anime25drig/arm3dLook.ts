import type { Arm3DShape } from './arm3dMotion'
import type { Anime25DArmModel } from './types'

/** What an arm looks like whatever it does: its sleeve's widths, its fingers', its palm, its colours. */
export type Arm3DLook = Pick<Anime25DArmModel, 'radius' | 'drawnRadius' | 'shortSleeve' | 'cuff' | 'restCuff' | 'cuffFrom' | 'bare' | 'bareShift' | 'restEnd' | 'restBand' | 'restReach' | 'fingers' | 'fingerProfile' | 'keyProfile' | 'palmOutline' | 'hiddenFingers' | 'skin' | 'shade' | 'line'>

/**
 * One look for a standing figure's arm out of its gestures' pictures: each picture measured the same arm a
 * little differently (a sleeve a few pixels wider, a finger thinner), and the arm going from one gesture to
 * another changed its looks on the way. The sleeve, palm and colours are the leading gesture's (the wave, its
 * hand open and whole; else the first); each finger's widths the first picture's that shows it, a finger no
 * picture shows left hidden. Null for a bust, whose gestures each keep their own.
 */
export function arm3DOneLook(gestures: ReadonlyArray<{ gesture: string; model: Anime25DArmModel }>): { lead: number; look: Arm3DLook } | null {
  if (gestures.length === 0 || gestures.some((g) => !g.model.restHand)) return null
  const lead = Math.max(0, gestures.findIndex((g) => g.gesture === 'wave'))
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
