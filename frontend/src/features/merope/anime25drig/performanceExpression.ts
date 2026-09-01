import type {
  PerformanceBaseline,
  PerformanceCue,
  PerformanceDirective,
  PerformancePhase,
} from '../../../services/agent/types'
import type { Anime25DDriver } from './driver'
import { performanceCuePriority } from '../performanceContract'
import { IDENTITY_DRIVER } from './driver'
import { cueExpressionPatch, cueIsSticker } from './performanceCueDefinitions'
import { cueVisualEnvelope, MIN_STICKER_FADE_OUT } from './performanceMotion'

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
  body: number
  armY: number
  armPos: number
  /** Additive secondary-motion strength around the driver's 2.5 rest value. */
  bust?: number
  anger?: number
  speechless?: number
  maniac?: number
  silly?: number
  lovestruck?: number
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
  body?: number
  armY?: number
  armPos?: number
  anger?: number
  speechless?: number
  maniac?: number
  silly?: number
  lovestruck?: number
}

interface ScheduledExpressionCue {
  start: number
  fadeIn: number
  hold: number
  fadeOut: number
  end: number
  interrupt: PerformanceCue['interrupt']
  priority: number
  sticker: boolean
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
  'body',
  'armY',
  'armPos',
  'bust',
  'anger',
  'speechless',
  'maniac',
  'silly',
  'lovestruck',
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
  body: 0,
  armY: 0,
  armPos: 0,
  bust: 0,
  anger: 0,
  speechless: 0,
  maniac: 0,
  silly: 0,
  lovestruck: 0,
}

const EYE_CLOSED_GUARD = 0.12
const EXTREME_SOFT_LIMIT_START = 0.8
const MAX_DIRECTIVE_FINGERPRINTS = 32

export type PerformanceDirectiveAcceptance = 'reject' | 'accept' | 'supersede'

/**
 * Legacy directive ordering retained as a compatibility reference.
 * Production behavior plans are ordered by BehaviorScheduler before this body.
 */
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
/**
 * Restates a wall-clock plan origin on the player clock.
 *
 * `startedAtMs` travels all the way down from the coordinator, but the player
 * runs its own accumulated clock, so the two cannot be compared directly. What
 * transfers is the plan's age: a directive that arrived 0.4s ago starts 0.4s
 * behind now. Without this a remount or a slow first frame replays a plan the
 * rig state summary already considers finished.
 */
export function performanceCueOrigin(
  playerTimeSeconds: number,
  cueOriginSeconds: number | undefined,
  nowWallSeconds: number = globalThis.performance.now() / 1_000,
): number {
  if (cueOriginSeconds === undefined || !Number.isFinite(cueOriginSeconds)) {
    return playerTimeSeconds
  }
  const ageSeconds = nowWallSeconds - cueOriginSeconds
  if (!Number.isFinite(ageSeconds) || ageSeconds <= 0) return playerTimeSeconds
  return playerTimeSeconds - ageSeconds
}

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
      // Later phases of the same turn replace pending beats, but an active
      // face must release instead of vanishing on the first new sample.
      this.releaseActiveCues(now)
    }
    if (!Number.isFinite(this.lastTime)) this.lastTime = now
    if (directive.plan.baseline) {
      writeBaselineOffset(this.target, directive.plan.baseline)
      this.ambientScaleTarget = ambientScaleForAttention(
        directive.plan.baseline.attention,
      )
    }
    // The origin is an age, not a clock reading: a plan that arrived while the
    // rig was remounting legitimately starts behind the player's own zero.
    // Flooring it here is what made a stale plan replay from the top.
    this.scheduleCues(directive.plan.cues, finiteOrZero(cueOriginSeconds))
    return true
  }

  /** New body-adapter path: scheduling is already resolved by BehaviorPlan. */
  playBehaviorCues(
    cues: readonly PerformanceCue[],
    timeSeconds: number,
    cueOriginSeconds = timeSeconds,
  ): boolean {
    if (cues.length === 0) return false
    const now = finiteTime(timeSeconds)
    this.pruneExpiredCues(now)
    this.releaseActiveCues(now)
    if (!Number.isFinite(this.lastTime)) this.lastTime = now
    this.scheduleCues(cues, finiteOrZero(cueOriginSeconds))
    return true
  }

  setBearingAttention(attention: number | null): void {
    this.ambientScaleTarget =
      attention === null ? 1 : ambientScaleForAttention(attention)
  }

  /** Releases transient cues without erasing the persistent bearing. */
  stopBehaviors(timeSeconds: number): void {
    const now = finiteTime(timeSeconds)
    this.lastTime = now
    this.gate.reset()
    this.releaseActiveCues(now)
  }

  stop(timeSeconds: number): void {
    const now = finiteTime(timeSeconds)
    this.lastTime = now
    this.gate.reset()
    this.releaseActiveCues(now)
    writeZero(this.target)
    this.ambientScaleTarget = 1
  }

  sample(timeSeconds: number): Readonly<PerformanceExpressionOffset> {
    const now = finiteTime(timeSeconds)
    const dt = Number.isFinite(this.lastTime)
      ? clamp(now - this.lastTime, 0, 0.05)
      : 0
    this.lastTime = now
    const releasing =
      Math.abs(this.ambientScaleTarget - 1) < 1e-6 &&
      OFFSET_KEYS.every((key) => Math.abs(this.target[key] ?? 0) < 1e-6)
    const baselineRate = 1 - Math.exp(-(releasing ? 5.2 : 7.5) * dt)
    this.ambientScale +=
      (this.ambientScaleTarget - this.ambientScale) * baselineRate
    for (const key of OFFSET_KEYS) {
      const current = this.current[key] ?? 0
      const target = this.target[key] ?? 0
      this.current[key] = current + (target - current) * baselineRate
      this.output[key] = this.current[key]
    }

    this.pruneExpiredCues(now)
    for (const cue of this.cues) {
      if (now < cue.start || now >= cue.end) continue
      const envelope = cueEnvelope(cue, now)
      if (envelope <= 0) continue
      for (const key of OFFSET_KEYS) {
        this.output[key] =
          (this.output[key] ?? 0) + (cue.offset[key] ?? 0) * envelope
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
      const sticker = cueIsSticker(cue.intent)
      const { fadeIn, hold, fadeOut } = cueVisualEnvelope(cue)
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
            releaseScheduledCue(scheduled, start)
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
        sticker,
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

  private releaseActiveCues(now: number): void {
    let write = 0
    for (const cue of this.cues) {
      if (cue.end <= now || cue.start > now) continue
      releaseScheduledCue(cue, now)
      if (cue.end <= now) continue
      this.cues[write] = cue
      write += 1
    }
    this.cues.length = write
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

/** Installs persistent bearing onto the authored base pose. */
export function bearingDriverPatch(
  baseline: PerformanceBaseline | null,
): Partial<Anime25DDriver> {
  const offset = baseline ? baselineExpressionOffset(baseline) : ZERO_OFFSET
  // PerformanceExpressionOffset is an additive space. Spell out the bearing's
  // actual base-pose ownership here so non-zero-neutral driver fields are not
  // mistaken for absolutes, and transient cue-only fields never leak into it.
  return {
    brow: offset.brow,
    eyeOpenL: IDENTITY_DRIVER.eyeOpenL + offset.eyeOpen,
    eyeOpenR: IDENTITY_DRIVER.eyeOpenR + offset.eyeOpen,
    mouthForm: offset.mouthForm,
    irisScale: IDENTITY_DRIVER.irisScale + offset.irisScale,
    body: offset.body,
    armY: offset.armY,
    armPos: offset.armPos,
  }
}

/**
 * Amplitudes are calibrated against screen pixels, not driver decimals.
 *
 * `layerDeformation` moves a brow point by `brow * 9 * faceScale`, and the
 * homepage rig renders about 300px wide — roughly a third of the source atlas.
 * The old 0.02 `greet` brow was therefore ~0.06 displayed pixels: correct in
 * the driver and invisible on screen, while `randomAction` was ambling around
 * in the 0.12–0.36 band the whole time. The character's own idle fidgeting
 * read louder than anything the director said. These land the ordinary beats
 * in that same band so a semantic cue is at least as legible as a fidget;
 * stickers still carry the strong, rare reads.
 */
export function expressionCueOffset(
  cue: PerformanceCue,
): PerformanceExpressionOffset {
  const output = { ...ZERO_OFFSET }
  Object.assign(output, cueExpressionPatch(cue))
  return output
}

/** Adds expression-owned channels while preserving manual left/right asymmetry. */
export function applyPerformanceExpressionOffset(
  target: PerformanceExpressionTarget,
  offset: Readonly<PerformanceExpressionOffset>,
  gaze = 1,
): void {
  target.brow = mixBoundedExpressionChannel(target.brow, offset.brow, -1, 1, 0)
  target.eyeX = mixBoundedExpressionChannel(
    target.eyeX,
    offset.eyeX * gaze,
    -1,
    1,
    0,
  )
  target.eyeY = mixBoundedExpressionChannel(
    target.eyeY,
    offset.eyeY * gaze,
    -1,
    1,
    0,
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
  if (typeof target.body === 'number') {
    target.body = mixBoundedExpressionChannel(
      target.body,
      offset.body,
      -1,
      1,
      0,
    )
  }
  if (typeof target.armY === 'number') {
    target.armY = mixBoundedExpressionChannel(
      target.armY,
      offset.armY,
      -1,
      1,
      0,
    )
  }
  if (typeof target.armPos === 'number') {
    target.armPos = mixBoundedExpressionChannel(
      target.armPos,
      offset.armPos,
      -1,
      1,
      0,
    )
  }
  applyPerformanceExpressionExtras(target, offset)
}

/** Applies semantic expression fields that are not pose-compositor channels. */
export function applyPerformanceExpressionExtras(
  target: PerformanceExpressionTarget,
  offset: Readonly<PerformanceExpressionOffset>,
  amount = 1,
): void {
  const weight = clamp(amount, 0, 1)
  target.browAngSym = mixBoundedExpressionChannel(
    target.browAngSym,
    offset.browAngSym * weight,
    -1,
    1,
    0,
  )
  target.eyeOpenL = mixEyeOpen(target.eyeOpenL, offset.eyeOpen * weight)
  target.eyeOpenR = mixEyeOpen(target.eyeOpenR, offset.eyeOpen * weight)
  target.eyeDizzy = mixBoundedExpressionChannel(
    target.eyeDizzy,
    offset.eyeDizzy * weight,
    0,
    1,
    0,
  )
  target.eyeSqueeze = mixBoundedExpressionChannel(
    target.eyeSqueeze,
    offset.eyeSqueeze * weight,
    0,
    1,
    0,
  )
  target.eyeCry = mixBoundedExpressionChannel(
    target.eyeCry,
    offset.eyeCry * weight,
    0,
    1,
    0,
  )
  target.mouthForm = mixBoundedExpressionChannel(
    target.mouthForm,
    offset.mouthForm * weight,
    -1,
    1,
    0,
  )
  target.irisScale = mixBoundedExpressionChannel(
    target.irisScale,
    offset.irisScale * weight,
    0.5,
    1.3,
    1,
  )
  target.anger = mixBoundedExpressionChannel(
    target.anger ?? 0,
    (offset.anger ?? 0) * weight,
    0,
    1,
    0,
  )
  target.speechless = mixBoundedExpressionChannel(
    target.speechless ?? 0,
    (offset.speechless ?? 0) * weight,
    0,
    1,
    0,
  )
  target.maniac = mixBoundedExpressionChannel(
    target.maniac ?? 0,
    (offset.maniac ?? 0) * weight,
    0,
    1,
    0,
  )
  target.silly = mixBoundedExpressionChannel(
    target.silly ?? 0,
    (offset.silly ?? 0) * weight,
    0,
    1,
    0,
  )
  target.lovestruck = mixBoundedExpressionChannel(
    target.lovestruck ?? 0,
    (offset.lovestruck ?? 0) * weight,
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
      brow: -0.16,
      eyeOpen: -0.08,
      mouthForm: -0.11,
      irisScale: -0.035,
    },
    subdued: {
      brow: -0.09,
      eyeOpen: -0.04,
      mouthForm: -0.05,
      irisScale: -0.015,
    },
    steady: {},
    warm: { brow: 0.12, mouthForm: 0.15, irisScale: 0.015 },
  }
  Object.assign(output, patches[baseline.expression])
  const posture: Record<
    PerformanceBaseline['posture'],
    Partial<PerformanceExpressionOffset>
  > = {
    closed: { body: -0.16, armY: -0.14, armPos: -0.18 },
    neutral: {},
    open: { body: 0.12, armY: 0.16, armPos: 0.2 },
  }
  Object.assign(output, posture[baseline.posture])
  const poseEnergy = 0.72 + clamp(baseline.motionEnergy, 0.2, 1.4) * 0.36
  output.body *= poseEnergy
  output.armY *= poseEnergy
  output.armPos *= poseEnergy
}

function ambientScaleForAttention(attention: number): number {
  return 1 - 0.3 * clamp(attention, 0, 1)
}

function expressionCuePriority(cue: PerformanceCue): number {
  return performanceCuePriority(cue.intent)
}

const MIN_CUE_RELEASE = 0.06

function releaseScheduledCue(cue: ScheduledExpressionCue, at: number): void {
  if (at <= cue.start || at >= cue.end) {
    cue.end = Math.min(cue.end, at)
    return
  }
  const fadeOut = Math.max(
    cue.fadeOut,
    cue.sticker ? MIN_STICKER_FADE_OUT : MIN_CUE_RELEASE,
  )
  const local = at - cue.start
  if (local < cue.fadeIn) {
    scaleOffset(cue.offset, cueEnvelope(cue, at))
    cue.fadeIn = local
    cue.hold = 0
    cue.fadeOut = fadeOut
    cue.end = at + fadeOut
    return
  }
  cue.hold = local - cue.fadeIn
  cue.fadeOut = fadeOut
  cue.end = at + fadeOut
}

function scaleOffset(
  offset: PerformanceExpressionOffset,
  amount: number,
): void {
  for (const key of OFFSET_KEYS) {
    offset[key] = (offset[key] ?? 0) * amount
  }
}

function cueEnvelope(cue: ScheduledExpressionCue, now: number): number {
  const elapsed = now - cue.start
  if (elapsed < 0) return 0
  if (cue.fadeIn > 0 && elapsed < cue.fadeIn) {
    return smootherstep(elapsed / cue.fadeIn)
  }
  if (elapsed < cue.fadeIn + cue.hold) return 1
  if (cue.fadeOut <= 0) return 0
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
