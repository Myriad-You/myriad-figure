import type { PerformanceCue } from '../../../services/agent/types'
import type { BehaviorPlan, BehaviorRealizerReport } from '../motion/behavior'
import type { BehaviorRealizerContext } from '../motion/behaviorRealizer'
import { BehaviorRealizerRegistry } from '../motion/behaviorRealizer'
import { PERFORMANCE_CUE_INTENTS } from '../performanceContract'

interface RealizedCue {
  cue: PerformanceCue
}

export interface Anime25DBehaviorRealization {
  cues: readonly PerformanceCue[]
  reports: readonly BehaviorRealizerReport[]
}

const registry = new BehaviorRealizerRegistry<RealizedCue>().register(
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
    const tempo = finiteParameter(behavior.form.parameters?.tempo, 1)
    return {
      cue: {
        intent: behavior.form.id as PerformanceCue['intent'],
        atMs: Math.max(0, Math.round(timing.start - context.originMs)),
        intensity: clamp(behavior.intensity, 0.2, 1.4),
        tempo: clamp(tempo, 0.5, 1.6),
        fadeInMs: clampInt(timing.stroke - timing.start, 40, 600),
        fadeOutMs: clampInt(timing.end - timing.relax, 60, 800),
        // Queue/priority have already been resolved by the behavior planner.
        interrupt: 'replace',
      },
    }
  },
)

export function realizeAnime25DBehaviorPlan(
  plan: BehaviorPlan,
  nowMs: number,
): Anime25DBehaviorRealization {
  const realized = registry.realize(plan, nowMs)
  return {
    cues: realized.outputs.map((output) => output.cue),
    reports: realized.reports,
  }
}

function realizedTiming(
  timing: BehaviorPlan['behaviors'][number]['timing'],
  context: BehaviorRealizerContext,
): { start: number; stroke: number; relax: number; end: number } | null {
  const start = context.pegTimes.get(timing.start)
  const stroke = context.pegTimes.get(timing.stroke)
  const relax = timing.relax ? context.pegTimes.get(timing.relax) : undefined
  const end = timing.end ? context.pegTimes.get(timing.end) : undefined
  if (
    start === undefined ||
    stroke === undefined ||
    relax === undefined ||
    end === undefined ||
    start > stroke ||
    stroke > relax ||
    relax > end
  ) {
    return null
  }
  return { start, stroke, relax, end }
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
