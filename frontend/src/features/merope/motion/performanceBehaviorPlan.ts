import type {
  PerformanceCue,
  PerformanceDirective,
} from '../../../services/agent/types'
import type {
  BehaviorFunction,
  BehaviorPlan,
  ScheduledBehavior,
  TimePeg,
} from './behavior'
import { performanceCueDefinition } from '../anime25drig/performanceCueDefinitions'
import {
  cueVisualEnvelope,
  scheduleBodyCues,
} from '../anime25drig/performanceMotion'

/**
 * Adapts today's Strict-Lite directive into the renderer-neutral behavior
 * protocol. The directive remains the Anime2.5D realization input during the
 * migration, while timing, lifecycle and resource facts come from this plan.
 */
export function compilePerformanceBehaviorPlan(
  directive: PerformanceDirective,
  originMs: number,
  planId: string,
): BehaviorPlan {
  const pegs: TimePeg[] = []
  const behaviors: ScheduledBehavior[] = []
  const scheduled = scheduleBodyCues(directive.plan.cues, originMs)

  scheduled.forEach((item, index) => {
    const prefix = `${planId}:cue-${index}`
    const envelope = cueVisualEnvelope(item.cue)
    const strokeAt = Math.min(
      item.endMs,
      item.startMs + envelope.fadeIn * 1_000,
    )
    const relaxAt = Math.max(strokeAt, item.endMs - envelope.fadeOut * 1_000)
    const holdAt = Math.min(relaxAt, strokeAt + 80)
    pegs.push(
      peg(`${prefix}:start`, item.startMs),
      peg(`${prefix}:stroke`, strokeAt),
      peg(`${prefix}:hold`, holdAt),
      peg(`${prefix}:relax`, relaxAt),
      peg(`${prefix}:end`, item.endMs),
    )
    behaviors.push({
      id: prefix,
      function: cueFunction(item.cue.intent),
      kind: 'oneShot',
      source: 'performance',
      resources: performanceCueDefinition(item.cue.intent).resources,
      channels: performanceCueDefinition(item.cue.intent).channels,
      timing: {
        start: `${prefix}:start`,
        stroke: `${prefix}:stroke`,
        hold: `${prefix}:hold`,
        relax: `${prefix}:relax`,
        end: `${prefix}:end`,
      },
      form: {
        family: 'performance-cue',
        id: item.cue.intent,
        parameters: { tempo: item.cue.tempo },
      },
      intensity: clamp(item.cue.intensity, 0.2, 1.4),
    })
  })

  return {
    id: planId,
    originMs,
    metadata: {
      phase: directive.phase,
      moodRevision: directive.moodRevision,
    },
    pegs,
    behaviors,
  }
}

function cueFunction(intent: PerformanceCue['intent']): BehaviorFunction {
  switch (intent) {
    case 'greet':
    case 'notify':
      return 'orient'
    case 'respond':
      return 'acknowledge'
    case 'question':
      return 'uncertain'
    case 'delight':
      return 'celebrate'
    case 'emphasize':
      return 'emphasize'
    case 'listen':
      return 'attend'
    case 'think':
      return 'prepareSpeech'
    case 'speechless':
      return 'surprise'
    case 'cry':
      return 'relief'
    default:
      return 'express'
  }
}

function peg(id: string, atMs: number): TimePeg {
  return { id, atMs: Math.max(0, atMs), revision: 0 }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
