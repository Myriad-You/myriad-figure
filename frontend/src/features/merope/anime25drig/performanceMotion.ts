import type {
  PerformanceBaseline,
  PerformanceCue,
} from '../../../services/agent/types'
import type { Anime25DDriver } from './player'
import { DEFAULT_FRONT_HAIR_SWAY, DEFAULT_REAR_HAIR_SWAY } from './player'

export interface ScheduledBodyCue {
  cue: PerformanceCue
  startMs: number
  endMs: number
}

type SpeechOwnedDriver = Pick<
  Anime25DDriver,
  'mouthForm' | 'mouthOpen' | 'talk'
>

/** Non-facial pose/secondary-motion ownership for non-manual playback. */
export function baselineDriverPatch(
  baseline: PerformanceBaseline,
): Partial<Anime25DDriver> {
  const energy = clamp(baseline.motionEnergy, 0.2, 1.4)
  const swayEnergy = 0.7 + energy * 0.3
  const posture: Record<
    PerformanceBaseline['posture'],
    Partial<Anime25DDriver>
  > = {
    closed: { body: -0.16, armY: -0.14, armPos: -0.18 },
    neutral: { body: 0, armY: 0, armPos: 0 },
    open: { body: 0.12, armY: 0.16, armPos: 0.2 },
  }
  return {
    ...posture[baseline.posture],
    physAmp: DEFAULT_REAR_HAIR_SWAY * swayEnergy,
    soft: 1.3 + energy * 0.6,
    fhAmp: DEFAULT_FRONT_HAIR_SWAY * swayEnergy,
    idle: true,
    blink: true,
    rand: true,
    phys: true,
  }
}

/** Restores only performance-owned pose and secondary-motion channels. */
export function performanceRestDriverPatch(
  baseline: PerformanceBaseline | null,
  thinking: boolean,
): Partial<Anime25DDriver> {
  return {
    body: 0,
    armY: 0,
    armPos: 0,
    bust: 2.5,
    physAmp: DEFAULT_REAR_HAIR_SWAY,
    soft: 2,
    fhAmp: DEFAULT_FRONT_HAIR_SWAY,
    idle: true,
    blink: true,
    phys: true,
    ...(baseline ? baselineDriverPatch(baseline) : {}),
    // Thinking has a dedicated constrained loop, so full autonomous actions
    // remain off even when a semantic baseline is currently installed.
    thinking,
    rand: !thinking,
  }
}

/** A full base refresh must not take mouth ownership during active speech. */
export function idleSpeechDriverPatch(
  mood: number,
  speechActive: boolean,
): Partial<SpeechOwnedDriver> {
  if (speechActive) return {}
  const smile = Math.max(0, (mood - 50) / 80)
  return {
    talk: false,
    mouthOpen: 0,
    mouthForm: smile * 0.28,
  }
}

export function cueDriverPatch(cue: PerformanceCue): Partial<Anime25DDriver> {
  const amount = clamp(cue.intensity, 0.2, 1.4)
  const patches: Record<PerformanceCue['intent'], Partial<Anime25DDriver>> = {
    greet: { body: 0.09 * amount, armY: 0.12 * amount },
    respond: {},
    question: { body: 0.06 * amount },
    delight: { armPos: 0.22 * amount, bust: 2.8 },
    emphasize: { body: 0.22 * amount },
    listen: {},
    notify: { body: 0.18 * amount },
    think: {},
    dizzy: {},
    cry: {},
    angry: { body: 0.1 * amount },
    speechless: { body: -0.045 * amount, idle: false },
    maniac: { body: 0.055 * amount, idle: false },
  }
  return patches[cue.intent]
}

export function cuePriority(cue: PerformanceCue): number {
  if (
    cue.intent === 'delight' ||
    cue.intent === 'notify' ||
    cue.intent === 'dizzy' ||
    cue.intent === 'cry' ||
    cue.intent === 'angry' ||
    cue.intent === 'maniac'
  ) {
    return 3
  }
  if (
    cue.intent === 'greet' ||
    cue.intent === 'question' ||
    cue.intent === 'emphasize' ||
    cue.intent === 'think' ||
    cue.intent === 'speechless'
  ) {
    return 2
  }
  return 1
}

export function cueDurationMs(cue: PerformanceCue): number {
  return Math.round(
    cue.fadeInMs +
      Math.max(240, 720 / clamp(cue.tempo, 0.5, 1.6)) +
      cue.fadeOutMs,
  )
}

/** Prevents throttled browser timers from replaying an already-expired pose. */
export function cueRemainingDurationMs(
  cue: PerformanceCue,
  scheduledStartMs: number,
  nowMs: number,
): number {
  return intervalRemainingDurationMs(
    scheduledStartMs,
    scheduledStartMs + cueDurationMs(cue),
    nowMs,
  )
}

/** Also respects an interval shortened by a later replacement cue. */
export function scheduledBodyCueRemainingDurationMs(
  scheduled: ScheduledBodyCue,
  nowMs: number,
): number {
  return intervalRemainingDurationMs(scheduled.startMs, scheduled.endMs, nowMs)
}

/** Resolves queue/replace timing once so timer throttling cannot change order. */
export function scheduleBodyCues(
  cues: readonly PerformanceCue[],
  originMs: number,
): ScheduledBodyCue[] {
  const scheduled: ScheduledBodyCue[] = []
  const ordered = [...cues].sort((left, right) => left.atMs - right.atMs)
  for (const cue of ordered) {
    let startMs = originMs + cue.atMs
    if (cue.interrupt === 'queue') {
      for (const existing of scheduled) {
        if (existing.endMs > startMs) startMs = existing.endMs
      }
    } else {
      const active = selectedBodyCueAt(scheduled, startMs)
      if (
        cue.interrupt === 'if-lower' &&
        active &&
        cuePriority(cue) <= cuePriority(active.cue)
      ) {
        continue
      }
      for (const existing of scheduled) {
        if (
          existing.startMs <= startMs &&
          existing.endMs > startMs &&
          (cue.interrupt === 'replace' ||
            cuePriority(existing.cue) < cuePriority(cue))
        ) {
          existing.endMs = startMs
        }
      }
    }
    scheduled.push({
      cue,
      startMs,
      endMs: startMs + cueDurationMs(cue),
    })
  }
  return scheduled.sort((left, right) => left.startMs - right.startMs)
}

function selectedBodyCueAt(
  cues: readonly ScheduledBodyCue[],
  nowMs: number,
): ScheduledBodyCue | null {
  let selected: ScheduledBodyCue | null = null
  for (const cue of cues) {
    if (nowMs < cue.startMs || nowMs >= cue.endMs) continue
    if (!selected || cue.cue.interrupt === 'replace') {
      selected = cue
    } else if (
      cue.cue.interrupt === 'if-lower' &&
      cuePriority(cue.cue) > cuePriority(selected.cue)
    ) {
      selected = cue
    }
  }
  return selected
}

function intervalRemainingDurationMs(
  startMs: number,
  endMs: number,
  nowMs: number,
): number {
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    !Number.isFinite(nowMs) ||
    endMs <= startMs
  ) {
    return 0
  }
  return Math.max(0, endMs - Math.max(startMs, nowMs))
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
