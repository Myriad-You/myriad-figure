import type { PerformanceCue } from '../../../services/agent/types'
import type { BehaviorResource } from '../motion/behaviorResources'
import type { MotionChannel } from '../motion/channels'
import type { Anime25DDriver } from './driver'
import type { PerformanceExpressionOffset } from './performanceExpression'
import { IDENTITY_DRIVER } from './driver'

type CueIntent = PerformanceCue['intent']

export interface PerformanceCueDefinition {
  /** Every exclusive channel this cue can write, including stylized motion. */
  channels: readonly MotionChannel[]
  /** Renderer-neutral body resources; channels above are its compatibility map. */
  resources: readonly BehaviorResource[]
  sticker?: true
  driver: (amount: number) => Partial<Anime25DDriver>
  expression: (
    amount: number,
    poseAmount: number,
  ) => Partial<PerformanceExpressionOffset>
}

const EXPRESSION = ['expression'] as const
const EXPRESSION_BODY = ['expression', 'headBody'] as const
const EXPRESSION_GAZE_BODY = ['expression', 'gaze', 'headBody'] as const
const FACE = ['face.expression'] as const
const FACE_HEAD = ['face.expression', 'body.head'] as const
const FACE_GAZE_HEAD = ['face.expression', 'face.gaze', 'body.head'] as const
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
    driver: (poseAmount) => ({
      body: 0.22 * poseAmount,
      armY: 0.3 * poseAmount,
    }),
    expression: (amount, poseAmount) => ({
      angleZ: -0.11 * poseAmount,
      brow: 0.17 * amount,
    }),
  },
  respond: {
    channels: EXPRESSION_BODY,
    resources: FACE_HEAD,
    driver: () => ({}),
    expression: (amount, poseAmount) => ({
      angleY: -0.09 * poseAmount,
      brow: 0.13 * amount,
    }),
  },
  question: {
    channels: EXPRESSION_BODY,
    resources: FACE_TORSO,
    driver: (poseAmount) => ({ body: 0.18 * poseAmount }),
    expression: (amount, poseAmount) => ({
      angleZ: 0.15 * poseAmount,
      brow: 0.26 * amount,
      eyeOpen: 0.05 * amount,
    }),
  },
  delight: {
    channels: EXPRESSION_BODY,
    resources: FACE_TORSO_ARMS_BUST,
    driver: (poseAmount) => ({
      body: 0.16 * poseAmount,
      armY: 0.22 * poseAmount,
      armPos: 0.34 * poseAmount,
      bust: IDENTITY_DRIVER.bust + 0.26 * poseAmount,
    }),
    expression: (amount, poseAmount) => ({
      angleY: -0.12 * poseAmount,
      brow: 0.22 * amount,
      eyeOpen: -0.025 * amount,
      eyeSqueeze: 0.84 * amount,
      mouthForm: 0.18 * amount,
    }),
  },
  emphasize: {
    channels: EXPRESSION_BODY,
    resources: FACE_TORSO,
    driver: (poseAmount) => ({ body: 0.4 * poseAmount }),
    expression: (amount, poseAmount) => ({
      angleY: 0.12 * poseAmount,
      brow: 0.2 * amount,
    }),
  },
  listen: {
    channels: EXPRESSION_BODY,
    resources: FACE_HEAD,
    driver: () => ({}),
    expression: (amount, poseAmount) => ({
      angleY: 0.09 * poseAmount,
      brow: 0.12 * amount,
    }),
  },
  notify: {
    channels: EXPRESSION_BODY,
    resources: FACE_TORSO,
    driver: (poseAmount) => ({ body: 0.32 * poseAmount }),
    expression: (amount, poseAmount) => ({
      angleZ: -0.11 * poseAmount,
      brow: 0.22 * amount,
      eyeOpen: 0.055 * amount,
    }),
  },
  think: {
    channels: EXPRESSION_GAZE_BODY,
    resources: FACE_GAZE_HEAD,
    driver: () => ({}),
    expression: (amount, poseAmount) => ({
      angleZ: -0.2 * poseAmount,
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
    driver: (poseAmount) => ({ body: 0.22 * poseAmount }),
    expression: (amount) => ({ anger: amount }),
  },
  speechless: {
    channels: EXPRESSION_GAZE_BODY,
    resources: FACE_GAZE_TORSO,
    sticker: true,
    driver: (poseAmount) => ({ body: -0.18 * poseAmount, idle: false }),
    expression: (amount) => ({ speechless: amount }),
  },
  maniac: {
    channels: EXPRESSION_GAZE_BODY,
    resources: FACE_GAZE_TORSO,
    sticker: true,
    driver: (poseAmount) => ({ body: 0.17 * poseAmount, idle: false }),
    expression: (amount) => ({ maniac: amount }),
  },
  silly: {
    channels: EXPRESSION_BODY,
    resources: FACE_TORSO,
    sticker: true,
    driver: (poseAmount) => ({ body: -0.15 * poseAmount, idle: false }),
    expression: (amount) => ({ silly: amount }),
  },
  lovestruck: {
    channels: EXPRESSION_GAZE_BODY,
    resources: FACE_GAZE_TORSO,
    sticker: true,
    driver: (poseAmount) => ({ body: -0.14 * poseAmount, idle: false }),
    expression: (amount) => ({ lovestruck: amount }),
  },
} satisfies Record<CueIntent, PerformanceCueDefinition>

export function performanceCueDefinition(
  intent: CueIntent,
): PerformanceCueDefinition {
  return PERFORMANCE_CUE_DEFINITIONS[intent]
}

export function cueDriverPatch(cue: PerformanceCue): Partial<Anime25DDriver> {
  return performanceCueDefinition(cue.intent).driver(cuePoseAmount(cue))
}

export function cueExpressionPatch(
  cue: PerformanceCue,
): Partial<PerformanceExpressionOffset> {
  const definition = performanceCueDefinition(cue.intent)
  const amount = cueAmount(cue)
  const poseAmount = cuePoseAmount(cue)
  const driver = definition.driver(poseAmount)
  return {
    ...definition.expression(amount, poseAmount),
    ...(typeof driver.body === 'number' ? { body: driver.body } : {}),
    ...(typeof driver.armY === 'number' ? { armY: driver.armY } : {}),
    ...(typeof driver.armPos === 'number' ? { armPos: driver.armPos } : {}),
    ...(typeof driver.bust === 'number'
      ? { bust: driver.bust - IDENTITY_DRIVER.bust }
      : {}),
  }
}

export function cueIsSticker(intent: CueIntent): boolean {
  return performanceCueDefinition(intent).sticker === true
}

function cueAmount(cue: PerformanceCue): number {
  return Math.max(0.2, Math.min(1.4, cue.intensity))
}

/**
 * Body motion has a perceptual floor while preserving the director's dynamic
 * range. A selected action must still read at low semantic intensity; the
 * semantic amount itself continues to scale the face without this lift.
 */
export function cuePoseAmount(cue: PerformanceCue): number {
  const normalized = (cueAmount(cue) - 0.2) / 1.2
  return 0.72 + normalized * 0.68
}
