// The performance's half of the per-frame driver composition: poses, special expressions and speech landed on the
// driver. The stage's own response and blink steps come from @myriad/figure-player/internals.
import type { Anime25DDriver } from '@myriad/figure-player'
import type { Anime25DStylizedTargets, IdleBreathOffset } from '@myriad/figure-player/internals'
import type { SingingGroovePose } from '../singing/singingGroove'
import type { AmbientPose } from './ambientMotion'
import type { PerformanceExpressionOffset } from './performanceExpression'
import type { PoseGate } from './poseArbitration'
import type { OccupancyOffset } from './poseCompositor'
import type { RandomActionFrame } from './randomAction'
import type { CoSpeechExpressionOffset } from './speechExpression'
import type { AutoSpeechPose } from './speechMotion'
import type { StylizedExpressionMotion } from './stylizedExpressionMotion'
import type { ThinkingMotionPose } from './thinkingMotion'
import { IDENTITY_DRIVER } from '@myriad/figure-player'
import { semanticRollMotionOffset, semanticVerticalMotionOffset, speechBrowMotionOffset, speechHeadMotionOffset } from './expressiveMotionEnvelope'
import { applyPerformanceExpressionExtras, mixBoundedExpressionChannel, mixEyeOpen } from './performanceExpression'
import { POSE_KEY_DRIVER_FIELDS, POSE_KEYS } from './poseArbitration'
import { accumulateOccupancyOffset, accumulatePoseChannel } from './poseCompositor'

/** Resolves the mutually blocked stylized-expression inputs without allocating. */
export function resolveAnime25DStylizedTargets(
  output: Anime25DStylizedTargets,
  target: Readonly<Anime25DDriver>,
  semantic: Readonly<PerformanceExpressionOffset>,
): Anime25DStylizedTargets {
  const specialEyeBlocker =
    1 -
    Math.max(
      mixBoundedExpressionChannel(target.eyeDizzy, semantic.eyeDizzy, 0, 1, 0),
      mixBoundedExpressionChannel(
        target.eyeSqueeze,
        semantic.eyeSqueeze,
        0,
        1,
        0,
      ),
      mixBoundedExpressionChannel(target.eyeCry, semantic.eyeCry, 0, 1, 0),
    )
  output.anger =
    mixBoundedExpressionChannel(target.anger, semantic.anger ?? 0, 0, 1, 0) *
    specialEyeBlocker
  output.speechless =
    mixBoundedExpressionChannel(
      target.speechless,
      semantic.speechless ?? 0,
      0,
      1,
      0,
    ) * specialEyeBlocker
  output.maniac =
    mixBoundedExpressionChannel(target.maniac, semantic.maniac ?? 0, 0, 1, 0) *
    specialEyeBlocker
  output.silly =
    mixBoundedExpressionChannel(target.silly, semantic.silly ?? 0, 0, 1, 0) *
    specialEyeBlocker
  output.lovestruck =
    mixBoundedExpressionChannel(
      target.lovestruck,
      semantic.lovestruck ?? 0,
      0,
      1,
      0,
    ) * specialEyeBlocker
  return output
}

/**
 * One arbitrated pose write for every source that contends for the same head,
 * body, eyes and brow.
 *
 * Every shared pose producer contributes a layer with the weight
 * `resolvePoseGate` derived from ownership and occupancy. Ambient motion,
 * random action, groove, thinking, breath, directed expression and co-speech
 * therefore land on the driver once instead of rewriting it in call order.
 *
 * Channels only one source writes (the random action's brow asymmetry, eye
 * openness and iris; the thinking loop's mouth corners) are uncontended, so
 * they stay on their own path — at that source's own arbitrated weight.
 */
export function applyAnime25DComposedPose(
  target: Anime25DDriver,
  gate: PoseGate,
  sources: {
    ambient: Readonly<AmbientPose>
    randomAction: Readonly<RandomActionFrame>
    groove: Readonly<SingingGroovePose>
    thinking: Readonly<ThinkingMotionPose>
    breath: Readonly<IdleBreathOffset>
    performance: Readonly<PerformanceExpressionOffset>
    stylized: Readonly<StylizedExpressionMotion>
    coSpeech: Readonly<CoSpeechExpressionOffset>
  },
  scratch: OccupancyOffset,
  /** Receives the part that follows her breath and voice, which rides on a directed pose. */
  riding?: OccupancyOffset,
): void {
  if (riding) {
    for (const key of POSE_KEYS) riding[key] = 0
    accumulateOccupancyOffset(riding, sources.breath, gate.ambient)
    accumulateOccupancyOffset(riding, sources.coSpeech, gate.coSpeech)
    accumulatePoseChannel(riding, 'angleY', speechHeadMotionOffset(sources.coSpeech.angleY), gate.coSpeech)
    accumulatePoseChannel(riding, 'brow', speechBrowMotionOffset(sources.coSpeech.brow), gate.coSpeech)
  }
  for (const key of POSE_KEYS) scratch[key] = 0
  accumulateOccupancyOffset(scratch, sources.ambient, gate.ambient)
  accumulateOccupancyOffset(scratch, sources.randomAction, gate.random)
  accumulateOccupancyOffset(scratch, sources.groove, gate.groove)
  accumulateOccupancyOffset(scratch, sources.thinking, gate.thinking)
  accumulateOccupancyOffset(scratch, sources.breath, gate.ambient)
  accumulateOccupancyOffset(scratch, sources.performance, gate.performance)
  accumulateOccupancyOffset(scratch, sources.stylized, gate.stylized)
  accumulateOccupancyOffset(scratch, sources.coSpeech, gate.coSpeech)
  accumulatePoseChannel(
    scratch,
    'angleY',
    semanticVerticalMotionOffset(sources.performance.angleY),
    gate.performance,
  )
  accumulatePoseChannel(
    scratch,
    'angleZ',
    semanticRollMotionOffset(sources.performance.angleZ),
    gate.performance,
  )
  accumulatePoseChannel(
    scratch,
    'angleY',
    speechHeadMotionOffset(sources.coSpeech.angleY),
    gate.coSpeech,
  )
  accumulatePoseChannel(
    scratch,
    'brow',
    speechBrowMotionOffset(sources.coSpeech.brow),
    gate.coSpeech,
  )
  for (const key of POSE_KEYS) {
    const field = POSE_KEY_DRIVER_FIELDS[key]
    target[field] = mixBoundedExpressionChannel(
      target[field],
      scratch[key],
      -1,
      1,
      0,
    )
  }
  applyRandomActionExpressionExtras(
    target,
    sources.randomAction,
    gate.random.expression,
    // A voice or a song owns the mouth; an idle mood only colours a free one.
    (1 - clamp(gate.speechMouth, 0, 1)) * (1 - clamp(gate.grooveMouth, 0, 1)),
  )
  applyThinkingMouth(target, sources.thinking, gate.thinking.expression)
  target.bust = mixBoundedExpressionChannel(
    target.bust,
    (sources.performance.bust ?? 0) * gate.performance.headBody,
    0,
    4,
    IDENTITY_DRIVER.bust,
  )
}

function applyRandomActionExpressionExtras(
  target: Anime25DDriver,
  frame: Readonly<RandomActionFrame>,
  amount: number,
  mouthFree: number,
): void {
  const weight = clamp(amount, 0, 1)
  if (weight <= 0) return
  target.eyeSmile = mixBoundedExpressionChannel(target.eyeSmile, frame.eyeSmile * weight, 0, 1, 0)
  target.eyeWide = mixBoundedExpressionChannel(target.eyeWide, frame.eyeWide * weight, 0, 1, 0)
  if (frame.wink !== 0) {
    target.lidL = mixEyeOpen(target.lidL, -Math.max(0, frame.wink) * weight)
    target.lidR = mixEyeOpen(target.lidR, -Math.max(0, -frame.wink) * weight)
  }
  const mouth = weight * clamp(mouthFree, 0, 1)
  if (mouth > 0) {
    target.lipCurve = mixBoundedExpressionChannel(
      target.lipCurve,
      frame.mouthForm * mouth,
      -1,
      1,
      0,
    )
    target.jaw = Math.max(target.jaw, frame.mouthOpen * mouth)
    target.mouthRound = Math.max(target.mouthRound, frame.mouthRound * mouth)
  }
  target.browTilt = mixBoundedExpressionChannel(
    target.browTilt,
    frame.browAngSym * weight,
    -1,
    1,
    0,
  )
  target.lidL = mixEyeOpen(target.lidL, frame.eyeOpen * weight)
  target.lidR = mixEyeOpen(target.lidR, frame.eyeOpen * weight)
  target.irisScale = mixBoundedExpressionChannel(
    target.irisScale,
    frame.irisScale * weight,
    0.5,
    1.3,
    1,
  )
}

function applyThinkingMouth(
  target: Anime25DDriver,
  thinking: Readonly<ThinkingMotionPose>,
  amount: number,
): void {
  const weight = clamp(amount, 0, 1)
  if (weight <= 0) return
  target.mouthCY = mixBoundedExpressionChannel(
    target.mouthCY,
    thinking.mouthCY * weight,
    -1,
    1,
    0,
  )
  target.mouthCAng = mixBoundedExpressionChannel(
    target.mouthCAng,
    thinking.mouthCAng * weight,
    -1,
    1,
    0,
  )
  target.mouthScale = mixBoundedExpressionChannel(
    target.mouthScale,
    thinking.mouthScale * weight,
    0.5,
    1.5,
    1,
  )
}

export function applyAnime25DStylizedExpression(
  target: Anime25DDriver,
  semantic: Readonly<PerformanceExpressionOffset>,
  stylized: Readonly<StylizedExpressionMotion>,
  /** How much of the mouth is free of a voice, already eased by the caller. */
  vocalRest: number,
  semanticAmount = 1,
  stylizedAmount = 1,
): void {
  const semanticWeight = clamp(semanticAmount, 0, 1)
  const stylizedWeight = clamp(stylizedAmount, 0, 1)
  applyPerformanceExpressionExtras(target, semantic, semanticWeight)
  target.browTiltL = mixBoundedExpressionChannel(
    target.browTiltL,
    stylized.browAngL * stylizedWeight,
    -1,
    1,
    0,
  )
  target.browTiltR = mixBoundedExpressionChannel(
    target.browTiltR,
    stylized.browAngR * stylizedWeight,
    -1,
    1,
    0,
  )
  target.browTilt = mixBoundedExpressionChannel(
    target.browTilt,
    stylized.browAngSym * stylizedWeight,
    -1,
    1,
    0,
  )
  target.lidL = mixEyeOpen(
    target.lidL,
    stylized.eyeOpen * stylizedWeight,
  )
  target.lidR = mixEyeOpen(
    target.lidR,
    stylized.eyeOpen * stylizedWeight,
  )
  target.irisScale = mixBoundedExpressionChannel(
    target.irisScale,
    stylized.irisScale * stylizedWeight,
    0.5,
    1.3,
    1,
  )
  target.lipCurve = mixBoundedExpressionChannel(
    target.lipCurve,
    stylized.mouthForm * stylizedWeight,
    -1,
    1,
    0,
  )
  target.jaw = Math.max(
    target.jaw,
    stylized.mouthOpen * stylizedWeight,
  )
  // Lovestruck mouth share is an eased ratio, not a boolean 0.82 step.
  const lovestruckMouthShare = 0.18 + 0.82 * clamp(vocalRest, 0, 1)
  target.jaw = Math.max(
    target.jaw,
    stylized.lovestruckMouthOpen * lovestruckMouthShare * stylizedWeight,
  )
  target.mouthRound = Math.max(
    target.mouthRound,
    stylized.lovestruckMouthRound * lovestruckMouthShare * stylizedWeight,
  )
  target.mouthCY = mixBoundedExpressionChannel(
    target.mouthCY,
    stylized.mouthCY * stylizedWeight,
    -1,
    1,
    0,
  )
  target.mouthCAng = mixBoundedExpressionChannel(
    target.mouthCAng,
    stylized.mouthCAng * stylizedWeight,
    -1,
    1,
    0,
  )
  target.mouthScale = mixBoundedExpressionChannel(
    target.mouthScale,
    (stylized.mouthScale +
      stylized.lovestruckMouthScale * lovestruckMouthShare) *
      stylizedWeight,
    0.5,
    1.5,
    1,
  )
}

export function applyAnime25DSpeechExtras(
  target: Anime25DDriver,
  speech: Readonly<AutoSpeechPose>,
  expression: Readonly<Pick<CoSpeechExpressionOffset, 'eyeOpen'>>,
): void {
  if (
    speech.mouthOpen > 0 ||
    speech.mouthWide > 0 ||
    speech.mouthRound > 0 ||
    speech.mouthNarrow > 0 ||
    speech.mouthSeal > 0
  ) {
    target.jaw = Math.max(target.jaw, speech.mouthOpen)
    target.mouthWide = Math.max(target.mouthWide, speech.mouthWide)
    target.mouthRound = Math.max(target.mouthRound, speech.mouthRound)
    target.mouthNarrow = Math.max(target.mouthNarrow, speech.mouthNarrow)
    target.mouthSeal = Math.max(target.mouthSeal, speech.mouthSeal)
  }
  target.lidL = mixEyeOpen(target.lidL, expression.eyeOpen)
  target.lidR = mixEyeOpen(target.lidR, expression.eyeOpen)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
