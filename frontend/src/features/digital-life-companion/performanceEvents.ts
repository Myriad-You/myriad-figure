import type { MotionCharacterState } from './rig/motion'
import type { CompanionMotionPlan } from './rig/planner'
import { motionPlanFromMessageMeta, planCompanionMotion } from './rig/planner'

export const COMPANION_PERFORMANCE_EVENT = 'arael-companion-performance'

export interface CompanionPerformanceEventDetail {
  text: string
  source: CompanionMotionPlan['source']
  messageId?: string
  motionPlan?: unknown
}

export function dispatchCompanionPerformance(
  detail: CompanionPerformanceEventDetail,
): void {
  const sanitized = companionPerformanceEventDetail(detail)
  if (!sanitized || typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<CompanionPerformanceEventDetail>(
      COMPANION_PERFORMANCE_EVENT,
      { detail: sanitized },
    ),
  )
}

export function companionPerformanceEventDetail(
  value: unknown,
): CompanionPerformanceEventDetail | null {
  if (!isRecord(value) || typeof value.text !== 'string') return null
  const text = value.text.trim().slice(0, 2_000)
  if (!text) return null
  const source = ['reply', 'proactive', 'interaction', 'preview'].includes(
    String(value.source),
  )
    ? (value.source as CompanionMotionPlan['source'])
    : 'reply'
  return {
    text,
    source,
    ...(typeof value.messageId === 'string'
      ? { messageId: value.messageId.slice(0, 160) }
      : {}),
    ...(value.motionPlan !== undefined ? { motionPlan: value.motionPlan } : {}),
  }
}

export function planCompanionPerformanceEvent(
  detail: CompanionPerformanceEventDetail,
  state: MotionCharacterState,
): CompanionMotionPlan {
  const suppliedPlan = motionPlanFromMessageMeta(
    { motionPlan: detail.motionPlan },
    detail.source,
  )
  return (
    suppliedPlan ||
    planCompanionMotion({
      text: detail.text,
      source: detail.source,
      state,
    })
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
