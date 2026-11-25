import type { MeropeRigManifest } from '../rig/types'
import type { Anime25DMotionEnvelopeProfile } from './motionEnvelope'
import type { StylizedExpressionMotion } from './stylizedExpressionMotion'
import type { Anime25DPlayback } from './types'

// What the stage reads of whatever moves the figure. The stage draws `current`; a driving writes it, once per
// substep, and answers the few questions the body, the face and the sticker ask besides.

/** Body controls a driving can direct, which the body's own automatic posture then gives way to. */
export type Anime25DDirectedBodyControl =
  | 'torsoTurn' | 'torsoRise' | 'torsoPitch'
  | 'leftArmRaise' | 'rightArmRaise' | 'leftArmSwing' | 'rightArmSwing'

/** What the body reads of the driving each substep. */
export interface Anime25DBodyDriving {
  /** How far a directed control owns its body motion, 0 to 1. */
  directedBodyWeight: (control: Anime25DDirectedBodyControl) => number
  /** The accent the jaw follows. */
  readonly jawEmphasis: number
  /** The stylized face's own motion, which the head and mouth deformers read. */
  readonly stylizedMotion: Readonly<StylizedExpressionMotion> | null
  /** How much of the stylized head pulse comes through. */
  readonly stylizedHeadShare: number
}

/** One drawn frame, reported as the tick ends. */
export interface Anime25DFrameSample {
  dropped: boolean
  cpuMs?: number
}

/** The bound geometry of a package, as the stage measured it, that decides what of the body can be moved. */
export interface Anime25DBoundBody {
  torsoVolume: boolean
  arms: readonly ('L' | 'R')[]
}

/**
 * What drives the stage. `Measured` is what the driving measures of a package before the stage takes it: measured
 * beside the live package (and may fail there), taken with it in a step that cannot fail.
 */
export interface Anime25DDriving<Measured = unknown> extends Anime25DBodyDriving {
  /** How far a sticker face owns the mouth. */
  readonly sillyMouthShare: number
  /** One substep: writes the stage's `current` for `time`, `dt` after the last. */
  step: (dt: number, time: number) => void
  /** How strongly the thinking sticker shows, 0 to 1. */
  thinkingLevel: () => number
  /** A frame was drawn. */
  drawn: () => void
  /** A tick ended. */
  frame: (sample: Anime25DFrameSample) => void
  /** Measures a package; changes nothing live. */
  measure: (playback: Anime25DPlayback) => Measured
  /** Takes a package measured with measure(), as the stage takes it. Cannot fail. */
  bind: (measured: Measured, motionEnvelopeProfile: Anime25DMotionEnvelopeProfile) => void
  /** What can be moved of a package the stage has compiled and measured; changes nothing live. */
  measureCapabilities: (rigManifest: MeropeRigManifest | undefined, body: Anime25DBoundBody) => readonly string[]
  /** Takes what measureCapabilities() gave, as the stage takes the package. Cannot fail. */
  bindCapabilities: (capabilities: readonly string[]) => void
}
