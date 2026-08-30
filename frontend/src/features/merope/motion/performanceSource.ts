import type { PerformanceDirective } from '../../../services/agent/types'
import type { RigMotionCoordinator } from './coordinator'
import type { PerformanceIntent } from './intents'
import {
  MEROPE_PERFORMANCE_EVENT,
  meropePerformanceEventDetail,
} from '../performanceEvents'
import { PerformanceLifecycleController } from '../performanceLifecycle'
import { MEROPE_SPEECH_EVENT, meropeSpeechEventDetail } from '../speechEvents'
import {
  liveMotionGeneration,
  newMotionIntentId,
} from './liveGeneration'
import { PerformanceMotionLeases } from './performanceLeases'

/**
 * One Lite performance producer for a coordinator. Publishes the directive
 * and timed leases; never writes a rig.
 */
export class PerformanceMotionSource {
  private readonly leases: PerformanceMotionLeases
  private controller: PerformanceLifecycleController | null = null
  private intent: PerformanceIntent = {
    directive: null,
    startedAtMs: 0,
    motionIntentId: null,
  }

  private listening = false

  constructor(
    coordinator: RigMotionCoordinator,
    private readonly onChange: (intent: PerformanceIntent) => void,
  ) {
    this.leases = new PerformanceMotionLeases(coordinator)
  }

  current(): PerformanceIntent {
    return this.intent
  }

  start(): void {
    if (this.listening) return
    this.controller = new PerformanceLifecycleController({
      playMotionPlan: (performance) => this.publish(performance),
      stopMotionPlan: () => this.clear(),
    })
    if (typeof window !== 'undefined') {
      window.addEventListener(MEROPE_PERFORMANCE_EVENT, this.onPerformance)
      window.addEventListener(MEROPE_SPEECH_EVENT, this.onSpeech)
    }
    this.listening = true
  }

  stop(): void {
    if (!this.listening) return
    if (typeof window !== 'undefined') {
      window.removeEventListener(MEROPE_PERFORMANCE_EVENT, this.onPerformance)
      window.removeEventListener(MEROPE_SPEECH_EVENT, this.onSpeech)
    }
    this.controller?.dispose()
    this.controller = null
    this.listening = false
  }

  apply(performance: PerformanceDirective): boolean {
    return this.publish(performance)
  }

  handleForTest(performance: PerformanceDirective): boolean {
    return this.apply(performance)
  }

  private publish(performance: PerformanceDirective): boolean {
    const startedAtMs = globalThis.performance.now()
    this.leases.apply(performance, startedAtMs)
    this.intent = {
      directive: performance,
      startedAtMs,
      motionIntentId: newMotionIntentId(),
      generation: liveMotionGeneration() || undefined,
    }
    this.onChange(this.intent)
    return true
  }

  private clear(): void {
    this.leases.releaseAll()
    this.intent = { directive: null, startedAtMs: 0, motionIntentId: null }
    this.onChange(this.intent)
  }

  private readonly onPerformance = (event: Event): void => {
    const detail = meropePerformanceEventDetail(
      (event as CustomEvent<unknown>).detail,
    )
    if (detail) this.controller?.handle(detail)
  }

  private readonly onSpeech = (event: Event): void => {
    const detail = meropeSpeechEventDetail(
      (event as CustomEvent<unknown>).detail,
    )
    if (detail) this.controller?.handleSpeech(detail)
  }
}
