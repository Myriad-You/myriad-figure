import type { PerformanceCue } from '../../../services/agent/types'
import type { BehaviorPlan, BehaviorRealizerReport } from '../motion/behavior'
import type { BehaviorRealizerContext } from '../motion/behaviorRealizerRegistry'
import type { Anime25DMotionUnit } from './behaviorMotion'
import { BehaviorRealizerRegistry } from '../motion/behaviorRealizerRegistry'
import { PERFORMANCE_CUE_INTENTS } from '../performanceContract'
import { completeBehaviorQuality } from './behaviorMotion'

type RealizedBehavior =
  | { kind: 'cue'; behaviorId: string; cue: PerformanceCue }
  | { kind: 'motion'; unit: Anime25DMotionUnit }

export interface Anime25DBehaviorRealization {
  cues: readonly PerformanceCue[]
  cueBehaviorIds: readonly string[]
  units: readonly Anime25DMotionUnit[]
  reports: readonly BehaviorRealizerReport[]
}

const registry = new BehaviorRealizerRegistry<RealizedBehavior>().register(
  'performance-cue',
  (behavior, context) => {
    if (
      !PERFORMANCE_CUE_INTENTS.includes(
        behavior.form.id as PerformanceCue['intent'],
      )
    ) {
      return null
    }
    const timing = realizedTiming(behavior.timing, context)
    if (!timing) return null
    const quality = completeBehaviorQuality(behavior.quality)
    const tempo =
      behavior.quality?.tempo ??
      finiteParameter(behavior.form.parameters?.tempo, 1)
    return {
      kind: 'cue',
      behaviorId: behavior.id,
      cue: {
        intent: behavior.form.id as PerformanceCue['intent'],
        atMs: Math.max(0, Math.round(timing.start - context.originMs)),
        intensity: clamp(
          behavior.intensity *
            (0.62 + quality.extent * 0.25 + quality.power * 0.13),
          0.2,
          1.4,
        ),
        tempo: clamp(tempo, 0.5, 1.6),
        fadeInMs: clampInt(timing.strokePeak - timing.start, 40, 600),
        holdMs: clampInt(timing.relax - timing.strokeEnd, 60, 4_000),
        fadeOutMs: clampInt(timing.end - timing.relax, 60, 800),
        // Queue/priority have already been resolved by the behavior planner.
        interrupt: 'replace',
      },
    }
  },
)

registry.register('co-speech', (behavior, context) => {
  if (behavior.form.id !== 'presence' && behavior.form.id !== 'accent') {
    return null
  }
  const timing = realizedUnitTiming(behavior.timing, context)
  if (!timing) return null
  return {
    kind: 'motion',
    unit: {
      behaviorId: behavior.id,
      family: 'co-speech',
      form: behavior.form.id,
      kind: behavior.kind,
      timing,
      intensity: clamp(behavior.intensity, 0.2, 1.4),
      quality: completeBehaviorQuality(behavior.quality),
    },
  }
})

registry.register('music', (behavior, context) => {
  if (behavior.form.id !== 'groove') return null
  const timing = realizedUnitTiming(behavior.timing, context)
  if (!timing) return null
  return {
    kind: 'motion',
    unit: {
      behaviorId: behavior.id,
      family: 'music',
      form: behavior.form.id,
      kind: behavior.kind,
      timing,
      intensity: clamp(behavior.intensity, 0.2, 1.4),
      quality: completeBehaviorQuality(behavior.quality),
    },
  }
})

export function realizeAnime25DBehaviorPlan(
  plan: BehaviorPlan,
  nowMs: number,
): Anime25DBehaviorRealization {
  const realized = registry.realize(plan, nowMs)
  return {
    cues: realized.outputs
      .filter((output) => output.kind === 'cue')
      .map((output) => output.cue),
    cueBehaviorIds: realized.outputs
      .filter((output) => output.kind === 'cue')
      .map((output) => output.behaviorId),
    units: realized.outputs
      .filter((output) => output.kind === 'motion')
      .map((output) => output.unit),
    reports: realized.reports,
  }
}

function realizedUnitTiming(
  timing: BehaviorPlan['behaviors'][number]['timing'],
  context: BehaviorRealizerContext,
): Anime25DMotionUnit['timing'] | null {
  const startMs = context.pegTimes.get(timing.start)
  const readyMs = context.pegTimes.get(timing.ready)
  const strokeStartMs = context.pegTimes.get(timing.strokeStart)
  const strokePeakMs = context.pegTimes.get(timing.strokePeak)
  const strokeEndMs = context.pegTimes.get(timing.strokeEnd)
  const relaxMs =
    timing.relax === null ? null : context.pegTimes.get(timing.relax)
  const endMs = timing.end === null ? null : context.pegTimes.get(timing.end)
  if (
    startMs === undefined ||
    readyMs === undefined ||
    strokeStartMs === undefined ||
    strokePeakMs === undefined ||
    strokeEndMs === undefined ||
    relaxMs === undefined ||
    endMs === undefined ||
    startMs > readyMs ||
    readyMs > strokeStartMs ||
    strokeStartMs > strokePeakMs ||
    strokePeakMs > strokeEndMs ||
    (relaxMs !== null && strokeEndMs > relaxMs) ||
    (endMs !== null && (relaxMs === null || relaxMs > endMs))
  ) {
    return null
  }
  return {
    startMs,
    readyMs,
    strokeStartMs,
    strokePeakMs,
    strokeEndMs,
    relaxMs,
    endMs,
  }
}

function realizedTiming(
  timing: BehaviorPlan['behaviors'][number]['timing'],
  context: BehaviorRealizerContext,
): {
  start: number
  ready: number
  strokeStart: number
  strokePeak: number
  strokeEnd: number
  relax: number
  end: number
} | null {
  const start = context.pegTimes.get(timing.start)
  const ready = context.pegTimes.get(timing.ready)
  const strokeStart = context.pegTimes.get(timing.strokeStart)
  const strokePeak = context.pegTimes.get(timing.strokePeak)
  const strokeEnd = context.pegTimes.get(timing.strokeEnd)
  const relax = timing.relax ? context.pegTimes.get(timing.relax) : undefined
  const end = timing.end ? context.pegTimes.get(timing.end) : undefined
  if (
    start === undefined ||
    ready === undefined ||
    strokeStart === undefined ||
    strokePeak === undefined ||
    strokeEnd === undefined ||
    relax === undefined ||
    end === undefined ||
    start > ready ||
    ready > strokeStart ||
    strokeStart > strokePeak ||
    strokePeak > strokeEnd ||
    strokeEnd > relax ||
    relax > end
  ) {
    return null
  }
  return { start, ready, strokeStart, strokePeak, strokeEnd, relax, end }
}

function finiteParameter(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clampInt(value: number, minimum: number, maximum: number): number {
  return Math.round(clamp(value, minimum, maximum))
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
