export interface CoSpeechExpressionOffset {
  brow: number
  eyeOpen: number
  angleY: number
}

const RELEASE_RATE = 6.2

/** Keeps authored audio/viseme input on the same visual-prosody path. */
export class CoSpeechExpressionController {
  private readonly output: CoSpeechExpressionOffset = {
    brow: 0,
    eyeOpen: 0,
    angleY: 0,
  }

  private readonly targetOffset: CoSpeechExpressionOffset = {
    brow: 0,
    eyeOpen: 0,
    angleY: 0,
  }

  private previousEnergy = 0
  private accentStartedAt = Number.NEGATIVE_INFINITY
  private nextAccentAt = 0
  private lastTime = Number.NaN
  private initialized = false

  sample(
    timeSeconds: number,
    active: boolean,
    authoredEnergy: number | null,
    phraseActivity: number,
    browAccent: number,
    headAccent: number,
  ): Readonly<CoSpeechExpressionOffset> {
    const now = Number.isFinite(timeSeconds) ? Math.max(0, timeSeconds) : 0
    const dt = Number.isFinite(this.lastTime)
      ? clamp(now - this.lastTime, 0, 0.05)
      : 0
    this.lastTime = now
    const energy = authoredEnergy == null ? 0 : unitInterval(authoredEnergy)
    if (
      active &&
      authoredEnergy != null &&
      energy >= 0.58 &&
      this.previousEnergy < 0.46 &&
      now >= this.nextAccentAt
    ) {
      this.accentStartedAt = now
      this.nextAccentAt = now + 0.48
    }

    if (active && authoredEnergy != null) {
      this.previousEnergy = energy
    } else if (!active) {
      this.previousEnergy = 0
      this.accentStartedAt = Number.NEGATIVE_INFINITY
      this.nextAccentAt = now
    }

    const authoredActivity =
      active && authoredEnergy != null
        ? 0.22 + 0.78 * smootherstep((energy - 0.05) / 0.55)
        : 0
    const elapsed = now - this.accentStartedAt
    const authoredBrow = active ? attackReleasePulse(elapsed, 0, 0.065, 0.2) : 0
    const authoredHead = active
      ? attackReleasePulse(elapsed, 0.045, 0.1, 0.22)
      : 0
    writeOffset(
      this.targetOffset,
      Math.max(phraseActivity, authoredActivity),
      Math.max(browAccent, authoredBrow),
      Math.max(headAccent, authoredHead),
    )
    if (!this.initialized) {
      this.initialized = true
      this.output.brow = this.targetOffset.brow
      this.output.eyeOpen = this.targetOffset.eyeOpen
      this.output.angleY = this.targetOffset.angleY
      return this.output
    }
    this.output.brow = stepRelease(
      this.output.brow,
      this.targetOffset.brow,
      dt,
    )
    this.output.eyeOpen = stepRelease(
      this.output.eyeOpen,
      this.targetOffset.eyeOpen,
      dt,
    )
    this.output.angleY = stepRelease(
      this.output.angleY,
      this.targetOffset.angleY,
      dt,
    )
    return this.output
  }
}

function writeOffset(
  output: CoSpeechExpressionOffset,
  phraseActivity: number,
  browAccent: number,
  headAccent: number,
): Readonly<CoSpeechExpressionOffset> {
  const activity = unitInterval(phraseActivity)
  const browBeat = unitInterval(browAccent)
  const headBeat = unitInterval(headAccent)
  output.brow = 0.025 * activity + 0.07 * browBeat
  output.eyeOpen = -0.018 * activity + 0.014 * browBeat
  output.angleY = 0.035 * headBeat
  return output
}

function stepRelease(current: number, target: number, dt: number): number {
  if (Math.abs(target) >= Math.abs(current) - 1e-6) return target
  return current + (target - current) * (1 - Math.exp(-RELEASE_RATE * dt))
}

function unitInterval(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function attackReleasePulse(
  elapsed: number,
  delay: number,
  attack: number,
  release: number,
): number {
  const shifted = elapsed - delay
  if (!Number.isFinite(shifted) || shifted < 0) return 0
  if (shifted < attack) return smootherstep(shifted / attack)
  if (shifted < attack + release) {
    return 1 - smootherstep((shifted - attack) / release)
  }
  return 0
}

function smootherstep(value: number): number {
  const bounded = unitInterval(value)
  return bounded * bounded * bounded * (bounded * (bounded * 6 - 15) + 10)
}
