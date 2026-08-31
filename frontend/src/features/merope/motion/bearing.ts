import type {
  PerformanceBaseline,
  PerformanceDirective,
} from '../../../services/agent/types'

/**
 * Persistent social bearing underneath transient behaviors.
 *
 * This is the character's current way of carrying herself, not an animation
 * clip and not a channel lease. A new turn may revise it; stopping a gesture
 * must not erase it.
 */
export interface RigBearing extends PerformanceBaseline {
  revision: number
}

export function bearingFromDirective(
  directive: PerformanceDirective,
): RigBearing | null {
  const baseline = directive.plan.baseline
  if (!baseline) return null
  return {
    ...baseline,
    revision: Math.max(0, Math.trunc(directive.moodRevision)),
  }
}
