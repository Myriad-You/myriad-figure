import type { BehaviorKind, BehaviorQuality } from '../motion/behavior'

export interface Anime25DMotionUnit {
  behaviorId: string
  family: 'co-speech' | 'music'
  form: string
  kind: BehaviorKind
  timing: {
    startMs: number
    readyMs: number
    strokeStartMs: number
    strokePeakMs: number
    strokeEndMs: number
    relaxMs: number | null
    endMs: number | null
  }
  intensity: number
  quality: BehaviorQuality
}

export interface Anime25DBehaviorMotionSample {
  coSpeech: number
  coSpeechPower: number
  music: number
  musicPower: number
}

interface LocalMotionUnit extends Omit<Anime25DMotionUnit, 'timing'> {
  timing: {
    start: number
    ready: number
    strokeStart: number
    strokePeak: number
    strokeEnd: number
    relax: number | null
    end: number | null
  }
}

const ZERO_SAMPLE: Anime25DBehaviorMotionSample = {
  coSpeech: 0,
  coSpeechPower: 0,
  music: 0,
  musicPower: 0,
}

/** Samples renderer-neutral motion units on the player's monotonic clock. */
export class Anime25DBehaviorMotionController {
  private units: LocalMotionUnit[] = []
  private readonly output = { ...ZERO_SAMPLE }

  replace(
    units: readonly Anime25DMotionUnit[],
    nowMs: number,
    playerTimeSeconds: number,
  ): void {
    const localOrigin = finite(playerTimeSeconds)
    const wallNow = finite(nowMs)
    this.units = units.map((unit) => ({
      ...unit,
      timing: {
        start: localTime(unit.timing.startMs, wallNow, localOrigin),
        ready: localTime(unit.timing.readyMs, wallNow, localOrigin),
        strokeStart: localTime(unit.timing.strokeStartMs, wallNow, localOrigin),
        strokePeak: localTime(unit.timing.strokePeakMs, wallNow, localOrigin),
        strokeEnd: localTime(unit.timing.strokeEndMs, wallNow, localOrigin),
        relax:
          unit.timing.relaxMs === null
            ? null
            : localTime(unit.timing.relaxMs, wallNow, localOrigin),
        end:
          unit.timing.endMs === null
            ? null
            : localTime(unit.timing.endMs, wallNow, localOrigin),
      },
    }))
  }

  clear(): void {
    this.units = []
  }

  sample(timeSeconds: number): Readonly<Anime25DBehaviorMotionSample> {
    const now = finite(timeSeconds)
    this.output.coSpeech = 0
    this.output.coSpeechPower = 0
    this.output.music = 0
    this.output.musicPower = 0
    let write = 0
    for (const unit of this.units) {
      if (unit.timing.end !== null && now >= unit.timing.end) continue
      this.units[write] = unit
      write += 1
      const envelope = unitEnvelope(unit.timing, now)
      if (envelope <= 0) continue
      const extent =
        envelope *
        clamp(unit.intensity, 0.2, 1.4) *
        clamp(unit.quality.extent, 0.35, 1.4)
      const power = envelope * clamp(unit.quality.power, 0.35, 1.4)
      if (unit.family === 'co-speech') {
        this.output.coSpeech = Math.max(this.output.coSpeech, extent)
        this.output.coSpeechPower = Math.max(this.output.coSpeechPower, power)
      } else {
        this.output.music = Math.max(this.output.music, extent)
        this.output.musicPower = Math.max(this.output.musicPower, power)
      }
    }
    this.units.length = write
    return this.output
  }
}

export function completeBehaviorQuality(
  quality: Partial<BehaviorQuality> | undefined,
): BehaviorQuality {
  return {
    extent: finiteOr(quality?.extent, 1),
    tempo: finiteOr(quality?.tempo, 1),
    power: finiteOr(quality?.power, 1),
    fluidity: finiteOr(quality?.fluidity, 0.8),
    directness: finiteOr(quality?.directness, 0.72),
    rebound: finiteOr(quality?.rebound, 0.35),
    asymmetry: finiteOr(quality?.asymmetry, 0.2),
    density: finiteOr(quality?.density, 0.8),
  }
}

function unitEnvelope(timing: LocalMotionUnit['timing'], now: number): number {
  if (now < timing.start) return 0
  if (timing.end !== null && now >= timing.end) return 0
  if (now < timing.ready) {
    return mix(0, 0.34, smoothProgress(timing.start, timing.ready, now))
  }
  if (now < timing.strokeStart) {
    return mix(
      0.34,
      0.62,
      smoothProgress(timing.ready, timing.strokeStart, now),
    )
  }
  if (now < timing.strokePeak) {
    return mix(
      0.62,
      1,
      smoothProgress(timing.strokeStart, timing.strokePeak, now),
    )
  }
  if (now < timing.strokeEnd) {
    return mix(
      1,
      0.84,
      smoothProgress(timing.strokePeak, timing.strokeEnd, now),
    )
  }
  if (timing.relax === null || now < timing.relax) return 0.84
  if (timing.end === null) return 0.84
  return mix(0.84, 0, smoothProgress(timing.relax, timing.end, now))
}

function localTime(atMs: number, nowMs: number, localNow: number): number {
  return localNow + (finite(atMs) - nowMs) / 1_000
}

function smoothProgress(start: number, end: number, now: number): number {
  if (end <= start) return now >= end ? 1 : 0
  const t = clamp((now - start) / (end - start), 0, 1)
  return t * t * (3 - 2 * t)
}

function mix(start: number, end: number, amount: number): number {
  return start + (end - start) * amount
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
