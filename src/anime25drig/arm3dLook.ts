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
 * on the way (a bust's was two arms, one fading over the other). The sleeve, palm and colours are the leading
 * gesture's (the wave, its hand open and whole; else the first, a bust's the one folded least); each finger's widths the first picture's that
 * shows it, a finger no picture shows left hidden. A standing figure's (every gesture with its drawn hanging
 * hand) or a bust's (`bust`: none with one, nor a hanging forearm's length; of this look its arm takes the sleeve,
 * its sleeve's end and hand each gesture's own, `arm3DBustOwn`); null for any other, whose gestures each keep
 * their own.
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
  // (A bust's is the gestures' own drawing about the elbow whether or not a band was found there.)
  const restBand = first.restBand ?? (bust ? [...ARM3D_BUST_LIFTED] as [number, number] : undefined)
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
      ...(restBand ? { restBand } : {}),
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

/**
 * A bust's arm in its look, but what its own picture alone says: where the sleeve ends on this gesture's forearm
 * (and its forearm bare past it), and its hand. The drawn hand begins where that picture ends the sleeve (a sleeve
 * ending where another has it left a block of plain wrist between the two); and its hand is that picture's drawing,
 * the model under it fitted to it finger by finger (in another picture's widths it fell short of the drawing, a
 * crack at a finger's root as the hand left).
 */
export function arm3DBustOwn(inLook: Arm3DShape, own: Arm3DShape): Arm3DShape {
  const { bare: _bare, ...rest } = inLook
  return {
    ...rest,
    cuff: own.cuff,
    bareShift: own.bareShift,
    ...(own.bare === undefined ? {} : { bare: own.bare }),
    fingers: own.fingers,
    fingerProfile: own.fingerProfile,
    keyProfile: own.keyProfile,
    palmOutline: own.palmOutline,
    hiddenFingers: own.hiddenFingers,
  }
}
