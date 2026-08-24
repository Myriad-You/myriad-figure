import type { PerformanceDirective } from '../../services/agent/types'
import type { MeropePerformanceEventDetail } from './performanceEvents'
import type { MeropeSpeechEventDetail } from './speechEvents'

export interface PerformanceLifecycleTarget {
  playMotionPlan: (performance: PerformanceDirective) => boolean
  stopMotionPlan: () => void
}

/** Forwards bounded semantic plans to the mounted rig; text stays speech-owned. */
export class PerformanceLifecycleController {
  private activeMessageId: string | null = null
  private readonly cancelledMessageIds = new Set<string>()
  private readonly cancellationOrder: string[] = []

  constructor(private readonly target: PerformanceLifecycleTarget) {}

  handle(event: MeropePerformanceEventDetail): void {
    if (!event.performance) return
    if (event.messageId && this.cancelledMessageIds.has(event.messageId)) return
    if (!this.target.playMotionPlan(event.performance)) return
    this.activeMessageId = event.messageId ?? null
  }

  handleSpeech(event: MeropeSpeechEventDetail): void {
    if (event.phase !== 'cancel') return
    this.rememberCancellation(event.messageId)
    if (event.messageId !== this.activeMessageId) return
    this.activeMessageId = null
    this.target.stopMotionPlan()
  }

  dispose(): void {
    this.activeMessageId = null
    this.target.stopMotionPlan()
  }

  private rememberCancellation(messageId: string): void {
    if (this.cancelledMessageIds.has(messageId)) return
    this.cancelledMessageIds.add(messageId)
    this.cancellationOrder.push(messageId)
    if (this.cancellationOrder.length <= 32) return
    const expired = this.cancellationOrder.shift()
    if (expired) this.cancelledMessageIds.delete(expired)
  }
}
