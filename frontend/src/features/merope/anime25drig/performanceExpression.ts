import type {
  PerformanceBaseline,
  PerformanceCue,
  PerformanceDirective,
  PerformancePhase,
} from '../../../services/agent/types'

export interface PerformanceExpressionOffset {
  brow: number
  browAngSym: number
  eyeOpen: number
  eyeDizzy: number
  eyeSqueeze: number
  eyeCry: number
  eyeX: number
  eyeY: number
  mouthForm: number
  irisScale: number
  angleY: number
  angleZ: number
  anger?: number
  speechless?: number
  maniac?: number
}

export interface PerformanceExpressionTarget {
  brow: number
  browAngSym: number
  eyeOpenL: number
  eyeOpenR: number
  eyeDizzy: number
  eyeSqueeze: number
  eyeCry: number
  eyeX: number
  eyeY: number
  mouthForm: number
  irisScale: number
  angleY: number
  angleZ: number
  anger?: number
  speechless?: number
  maniac?: number
}

interface ScheduledExpressionCue {
  start: number
  fadeIn: number
  hold: number
  fadeOut: number
  end: number
  interrupt: PerformanceCue['interrupt']
  priority: number
  offset: PerformanceExpressionOffset
}

const OFFSET_KEYS = [
  'brow',
  'browAngSym',
  'eyeOpen',
  'eyeDizzy',
  'eyeSqueeze',
  'eyeCry',
  'eyeX',
  'eyeY',
  'mouthForm',
  'irisScale',
  'angleY',
  'angleZ',
  'anger',
  'speechless',
  'maniac',
] as const

const ZERO_OFFSET: PerformanceExpressionOffset = {
  brow: 0,
  browAngSym: 0,
  eyeOpen: 0,
  eyeDizzy: 0,
  eyeSqueeze: 0,
  eyeCry: 0,
  eyeX: 0,
  eyeY: 0,
  mouthForm: 0,
  irisScale: 0,
  angleY: 0,
  angleZ: 0,
  anger: 0,
  speechless: 0,
  maniac: 0,
}

const EYE_CLOSED_GUARD = 0.12
const EXTREME_SOFT_LIMIT_START = 0.8
const MAX_DIRECTIVE_FINGERPRINTS = 32

export type PerformanceDirectiveAcceptance = 'reject' | 'accept' | 'supersede'

/** Shared, bounded ordering policy for the independent face and body owners. */
export class PerformanceDirectiveGate {
  private moodRevision = -1
  private phaseRank: number | null = null
  private readonly fingerprints = new Set<string>()
  private readonly fingerprintOrder: string[] = []

  accept(directive: PerformanceDirective): PerformanceDirectiveAcceptance {
    const rank = performancePhaseRank(directive.phase)
    const fingerprint = performanceDirectiveFingerprint(directive)
    if (directive.moodRevision < this.moodRevision) return 'reject'
    if (
      directive.moodRevision === this.moodRevision &&
      rank !== null &&
      this.phaseRank !== null &&
      rank < this.phaseRank
    ) {
      return 'reject'
    }
    if (
      directive.moodRevision === this.moodRevision &&
      this.fingerprints.has(fingerprint)
    ) {
      return 'reject'
    }

    const revisionAdvanced = directive.moodRevision > this.moodRevision
    const phaseAdvanced =
      !revisionAdvanced &&
      rank !== null &&
      this.phaseRank !== null &&
      rank > this.phaseRank
    if (revisionAdvanced) this.clearHistory()
    this.moodRevision = directive.moodRevision
    if (rank !== null) this.phaseRank = rank
    this.remember(fingerprint)
    return revisionAdvanced || phaseAdvanced ? 'supersede' : 'accept'
  }

  reset(): void {
    this.moodRevision = -1
    this.phaseRank = null
    this.clearHistory()
  }

  private remember(fingerprint: string): void {
    this.fingerprints.add(fingerprint)
    this.fingerprintOrder.push(fingerprint)
    if (this.fingerprintOrder.length <= MAX_DIRECTIVE_FINGERPRINTS) return
    const expired = this.fingerprintOrder.shift()
    if (expired) this.fingerprints.delete(expired)
  }

  private clearHistory(): void {
    this.fingerprints.clear()
    this.fingerprintOrder.length = 0
    this.phaseRank = null
  }
}

/**
 * Owns only additive facial/head expression offsets selected by Lite.
 * Base poses, workbench controls, lip sync, gaze, blinking, and body motion
 * remain separate owners and are never written back by this controller.
 */
export class PerformanceExpressionController {
  private readonly current: PerformanceExpressionOffset = { ...ZERO_OFFSET }
  private readonly target: PerformanceExpressionOffset = { ...ZERO_OFFSET }
  private readonly output: PerformanceExpressionOffset = { ...ZERO_OFFSET }
  private readonly cues: ScheduledExpressionCue[] = []
  private readonly gate = new PerformanceDirectiveGate()
  private lastTime = Number.NaN
  private ambientScale = 1
  private ambientScaleTarget = 1

  play(
    directive: PerformanceDirective,
    timeSeconds: number,
    cueOriginSeconds = timeSeconds,
  ): boolean {
    const now = finiteTime(timeSeconds)
    const acceptance = this.gate.accept(directive)
    if (acceptance === 'reject') return false
    this.pruneExpiredCues(now)
    if (acceptance === 'supersede') {
      // Delivery/outcome supersedes pending reaction/delivery beats from the
      // same turn. This also makes arrival order deterministic.
      this.cues.length = 0
    }
    if (!Number.isFinite(this.lastTime)) this.lastTime = now
    if (directive.plan.baseline) {
      writeBaselineOffset(this.target, directive.plan.baseline)
      this.ambientScaleTarget = ambientScaleForAttention(
        directive.plan.baseline.attention,
      )
    }
    this.scheduleCues(directive.plan.cues, finiteTime(cueOriginSeconds))
    return true
  }

  stop(timeSeconds: number): void {
    this.lastTime = finiteTime(timeSeconds)
    this.gate.reset()
    this.cues.length = 0
    writeZero(this.target)
    this.ambientScaleTarget = 1
  }

  sample(timeSeconds: number): Readonly<PerformanceExpressionOffset> {
    const now = finiteTime(timeSeconds)
    const dt = Number.isFinite(this.lastTime)
      ? clamp(now - this.lastTime, 0, 0.05)
      : 0
    this.lastTime = now
    const baselineRate = 1 - Math.exp(-7.5 * dt)
    this.ambientScale +=
      (this.ambientScaleTarget - this.ambientScale) * baselineRate
    for (const key of OFFSET_KEYS) {
      const current = this.current[key] ?? 0
      const target = this.target[key] ?? 0
      this.current[key] = current + (target - current) * baselineRate
      this.output[key] = this.current[key]
    }

    this.pruneExpiredCues(now)
    const selected = this.selectedCueAt(now)

    if (selected) {
      const envelope = cueEnvelope(selected, now)
      for (const key of OFFSET_KEYS) {
        this.output[key] =
          (this.output[key] ?? 0) + (selected.offset[key] ?? 0) * envelope
      }
    }
    return this.output
  }

  getAmbientMotionScale(): number {
    return this.ambientScale
  }

  getScheduledCueCount(): number {
    return this.cues.length
  }

  private scheduleCues(cues: readonly PerformanceCue[], now: number): void {
    const ordered = [...cues].sort((left, right) => left.atMs - right.atMs)
    for (const cue of ordered) {
      let start = now + cue.atMs / 1_000
      if (cue.interrupt === 'queue') {
        for (const scheduled of this.cues) {
          if (scheduled.end > start) start = scheduled.end
        }
      }
      const fadeIn = cue.fadeInMs / 1_000
      const hold = Math.max(0.24, 0.72 / clamp(cue.tempo, 0.5, 1.6))
      const fadeOut = cue.fadeOutMs / 1_000
      const priority = expressionCuePriority(cue)
      if (cue.interrupt !== 'queue') {
        const active = this.selectedCueAt(start)
        if (
          cue.interrupt === 'if-lower' &&
          active &&
          priority <= active.priority
        ) {
          continue
        }
        for (const scheduled of this.cues) {
          if (
            scheduled.start <= start &&
            scheduled.end > start &&
            (cue.interrupt === 'replace' || scheduled.priority < priority)
          ) {
            scheduled.end = start
          }
        }
      }
      this.cues.push({
        start,
        fadeIn,
        hold,
        fadeOut,
        end: start + fadeIn + hold + fadeOut,
        interrupt: cue.interrupt,
        priority,
        offset: expressionCueOffset(cue),
      })
    }
    this.cues.sort((left, right) => left.start - right.start)
  }

  private selectedCueAt(now: number): ScheduledExpressionCue | null {
    let selected: ScheduledExpressionCue | null = null
    for (const cue of this.cues) {
      if (now < cue.start || now >= cue.end) continue
      if (!selected) {
        selected = cue
      } else if (cue.interrupt === 'replace') {
        selected = cue
      } else if (
        cue.interrupt === 'if-lower' &&
        cue.priority > selected.priority
      ) {
        selected = cue
      }
    }
    return selected
  }

  private pruneExpiredCues(now: number): void {
    let write = 0
    for (let read = 0; read < this.cues.length; read += 1) {
      const cue = this.cues[read]
      if (!cue || cue.end <= now) continue
      this.cues[write] = cue
      write += 1
    }
    this.cues.length = write
  }
}

export function performancePhaseRank(phase: PerformancePhase): number | null {
  const ordered: Partial<Record<PerformancePhase, number>> = {
    reaction: 1,
    delivery: 2,
    outcome: 3,
  }
  return ordered[phase] ?? null
}

function performanceDirectiveFingerprint(
  directive: PerformanceDirective,
): string {
  return JSON.stringify(directive)
}

export function baselineExpressionOffset(
  baseline: PerformanceBaseline,
): PerformanceExpressionOffset {
  const output = { ...ZERO_OFFSET }
  writeBaselineOffset(output, baseline)
  return output
}

export function expressionCueOffset(
  cue: PerformanceCue,
): PerformanceExpressionOffset {
  const amount = clamp(cue.intensity, 0.2, 1.4)
  const output = { ...ZERO_OFFSET }
  const patches: Record<
    PerformanceCue['intent'],
    Partial<PerformanceExpressionOffset>
  > = {
    greet: { angleZ: -0.035 * amount, brow: 0.02 * amount },
    respond: { angleY: -0.025 * amount, brow: 0.025 * amount },
    question: {
      angleZ: 0.055 * amount,
      brow: 0.08 * amount,
      eyeOpen: 0.018 * amount,
    },
    delight: {
      angleY: -0.035 * amount,
      brow: 0.06 * amount,
      eyeOpen: -0.025 * amount,
      eyeSqueeze: 0.84 * amount,
      mouthForm: 0.18 * amount,
    },
    emphasize: { angleY: 0.04 * amount, brow: 0.05 * amount },
    listen: { angleY: 0.03 * amount, brow: 0.025 * amount },
    notify: {
      angleZ: -0.03 * amount,
      brow: 0.06 * amount,
      eyeOpen: 0.02 * amount,
    },
    think: {
      angleZ: -0.14 * amount,
      brow: 0.14 * amount,
      eyeX: 0.5 * amount,
      eyeY: -0.36 * amount,
    },
    dizzy: {
      eyeDizzy: 1,
    },
    cry: {
      brow: 0.2 * amount,
      browAngSym: -0.3 * amount,
      eyeCry: 1,
      mouthForm: -0.12 * amount,
    },
    angry: { anger: amount },
    speechless: { speechless: amount },
    maniac: { maniac: amount },
  }
  Object.assign(output, patches[cue.intent])
  return output
}

/** Adds expression-owned channels while preserving manual left/right asymmetry. */
export function applyPerformanceExpressionOffset(
  target: PerformanceExpressionTarget,
  offset: Readonly<PerformanceExpressionOffset>,
): void {
  target.brow = mixBoundedExpressionChannel(target.brow, offset.brow, -1, 1, 0)
  target.browAngSym = mixBoundedExpressionChannel(
    target.browAngSym,
    offset.browAngSym,
    -1,
    1,
    0,
  )
  target.eyeOpenL = mixEyeOpen(target.eyeOpenL, offset.eyeOpen)
  target.eyeOpenR = mixEyeOpen(target.eyeOpenR, offset.eyeOpen)
  target.eyeDizzy = mixBoundedExpressionChannel(
    target.eyeDizzy,
    offset.eyeDizzy,
    0,
    1,
    0,
  )
  target.eyeSqueeze = mixBoundedExpressionChannel(
    target.eyeSqueeze,
    offset.eyeSqueeze,
    0,
    1,
    0,
  )
  target.eyeCry = mixBoundedExpressionChannel(
    target.eyeCry,
    offset.eyeCry,
    0,
    1,
    0,
  )
  target.eyeX = mixBoundedExpressionChannel(target.eyeX, offset.eyeX, -1, 1, 0)
  target.eyeY = mixBoundedExpressionChannel(target.eyeY, offset.eyeY, -1, 1, 0)
  target.mouthForm = mixBoundedExpressionChannel(
    target.mouthForm,
    offset.mouthForm,
    -1,
    1,
    0,
  )
  target.irisScale = mixBoundedExpressionChannel(
    target.irisScale,
    offset.irisScale,
    0.5,
    1.3,
    1,
  )
  target.angleY = mixBoundedExpressionChannel(
    target.angleY,
    offset.angleY,
    -1,
    1,
    0,
  )
  target.angleZ = mixBoundedExpressionChannel(
    target.angleZ,
    offset.angleZ,
    -1,
    1,
    0,
  )
  target.anger = mixBoundedExpressionChannel(
    target.anger ?? 0,
    offset.anger ?? 0,
    0,
    1,
    0,
  )
  target.speechless = mixBoundedExpressionChannel(
    target.speechless ?? 0,
    offset.speechless ?? 0,
    0,
    1,
    0,
  )
  target.maniac = mixBoundedExpressionChannel(
    target.maniac ?? 0,
    offset.maniac ?? 0,
    0,
    1,
    0,
  )
}

/** Keeps authored closed eyes closed while allowing partially open eyes to act. */
export function mixEyeOpen(base: number, offset: number): number {
  const boundedBase = clamp(base, 0, 1)
  const boundedOffset = finiteOrZero(offset)
  const influence =
    boundedOffset > 0 ? smootherstep(boundedBase / EYE_CLOSED_GUARD) : 1
  return clamp(boundedBase + boundedOffset * influence, 0, 1)
}

/** Preserves expression headroom instead of flattening other sources at limits. */
export function mixBoundedExpressionChannel(
  base: number,
  offset: number,
  minimum: number,
  maximum: number,
  neutral: number,
): number {
  const boundedBase = clamp(finiteOrZero(base), minimum, maximum)
  const boundedOffset = finiteOrZero(offset)
  if (boundedOffset === 0) return boundedBase
  const direction = boundedOffset > 0 ? 1 : -1
  const boundary = direction > 0 ? maximum : minimum
  const outwardSpan = Math.abs(boundary - neutral)
  if (outwardSpan <= 0) return boundedBase

  let result = boundedBase
  let remaining = Math.abs(boundedOffset)
  const distanceToNeutral = direction * (neutral - result)
  if (distanceToNeutral > 0) {
    const inward = Math.min(remaining, distanceToNeutral)
    result += direction * inward
    remaining -= inward
  }
  if (remaining <= 0) return clamp(result, minimum, maximum)

  const softStart = neutral + direction * outwardSpan * EXTREME_SOFT_LIMIT_START
  const distanceToSoftStart = direction * (softStart - result)
  if (distanceToSoftStart > 0) {
    const linear = Math.min(remaining, distanceToSoftStart)
    result += direction * linear
    remaining -= linear
  }
  if (remaining <= 0) return clamp(result, minimum, maximum)

  const headroom = Math.max(0, direction * (boundary - result))
  if (headroom <= 0) return clamp(result, minimum, maximum)
  const compressed = (remaining * headroom) / (remaining + headroom)
  return clamp(result + direction * compressed, minimum, maximum)
}

function writeBaselineOffset(
  output: PerformanceExpressionOffset,
  baseline: PerformanceBaseline,
): void {
  writeZero(output)
  const patches: Record<
    PerformanceBaseline['expression'],
    Partial<PerformanceExpressionOffset>
  > = {
    withdrawn: {
      brow: -0.11,
      eyeOpen: -0.08,
      mouthForm: -0.09,
      irisScale: -0.035,
    },
    subdued: {
      brow: -0.055,
      eyeOpen: -0.04,
      mouthForm: -0.04,
      irisScale: -0.015,
    },
    steady: {},
    warm: { brow: 0.055, mouthForm: 0.12, irisScale: 0.015 },
  }
  Object.assign(output, patches[baseline.expression])
}

function ambientScaleForAttention(attention: number): number {
  return 1 - 0.3 * clamp(attention, 0, 1)
}

function expressionCuePriority(cue: PerformanceCue): number {
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

function cueEnvelope(cue: ScheduledExpressionCue, now: number): number {
  const elapsed = now - cue.start
  if (elapsed < cue.fadeIn) return smootherstep(elapsed / cue.fadeIn)
  if (elapsed < cue.fadeIn + cue.hold) return 1
  return 1 - smootherstep((elapsed - cue.fadeIn - cue.hold) / cue.fadeOut)
}

function writeZero(output: PerformanceExpressionOffset): void {
  for (const key of OFFSET_KEYS) output[key] = 0
}

function smootherstep(value: number): number {
  const bounded = clamp(value, 0, 1)
  return bounded * bounded * bounded * (bounded * (bounded * 6 - 15) + 10)
}

function finiteTime(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
