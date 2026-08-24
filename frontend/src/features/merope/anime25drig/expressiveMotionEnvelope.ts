import {
  mixBoundedExpressionChannel,
  mixEyeOpen,
} from './performanceExpression'

interface SemanticHeadOffset {
  angleY: number
  angleZ: number
}

interface SpeechExpressionOffset {
  brow: number
  eyeOpen: number
  angleY: number
}

interface ExpressiveMotionTarget {
  brow: number
  eyeOpenL: number
  eyeOpenR: number
  angleY: number
  angleZ: number
}

/**
 * Extra range reserved for active expression, applied after the conservative
 * semantic and co-speech poses have already been composed.
 */
const SEMANTIC_VERTICAL_EXTRA = 0.1
const SEMANTIC_ROLL_EXTRA = 0.18
const SPEECH_HEAD_EXTRA = 0.15
const SPEECH_FACE_EXTRA = 0.12

/**
 * Moderately widens active expression without changing idle/manual ranges.
 * The bounded mixers keep combined authored, ambient, and expressive sources
 * continuous near the driver's hard limits.
 */
export function applyExpressiveMotionEnvelope(
  target: ExpressiveMotionTarget,
  semantic: Readonly<SemanticHeadOffset>,
  speech: Readonly<SpeechExpressionOffset>,
): void {
  target.angleY = mixBoundedExpressionChannel(
    target.angleY,
    finiteOrZero(semantic.angleY) * SEMANTIC_VERTICAL_EXTRA +
      finiteOrZero(speech.angleY) * SPEECH_HEAD_EXTRA,
    -1,
    1,
    0,
  )
  target.angleZ = mixBoundedExpressionChannel(
    target.angleZ,
    finiteOrZero(semantic.angleZ) * SEMANTIC_ROLL_EXTRA,
    -1,
    1,
    0,
  )
  target.brow = mixBoundedExpressionChannel(
    target.brow,
    finiteOrZero(speech.brow) * SPEECH_FACE_EXTRA,
    -1,
    1,
    0,
  )
  const eyeExtra = finiteOrZero(speech.eyeOpen) * SPEECH_FACE_EXTRA
  target.eyeOpenL = mixEyeOpen(target.eyeOpenL, eyeExtra)
  target.eyeOpenR = mixEyeOpen(target.eyeOpenR, eyeExtra)
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0
}
