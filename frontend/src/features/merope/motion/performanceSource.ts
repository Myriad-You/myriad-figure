import type { PerformanceDirective } from '../../../services/agent/types'
import type { RigBearing } from './bearing'
import type { BehaviorRealizerReport, BehaviorSnapshot } from './behavior'
import type { RealizerResult } from './behaviorScheduler'
import type { RigMotionCoordinator } from './coordinator'
import type { PerformanceIntent } from './intents'
import {
  MEROPE_PERFORMANCE_EVENT,
  meropePerformanceEventDetail,
} from '../performanceEvents'
import { PerformanceLifecycleController } from '../performanceLifecycle'
import { MEROPE_SPEECH_EVENT, meropeSpeechEventDetail } from '../speechEvents'
import { bearingFromDirective } from './bearing'
import { BehaviorScheduler } from './behaviorScheduler'
import { liveMotionGeneration, newMotionIntentId } from './liveGeneration'
import { compilePerformanceBehaviorPlan } from './performanceBehaviorPlan'
import { PerformanceMotionLeases } from './performanceLeases'
import { HumanReactionPolicy } from './reactionPolicy'

/**
 * One Lite performance producer for a coordinator. Publishes the directive
 * and timed leases; never writes a rig.
 */
export class PerformanceMotionSource {
  private readonly leases: PerformanceMotionLeases
  private readonly scheduler = new BehaviorScheduler()
  private readonly reactionPolicy = new HumanReactionPolicy()
  private controller: PerformanceLifecycleController | null = null
  private settleTimer: ReturnType<typeof setTimeout> | null = null
  private bearing: RigBearing | null = null
  private intent: PerformanceIntent = {
    directive: null,
    startedAtMs: 0,
    motionIntentId: null,
    behaviorPlan: null,
    behaviors: [],
  }

  private listening = false

  constructor(
    coordinator: RigMotionCoordinator,
    private readonly onChange: (intent: PerformanceIntent) => void,
    private readonly externalBehaviors: () => readonly BehaviorSnapshot[] = () => [],
  ) {
    this.leases = new PerformanceMotionLeases(coordinator)
  }

  current(nowMs: number = currentNow()): PerformanceIntent {
    if (!this.intent.behaviorPlan) return this.intent
    return { ...this.intent, behaviors: this.scheduler.tick(nowMs) }
  }

  currentBearing(): RigBearing | null {
    return this.bearing
  }

  start(): void {
    if (this.listening) return
    this.controller = new PerformanceLifecycleController({
      applyPerformanceDirective: (performance) => this.publish(performance),
      clearPerformanceDirective: () => this.clear(),
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
    const startedAtMs = currentNow()
    this.bearing = bearingFromDirective(performance) ?? this.bearing
    const selected = this.reactionPolicy.select(
      performance,
      [...this.scheduler.snapshots(startedAtMs), ...this.externalBehaviors()],
      startedAtMs,
    ).directive
    if (selected.plan.cues.length === 0) {
      this.intent = { ...this.intent, directive: selected }
      this.onChange(this.intent)
      return true
    }
    const motionIntentId = newMotionIntentId()
    const behaviorPlan = compilePerformanceBehaviorPlan(
      selected,
      startedAtMs,
      motionIntentId,
    )
    this.scheduler.replace(behaviorPlan, startedAtMs)
    const windows = this.leases.apply(selected, startedAtMs, behaviorPlan)
    this.intent = {
      directive: selected,
      startedAtMs,
      motionIntentId,
      generation: liveMotionGeneration() || undefined,
      behaviorPlan,
      behaviors: this.scheduler.tick(startedAtMs),
    }
    this.armSettle(windows.planUntilMs - startedAtMs)
    this.onChange(this.intent)
    return true
  }

  private clear(): void {
    this.clearSettle()
    this.leases.releaseAll()
    this.scheduler.clear(currentNow())
    this.intent = {
      directive: null,
      startedAtMs: 0,
      motionIntentId: null,
      behaviorPlan: null,
      behaviors: [],
    }
    this.onChange(this.intent)
  }

  reportRealizer(
    planId: string,
    behaviorId: string,
    result: RealizerResult,
    nowMs: number = currentNow(),
    reason?: BehaviorRealizerReport['reason'],
  ): void {
    const plan = this.intent.behaviorPlan
    if (!plan || plan.id !== planId) return
    this.scheduler.reportRealizer(behaviorId, result, nowMs, reason)
  }

  private armSettle(delayMs: number): void {
    this.clearSettle()
    const wait = Math.max(1, delayMs)
    const timer = setTimeout(() => {
      this.settleTimer = null
      this.clear()
    }, wait)
    this.settleTimer = timer
    if (typeof timer === 'object' && 'unref' in timer) timer.unref()
  }

  private clearSettle(): void {
    if (this.settleTimer == null) return
    clearTimeout(this.settleTimer)
    this.settleTimer = null
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

function currentNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}
