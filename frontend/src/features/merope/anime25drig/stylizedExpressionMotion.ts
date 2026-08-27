export interface StylizedExpressionMotion {
  anger: number
  speechless: number
  maniac: number
  brow: number
  browAngL: number
  browAngR: number
  browAngSym: number
  eyeOpen: number
  eyeX: number
  eyeY: number
  irisScale: number
  mouthForm: number
  mouthOpen: number
  mouthCY: number
  mouthCAng: number
  mouthScale: number
  maniacUpperMouthPulse: number
  maniacHeadPulse: number
  angleX: number
  angleY: number
  angleZ: number
  body: number
  ambientScale: number
  angerMarkScale: number
  angerMarkOffsetY: number
  angerMarkRotation: number
  speechlessSweatScale: number
  speechlessSweatOffsetX: number
  speechlessSweatOffsetY: number
  speechlessSweatRotation: number
}

const ZERO_MOTION: StylizedExpressionMotion = {
  anger: 0,
  speechless: 0,
  maniac: 0,
  brow: 0,
  browAngL: 0,
  browAngR: 0,
  browAngSym: 0,
  eyeOpen: 0,
  eyeX: 0,
  eyeY: 0,
  irisScale: 0,
  mouthForm: 0,
  mouthOpen: 0,
  mouthCY: 0,
  mouthCAng: 0,
  mouthScale: 0,
  maniacUpperMouthPulse: 0,
  maniacHeadPulse: 0,
  angleX: 0,
  angleY: 0,
  angleZ: 0,
  body: 0,
  ambientScale: 1,
  angerMarkScale: 0,
  angerMarkOffsetY: 0,
  angerMarkRotation: 0,
  speechlessSweatScale: 0,
  speechlessSweatOffsetX: 0,
  speechlessSweatOffsetY: 0,
  speechlessSweatRotation: 0,
}

/**
 * Stages semantic expression channels instead of cross-fading the whole face.
 * The reused output keeps the per-frame path allocation-free.
 */
export class StylizedExpressionMotionController {
  private readonly output: StylizedExpressionMotion = { ...ZERO_MOTION }
  private lastTime = Number.NaN
  private anger = 0
  private speechless = 0
  private maniac = 0
  private angerStartedAt = 0
  private speechlessStartedAt = 0
  private maniacStartedAt = 0
  private angerWasActive = false
  private speechlessWasActive = false
  private maniacWasActive = false

  sample(
    timeSeconds: number,
    angerTarget: number,
    speechlessTarget: number,
    maniacTarget: number,
  ): Readonly<StylizedExpressionMotion> {
    const now = Number.isFinite(timeSeconds) ? Math.max(0, timeSeconds) : 0
    const dt = Number.isFinite(this.lastTime)
      ? clamp(now - this.lastTime, 0, 0.05)
      : 0
    this.lastTime = now

    const boundedManiac = clamp(maniacTarget, 0, 1)
    // The most stylized state owns the face if malformed/manual input overlaps.
    const boundedAnger = clamp(angerTarget, 0, 1) * (1 - boundedManiac)
    const boundedSpeechless =
      clamp(speechlessTarget, 0, 1) * (1 - boundedAnger) * (1 - boundedManiac)
    const angerActive = boundedAnger > 0.025
    const speechlessActive = boundedSpeechless > 0.025
    const maniacActive = boundedManiac > 0.025
    if (angerActive && !this.angerWasActive) this.angerStartedAt = now
    if (speechlessActive && !this.speechlessWasActive) {
      this.speechlessStartedAt = now
    }
    if (maniacActive && !this.maniacWasActive) this.maniacStartedAt = now
    this.angerWasActive = angerActive
    this.speechlessWasActive = speechlessActive
    this.maniacWasActive = maniacActive

    this.anger = approach(
      this.anger,
      boundedAnger,
      dt,
      boundedAnger > this.anger ? 9.5 : 5.2,
    )
    this.speechless = approach(
      this.speechless,
      boundedSpeechless,
      dt,
      boundedSpeechless > this.speechless ? 7.8 : 4.2,
    )
    this.maniac = approach(
      this.maniac,
      boundedManiac,
      dt,
      boundedManiac > this.maniac ? 8.6 : 4.6,
    )

    const angerAge = Math.max(0, now - this.angerStartedAt)
    const speechlessAge = Math.max(0, now - this.speechlessStartedAt)
    const maniacAge = Math.max(0, now - this.maniacStartedAt)
    const angerBrow = staged(this.anger, angerAge, 0, 0.12)
    const angerEyes = staged(this.anger, angerAge, 0.045, 0.15)
    const angerMouth = staged(this.anger, angerAge, 0.09, 0.18)
    const angerPose = staged(this.anger, angerAge, 0.14, 0.22)
    const speechlessGaze = staged(this.speechless, speechlessAge, 0, 0.14)
    const speechlessEyes = staged(this.speechless, speechlessAge, 0.055, 0.2)
    const speechlessFace = staged(this.speechless, speechlessAge, 0.11, 0.22)
    const speechlessPose = staged(this.speechless, speechlessAge, 0.18, 0.26)
    const maniacGaze = staged(this.maniac, maniacAge, 0, 0.16)
    const maniacMouth = staged(this.maniac, maniacAge, 0.055, 0.25)
    const maniacPose = staged(this.maniac, maniacAge, 0.11, 0.28)
    const angerTension =
      Math.sin(now * 6.1) * 0.02 * angerPose +
      Math.sin(now * 2.15 + 0.8) * 0.009 * angerPose
    const speechlessDrift = Math.sin(now * 1.35 + 1.2) * speechlessPose
    const maniacWobble =
      Math.sin(now * 2.7 + 0.3) * 0.035 * maniacPose +
      Math.sin(now * 5.9 + 1.1) * 0.012 * maniacPose
    // An asymmetric laugh pulse: a small, quick opening, slower recovery, then
    // one restrained rebound. This keeps the reference's nearly-held grin and
    // avoids a mechanical equal-amplitude sine wave.
    const maniacMouthPhase = (now / 0.82 + 0.17) % 1
    const maniacUpperMouthCycle =
      maniacLaughCurve(maniacMouthPhase) * maniacMouth
    const delayedManiacHead =
      maniacLaughCurve((maniacMouthPhase + 0.94) % 1) * maniacMouth

    const output = this.output
    output.anger = this.anger
    output.speechless = this.speechless
    output.maniac = this.maniac
    output.brow = -0.31 * angerBrow - 0.13 * speechlessFace + 0.12 * maniacGaze
    output.browAngL = 0.17 * speechlessFace - 0.2 * maniacGaze
    output.browAngR = -0.055 * speechlessFace + 0.14 * maniacGaze
    output.browAngSym = 0.72 * angerBrow
    output.eyeOpen =
      -0.23 * angerEyes - 0.39 * speechlessEyes + 0.055 * maniacGaze
    output.eyeX =
      -0.47 * speechlessGaze +
      (0.035 + Math.sin(now * 4.1) * 0.025) * maniacGaze
    output.eyeY =
      0.075 * speechlessGaze +
      (-0.73 + Math.sin(now * 3.7 + 0.8) * 0.035) * maniacGaze
    output.irisScale =
      -0.075 * angerEyes - 0.025 * speechlessEyes - 0.39 * maniacGaze
    output.mouthForm =
      -0.74 * angerMouth - 0.33 * speechlessFace + 0.72 * maniacMouth
    output.mouthOpen = 0.96 * maniacMouth
    output.mouthCY =
      0.065 * angerMouth + 0.045 * speechlessFace + 0.055 * maniacMouth
    output.mouthCAng = -0.075 * speechlessFace
    output.mouthScale =
      -0.1 * angerMouth - 0.1 * speechlessFace + 0.018 * maniacMouth
    output.maniacUpperMouthPulse = maniacUpperMouthCycle
    output.maniacHeadPulse = delayedManiacHead
    output.angleX =
      0.05 * angerPose +
      Math.sin(now * 6.1 + 0.7) * 0.012 * angerPose -
      0.035 * speechlessPose -
      (0.035 + Math.sin(now * 1.7 + 0.2) * 0.012) * maniacPose
    output.angleY =
      0.085 * angerPose -
      0.025 * speechlessPose -
      0.11 * maniacPose +
      maniacWobble * 0.55
    output.angleZ =
      angerTension + 0.075 * speechlessPose - 0.12 * maniacPose + maniacWobble
    output.body =
      0.075 * angerPose - 0.035 * speechlessPose + 0.045 * maniacPose
    output.ambientScale = clamp(
      1 - 0.2 * this.anger - 0.62 * this.speechless - 0.38 * this.maniac,
      0.32,
      1,
    )

    const angerMark = symbolPop(this.anger, angerAge, 0.11, 0.2)
    const angerBreath =
      1 +
      Math.sin(now * 2.45 + 0.25) * 0.08 +
      Math.max(0, Math.sin(now * 4.9 + 0.35)) ** 5 * 0.055 +
      Math.sin(now * 1.15) * 0.018
    output.angerMarkScale = angerMark * angerBreath
    output.angerMarkOffsetY =
      (-2.2 * (1 - smootherstep(Math.min(1, angerAge / 0.28))) +
        Math.sin(now * 2.45 + 0.25) * 0.7) *
      angerMark
    output.angerMarkRotation =
      (0.035 + Math.sin(now * 2.45 + 0.55) * 0.018) * angerMark

    const sweat = symbolPop(this.speechless, speechlessAge, 0.16, 0.24)
    output.speechlessSweatScale = sweat
    output.speechlessSweatOffsetX =
      (1.4 * (1 - smootherstep(Math.min(1, speechlessAge / 0.4))) +
        speechlessDrift * 0.25) *
      sweat
    output.speechlessSweatOffsetY =
      (2.6 * smootherstep(Math.min(1, speechlessAge / 0.7)) +
        speechlessDrift * 0.45) *
      sweat
    output.speechlessSweatRotation = -0.035 * sweat
    return output
  }
}

function staged(
  amount: number,
  age: number,
  delay: number,
  duration: number,
): number {
  if (amount <= 0) return 0
  return amount * smootherstep((age - delay) / duration)
}

function symbolPop(
  amount: number,
  age: number,
  delay: number,
  duration: number,
): number {
  if (amount <= 0 || age <= delay) return 0
  const progress = clamp((age - delay) / duration, 0, 1)
  const back = 1.70158
  const shifted = progress - 1
  const overshoot = 1 + (back + 1) * shifted ** 3 + back * shifted ** 2
  return amount * clamp(overshoot, 0, 1.08)
}

function maniacLaughCurve(phase: number): number {
  if (phase < 0.17) {
    return lerpSmooth(0, 0.027, phase / 0.17)
  }
  if (phase < 0.5) {
    return lerpSmooth(0.027, -0.007, (phase - 0.17) / 0.33)
  }
  if (phase < 0.72) {
    return lerpSmooth(-0.007, 0.008, (phase - 0.5) / 0.22)
  }
  return lerpSmooth(0.008, 0, (phase - 0.72) / 0.28)
}

function lerpSmooth(start: number, end: number, progress: number): number {
  return start + (end - start) * smootherstep(progress)
}

function approach(
  current: number,
  target: number,
  dt: number,
  response: number,
): number {
  return current + (target - current) * (1 - Math.exp(-response * dt))
}

function smootherstep(value: number): number {
  const bounded = clamp(value, 0, 1)
  return bounded ** 3 * (bounded * (bounded * 6 - 15) + 10)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
