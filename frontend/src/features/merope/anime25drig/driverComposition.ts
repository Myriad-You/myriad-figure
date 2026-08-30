import type { SingingGroovePose } from '../singing/singingGroove'
import type { AmbientPose } from './ambientMotion'
import type { CryMouthMotion } from './cryMotion'
import type { Anime25DDriver } from './driver'
import type { PerformanceExpressionOffset } from './performanceExpression'
import type { RandomActionFrame } from './randomAction'
import type { CoSpeechExpressionOffset } from './speechExpression'
import type { AutoSpeechPose } from './speechMotion'
import type { StylizedExpressionMotion } from './stylizedExpressionMotion'
import type { ThinkingMotionPose } from './thinkingMotion'
import { applySingingGroove } from '../singing/singingGroove'
import { sampleCryMouthMotion } from './cryMotion'
import { IDENTITY_DRIVER } from './driver'
import {
  applyPerformanceExpressionOffset,
  mixBoundedExpressionChannel,
  mixEyeOpen,
} from './performanceExpression'
import { applyRandomActionFrame } from './randomAction'
import {
  stepMouthForm,
  stepMouthOpen,
  stepMouthSeal,
  stepMouthShape,
} from './speechResponse'

export interface Anime25DPointerPose {
  x: number
  y: number
  inside: boolean
}

export interface Anime25DStylizedTargets {
  anger: number
  speechless: number
  maniac: number
  silly: number
  lovestruck: number
}

export interface Anime25DSecondaryMotionPose {
  angleX: number
  angleY: number
  angleZ: number
  body: number
}

export interface Anime25DBlinkState {
  activeSeconds: number
  nextAtSeconds: number
}

type RandomSource = () => number

const DRIVER_KEYS = Object.keys(IDENTITY_DRIVER) as Array<keyof Anime25DDriver>

/** Copies authored input and adds only the pointer and idle-owned channels. */
export function prepareAnime25DWorkingTarget(
  output: Anime25DDriver,
  authored: Readonly<Anime25DDriver>,
  pointer: Readonly<Anime25DPointerPose>,
  _timeSeconds: number,
): Anime25DDriver {
  Object.assign(output, authored)
  if (authored.mouse && pointer.inside) {
    output.angleX = clamp(pointer.x * 0.9, -1, 1)
    output.angleY = clamp(-pointer.y * 0.7, -1, 1)
    output.eyeX = clamp(pointer.x * 1.2, -1, 1)
    output.eyeY = clamp(-pointer.y * 0.8, -1, 1)
  }
  return output
}

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

export function applyAnime25DAmbientMotion(
  target: Anime25DDriver,
  ambient: Readonly<AmbientPose>,
  ambientScale: number,
  headKeep: number,
): void {
  target.angleX = clamp(
    target.angleX + ambient.angleX * ambientScale * headKeep,
    -1,
    1,
  )
  target.angleY = clamp(
    target.angleY + ambient.angleY * ambientScale * headKeep,
    -1,
    1,
  )
  target.angleZ = clamp(
    target.angleZ + ambient.angleZ * ambientScale * headKeep,
    -1,
    1,
  )
  target.body = clamp(
    target.body + ambient.body * ambientScale * headKeep,
    -1,
    1,
  )
  target.eyeX = clamp(target.eyeX + ambient.eyeX * ambientScale, -1, 1)
  target.eyeY = clamp(target.eyeY + ambient.eyeY * ambientScale, -1, 1)
}

export function applyAnime25DActionMotion(
  target: Anime25DDriver,
  randomAction: Readonly<RandomActionFrame>,
  randomActionScale: number,
  groove: Readonly<SingingGroovePose>,
  singingAmount: number,
  thinking: Readonly<ThinkingMotionPose>,
  thinkingAmount = 1,
): void {
  applyRandomActionFrame(target, randomAction, randomActionScale)
  applySingingGroove(target, groove, singingAmount)
  const think = clamp(thinkingAmount, 0, 1)
  target.angleX = mixBoundedExpressionChannel(
    target.angleX,
    thinking.angleX * think,
    -1,
    1,
    0,
  )
  target.angleY = mixBoundedExpressionChannel(
    target.angleY,
    thinking.angleY * think,
    -1,
    1,
    0,
  )
  target.angleZ = mixBoundedExpressionChannel(
    target.angleZ,
    thinking.angleZ * think,
    -1,
    1,
    0,
  )
  target.eyeX = mixBoundedExpressionChannel(
    target.eyeX,
    thinking.eyeX * think,
    -1,
    1,
    0,
  )
  target.eyeY = mixBoundedExpressionChannel(
    target.eyeY,
    thinking.eyeY * think,
    -1,
    1,
    0,
  )
  target.brow = mixBoundedExpressionChannel(
    target.brow,
    thinking.brow * think,
    -1,
    1,
    0,
  )
  target.mouthCY = mixBoundedExpressionChannel(
    target.mouthCY,
    thinking.mouthCY * think,
    -1,
    1,
    0,
  )
  target.mouthCAng = mixBoundedExpressionChannel(
    target.mouthCAng,
    thinking.mouthCAng * think,
    -1,
    1,
    0,
  )
  target.mouthScale = mixBoundedExpressionChannel(
    target.mouthScale,
    thinking.mouthScale * think,
    0.5,
    1.5,
    1,
  )
}

export function applyAnime25DStylizedMotion(
  target: Anime25DDriver,
  semantic: Readonly<PerformanceExpressionOffset>,
  stylized: Readonly<StylizedExpressionMotion>,
  speaking: boolean,
): void {
  applyPerformanceExpressionOffset(target, semantic)
  target.brow = mixBoundedExpressionChannel(
    target.brow,
    stylized.brow,
    -1,
    1,
    0,
  )
  target.browAngL = mixBoundedExpressionChannel(
    target.browAngL,
    stylized.browAngL,
    -1,
    1,
    0,
  )
  target.browAngR = mixBoundedExpressionChannel(
    target.browAngR,
    stylized.browAngR,
    -1,
    1,
    0,
  )
  target.browAngSym = mixBoundedExpressionChannel(
    target.browAngSym,
    stylized.browAngSym,
    -1,
    1,
    0,
  )
  target.eyeOpenL = mixEyeOpen(target.eyeOpenL, stylized.eyeOpen)
  target.eyeOpenR = mixEyeOpen(target.eyeOpenR, stylized.eyeOpen)
  target.eyeX = mixBoundedExpressionChannel(
    target.eyeX,
    stylized.eyeX,
    -1,
    1,
    0,
  )
  target.eyeY = mixBoundedExpressionChannel(
    target.eyeY,
    stylized.eyeY,
    -1,
    1,
    0,
  )
  target.irisScale = mixBoundedExpressionChannel(
    target.irisScale,
    stylized.irisScale,
    0.5,
    1.3,
    1,
  )
  target.mouthForm = mixBoundedExpressionChannel(
    target.mouthForm,
    stylized.mouthForm,
    -1,
    1,
    0,
  )
  target.mouthOpen = Math.max(target.mouthOpen, stylized.mouthOpen)
  const lovestruckMouthShare = speaking ? 0.18 : 1
  target.mouthOpen = Math.max(
    target.mouthOpen,
    stylized.lovestruckMouthOpen * lovestruckMouthShare,
  )
  target.mouthRound = Math.max(
    target.mouthRound,
    stylized.lovestruckMouthRound * lovestruckMouthShare,
  )
  target.mouthCY = mixBoundedExpressionChannel(
    target.mouthCY,
    stylized.mouthCY,
    -1,
    1,
    0,
  )
  target.mouthCAng = mixBoundedExpressionChannel(
    target.mouthCAng,
    stylized.mouthCAng,
    -1,
    1,
    0,
  )
  target.mouthScale = mixBoundedExpressionChannel(
    target.mouthScale,
    stylized.mouthScale + stylized.lovestruckMouthScale * lovestruckMouthShare,
    0.5,
    1.5,
    1,
  )
  target.angleX = mixBoundedExpressionChannel(
    target.angleX,
    stylized.angleX,
    -1,
    1,
    0,
  )
  target.angleY = mixBoundedExpressionChannel(
    target.angleY,
    stylized.angleY,
    -1,
    1,
    0,
  )
  target.angleZ = mixBoundedExpressionChannel(
    target.angleZ,
    stylized.angleZ,
    -1,
    1,
    0,
  )
  target.body = mixBoundedExpressionChannel(
    target.body,
    stylized.body,
    -1,
    1,
    0,
  )
}

export function applyAnime25DCryMouth(
  target: Anime25DDriver,
  currentEyeCry: number,
  timeSeconds: number,
  elapsedSeconds: number,
  output: CryMouthMotion,
): void {
  const cryResponseRate = target.eyeCry > currentEyeCry ? 6 : 4.5
  const cryAmount = clamp(
    currentEyeCry +
      (target.eyeCry - currentEyeCry) *
        (1 - Math.exp(-cryResponseRate * elapsedSeconds)),
    0,
    1,
  )
  sampleCryMouthMotion(cryAmount, timeSeconds, output)
  target.mouthOpen = Math.max(target.mouthOpen, output.mouthOpen)
  target.mouthForm = mixBoundedExpressionChannel(
    target.mouthForm,
    output.mouthForm,
    -1,
    1,
    0,
  )
  target.mouthCY = mixBoundedExpressionChannel(
    target.mouthCY,
    output.mouthCY,
    -1,
    1,
    0,
  )
  target.mouthScale = mixBoundedExpressionChannel(
    target.mouthScale,
    output.mouthScale,
    0.5,
    1.5,
    1,
  )
}

export function applyAnime25DSpeechMotion(
  target: Anime25DDriver,
  speech: Readonly<AutoSpeechPose>,
  expression: Readonly<CoSpeechExpressionOffset>,
): void {
  if (
    speech.mouthOpen > 0 ||
    speech.mouthWide > 0 ||
    speech.mouthRound > 0 ||
    speech.mouthNarrow > 0 ||
    speech.mouthSeal > 0
  ) {
    target.mouthOpen = Math.max(target.mouthOpen, speech.mouthOpen)
    target.mouthWide = Math.max(target.mouthWide, speech.mouthWide)
    target.mouthRound = Math.max(target.mouthRound, speech.mouthRound)
    target.mouthNarrow = Math.max(target.mouthNarrow, speech.mouthNarrow)
    target.mouthSeal = Math.max(target.mouthSeal, speech.mouthSeal)
  }
  target.brow = mixBoundedExpressionChannel(
    target.brow,
    expression.brow,
    -1,
    1,
    0,
  )
  target.eyeOpenL = mixEyeOpen(target.eyeOpenL, expression.eyeOpen)
  target.eyeOpenR = mixEyeOpen(target.eyeOpenR, expression.eyeOpen)
  target.angleY = mixBoundedExpressionChannel(
    target.angleY,
    expression.angleY,
    -1,
    1,
    0,
  )
}

export function applyAnime25DSillyMouthOwnership(
  target: Anime25DDriver,
  ownership: number,
): void {
  if (ownership <= 0) return
  const retained = 1 - ownership
  target.mouthOpen *= retained
  target.mouthWide *= retained
  target.mouthRound *= retained
  target.mouthNarrow *= retained
  target.mouthSeal *= retained
}

export function captureAnime25DSecondaryMotion(
  output: Anime25DSecondaryMotionPose,
  target: Readonly<Anime25DDriver>,
): void {
  output.angleX = target.angleX
  output.angleY = target.angleY
  output.angleZ = target.angleZ
  output.body = target.body
}

/** Advances the exact legacy blink curve while reusing its mutable state. */
export function stepAnime25DBlink(
  target: Anime25DDriver,
  state: Anime25DBlinkState,
  timeSeconds: number,
  elapsedSeconds: number,
  enabled: boolean,
  suppressed: boolean,
  random: RandomSource = Math.random,
): void {
  if (suppressed) {
    state.activeSeconds = -1
    state.nextAtSeconds = timeSeconds + 1.8
    return
  }
  if (!enabled) return
  if (state.activeSeconds < 0 && timeSeconds > state.nextAtSeconds) {
    state.activeSeconds = 0
    state.nextAtSeconds = timeSeconds + 1.6 + random() * 3.8
    if (random() < 0.18) state.nextAtSeconds = timeSeconds + 0.28
  }
  if (state.activeSeconds < 0) return
  state.activeSeconds += elapsedSeconds
  const elapsed = state.activeSeconds
  let open = 1
  if (elapsed < 0.08) {
    open = 1 - elapsed / 0.08
  } else if (elapsed < 0.42) {
    open = 0
  } else if (elapsed < 0.58) {
    open = (elapsed - 0.42) / 0.16
  } else {
    state.activeSeconds = -1
  }
  target.eyeOpenL = Math.min(target.eyeOpenL, open)
  target.eyeOpenR = Math.min(target.eyeOpenR, open)
}

/** Applies the final driver and secondary-motion response without allocations. */
export function stepAnime25DDriverResponse(
  current: Anime25DDriver,
  authored: Readonly<Anime25DDriver>,
  target: Readonly<Anime25DDriver>,
  secondaryCurrent: Anime25DSecondaryMotionPose,
  secondaryTarget: Readonly<Anime25DSecondaryMotionPose>,
  elapsedSeconds: number,
): void {
  const rate = Math.min(1, elapsedSeconds * 14)
  for (const key of DRIVER_KEYS) {
    if (isAutomationFlag(key)) {
      current[key] = authored[key]
      continue
    }
    const from = current[key]
    const to = target[key]
    if (key === 'mouthOpen') {
      current.mouthOpen = stepMouthOpen(from, to, elapsedSeconds)
      continue
    }
    if (key === 'mouthForm') {
      current.mouthForm = stepMouthForm(from, to, elapsedSeconds)
      continue
    }
    if (key === 'mouthSeal') {
      current.mouthSeal = stepMouthSeal(from, to, elapsedSeconds)
      continue
    }
    if (key === 'mouthWide' || key === 'mouthRound' || key === 'mouthNarrow') {
      current[key] = stepMouthShape(from, to, elapsedSeconds)
      continue
    }
    if (key === 'eyeCry') {
      const response = to > from ? 6 : 4.5
      current.eyeCry =
        from + (to - from) * (1 - Math.exp(-response * elapsedSeconds))
      continue
    }
    if (key === 'maniac') {
      const response = to > from ? 7.2 : 4.4
      current.maniac =
        from + (to - from) * (1 - Math.exp(-response * elapsedSeconds))
      continue
    }
    if (key === 'silly') {
      const response = to > from ? 7 : 4.2
      current.silly =
        from + (to - from) * (1 - Math.exp(-response * elapsedSeconds))
      continue
    }
    if (key === 'lovestruck') {
      const response = to > from ? 6.6 : 3.8
      current.lovestruck =
        from + (to - from) * (1 - Math.exp(-response * elapsedSeconds))
      continue
    }
    current[key] = from + (to - from) * rate
  }
  secondaryCurrent.angleX +=
    (secondaryTarget.angleX - secondaryCurrent.angleX) * rate
  secondaryCurrent.angleY +=
    (secondaryTarget.angleY - secondaryCurrent.angleY) * rate
  secondaryCurrent.angleZ +=
    (secondaryTarget.angleZ - secondaryCurrent.angleZ) * rate
  secondaryCurrent.body += (secondaryTarget.body - secondaryCurrent.body) * rate
}

function isAutomationFlag(
  key: keyof Anime25DDriver,
): key is
  | 'idle'
  | 'blink'
  | 'rand'
  | 'thinking'
  | 'singing'
  | 'talk'
  | 'mouse'
  | 'phys' {
  return (
    key === 'idle' ||
    key === 'blink' ||
    key === 'rand' ||
    key === 'thinking' ||
    key === 'singing' ||
    key === 'talk' ||
    key === 'mouse' ||
    key === 'phys'
  )
}

export function smoothAnime25DUnit(value: number): number {
  const bounded = clamp(value, 0, 1)
  return bounded * bounded * (3 - 2 * bounded)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
