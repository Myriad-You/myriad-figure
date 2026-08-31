import type { PerformanceCue } from '../../../services/agent/types'
import type { BehaviorResource } from '../motion/behaviorResources'
import type { MotionChannel } from '../motion/channels'
import type { Anime25DDriver } from './driver'
import type { PerformanceExpressionOffset } from './performanceExpression'

type CueIntent = PerformanceCue['intent']

export interface PerformanceCueDefinition {
  /** Every exclusive channel this cue can write, including stylized motion. */
  channels: readonly MotionChannel[]
  /** Renderer-neutral body resources; channels above are its compatibility map. */
  resources: readonly BehaviorResource[]
  sticker?: true
  driver: (amount: number) => Partial<Anime25DDriver>
  expression: (amount: number) => Partial<PerformanceExpressionOffset>
}

const EXPRESSION = ['expression'] as const
const EXPRESSION_BODY = ['expression', 'headBody'] as const
const EXPRESSION_GAZE = ['expression', 'gaze'] as const
const EXPRESSION_GAZE_BODY = ['expression', 'gaze', 'headBody'] as const
const FACE = ['face.expression'] as const
const FACE_GAZE = ['face.expression', 'face.gaze'] as const
const FACE_TORSO = ['face.expression', 'body.head', 'body.torso'] as const
const FACE_TORSO_ARMS = [
  'face.expression',
  'body.head',
  'body.torso',
  'body.arm.left',
  'body.arm.right',
] as const
const FACE_GAZE_TORSO = [
  'face.expression',
  'face.gaze',
  'body.head',
  'body.torso',
] as const
const FACE_TORSO_ARMS_BUST = [...FACE_TORSO_ARMS, 'secondary.bust'] as const

/**
 * One factual definition for each semantic cue. Rendering patches, stylized
 * classification and lease occupancy are all derived from this registry.
 */
export const PERFORMANCE_CUE_DEFINITIONS = {
  greet: {
    channels: EXPRESSION_BODY,
    resources: FACE_TORSO_ARMS,
    driver: (amount) => ({ body: 0.09 * amount, armY: 0.12 * amount }),
    expression: (amount) => ({
      angleZ: -0.05 * amount,
      brow: 0.17 * amount,
    }),
  },
  respond: {
    channels: EXPRESSION,
    resources: FACE,
    driver: () => ({}),
    expression: (amount) => ({ angleY: -0.035 * amount, brow: 0.13 * amount }),
  },
  question: {
    channels: EXPRESSION_BODY,
    resources: FACE_TORSO,
    driver: (amount) => ({ body: 0.06 * amount }),
    expression: (amount) => ({
      angleZ: 0.075 * amount,
      brow: 0.26 * amount,
      eyeOpen: 0.05 * amount,
    }),
  },
  delight: {
    channels: EXPRESSION_BODY,
    resources: FACE_TORSO_ARMS_BUST,
    driver: (amount) => ({ armPos: 0.22 * amount, bust: 2.8 }),
    expression: (amount) => ({
      angleY: -0.05 * amount,
      brow: 0.22 * amount,
      eyeOpen: -0.025 * amount,
      eyeSqueeze: 0.84 * amount,
      mouthForm: 0.18 * amount,
    }),
  },
  emphasize: {
    channels: EXPRESSION_BODY,
    resources: FACE_TORSO,
    driver: (amount) => ({ body: 0.22 * amount }),
    expression: (amount) => ({ angleY: 0.055 * amount, brow: 0.2 * amount }),
  },
  listen: {
    channels: EXPRESSION,
    resources: FACE,
    driver: () => ({}),
    expression: (amount) => ({ angleY: 0.04 * amount, brow: 0.12 * amount }),
  },
  notify: {
    channels: EXPRESSION_BODY,
    resources: FACE_TORSO,
    driver: (amount) => ({ body: 0.18 * amount }),
    expression: (amount) => ({
      angleZ: -0.045 * amount,
      brow: 0.22 * amount,
      eyeOpen: 0.055 * amount,
    }),
  },
  think: {
    channels: EXPRESSION_GAZE,
    resources: FACE_GAZE,
    driver: () => ({}),
    expression: (amount) => ({
      angleZ: -0.14 * amount,
      brow: 0.14 * amount,
      eyeX: 0.5 * amount,
      eyeY: -0.36 * amount,
    }),
  },
  dizzy: {
    channels: EXPRESSION,
    resources: FACE,
    sticker: true,
    driver: () => ({}),
    expression: () => ({ eyeDizzy: 1 }),
  },
  cry: {
    channels: EXPRESSION,
    resources: FACE,
    sticker: true,
    driver: () => ({}),
    expression: (amount) => ({
      brow: 0.2 * amount,
      browAngSym: -0.3 * amount,
      eyeCry: 1,
      mouthForm: -0.12 * amount,
    }),
  },
  angry: {
    channels: EXPRESSION_BODY,
    resources: FACE_TORSO,
    sticker: true,
    driver: (amount) => ({ body: 0.1 * amount }),
    expression: (amount) => ({ anger: amount }),
  },
  speechless: {
    channels: EXPRESSION_GAZE_BODY,
    resources: FACE_GAZE_TORSO,
    sticker: true,
    driver: (amount) => ({ body: -0.045 * amount, idle: false }),
    expression: (amount) => ({ speechless: amount }),
  },
  maniac: {
    channels: EXPRESSION_GAZE_BODY,
    resources: FACE_GAZE_TORSO,
    sticker: true,
    driver: (amount) => ({ body: 0.055 * amount, idle: false }),
    expression: (amount) => ({ maniac: amount }),
  },
  silly: {
    channels: EXPRESSION_BODY,
    resources: FACE_TORSO,
    sticker: true,
    driver: (amount) => ({ body: -0.03 * amount, idle: false }),
    expression: (amount) => ({ silly: amount }),
  },
  lovestruck: {
    channels: EXPRESSION_GAZE_BODY,
    resources: FACE_GAZE_TORSO,
    sticker: true,
    driver: (amount) => ({ body: -0.025 * amount, idle: false }),
    expression: (amount) => ({ lovestruck: amount }),
  },
} satisfies Record<CueIntent, PerformanceCueDefinition>

export function performanceCueDefinition(
  intent: CueIntent,
): PerformanceCueDefinition {
  return PERFORMANCE_CUE_DEFINITIONS[intent]
}

export function cueDriverPatch(cue: PerformanceCue): Partial<Anime25DDriver> {
  return performanceCueDefinition(cue.intent).driver(cueAmount(cue))
}

export function cueExpressionPatch(
  cue: PerformanceCue,
): Partial<PerformanceExpressionOffset> {
  const definition = performanceCueDefinition(cue.intent)
  const amount = cueAmount(cue)
  const driver = definition.driver(amount)
  return {
    ...definition.expression(amount),
    ...(typeof driver.body === 'number' ? { body: driver.body } : {}),
    ...(typeof driver.armY === 'number' ? { armY: driver.armY } : {}),
    ...(typeof driver.armPos === 'number' ? { armPos: driver.armPos } : {}),
  }
}

export function cueIsSticker(intent: CueIntent): boolean {
  return performanceCueDefinition(intent).sticker === true
}

function cueAmount(cue: PerformanceCue): number {
  return Math.max(0.2, Math.min(1.4, cue.intensity))
}
