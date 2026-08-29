import type { PerformanceDirective } from '../../../services/agent/types'
import type { MotionLeaseHandle, RigMotionCoordinator } from './coordinator'
import { scheduleBodyCues } from '../anime25drig/performanceMotion'
import { cueOccupiesHeadBody } from './performanceChannels'

export interface PerformanceLeaseWindows {
  expressionCueUntilMs: number | null
  headBodyCueUntilMs: number | null
}

/**
 * Timed windows for a Lite plan. Expression baseline lasts until stop;
 * cue leases expire when the last occupying cue ends so music can resume.
 */
export function performanceLeaseWindows(
  directive: PerformanceDirective,
  originMs: number,
): PerformanceLeaseWindows {
  const scheduled = scheduleBodyCues(directive.plan.cues, originMs)
  let expressionCueUntilMs: number | null = null
  let headBodyCueUntilMs: number | null = null
  for (const item of scheduled) {
    expressionCueUntilMs =
      expressionCueUntilMs === null
        ? item.endMs
        : Math.max(expressionCueUntilMs, item.endMs)
    if (cueOccupiesHeadBody(item.cue)) {
      headBodyCueUntilMs =
        headBodyCueUntilMs === null
          ? item.endMs
          : Math.max(headBodyCueUntilMs, item.endMs)
    }
  }
  return { expressionCueUntilMs, headBodyCueUntilMs }
}

/**
 * One performance producer: baseline expression, a timed expression cue,
 * and a timed head/body cue. Each is an independent lease handle.
 */
export class PerformanceMotionLeases {
  private expressionBaseline: MotionLeaseHandle | null = null
  private expressionCue: MotionLeaseHandle | null = null
  private headBodyCue: MotionLeaseHandle | null = null

  constructor(private readonly coordinator: RigMotionCoordinator) {}

  apply(directive: PerformanceDirective, nowMs: number): void {
    const windows = performanceLeaseWindows(directive, nowMs)
    this.expressionBaseline = this.ensure(
      this.expressionBaseline,
      ['expression'],
      { nowMs },
    )
    this.expressionCue = this.syncTimed(
      this.expressionCue,
      ['expression'],
      windows.expressionCueUntilMs,
      nowMs,
    )
    this.headBodyCue = this.syncTimed(
      this.headBodyCue,
      ['headBody'],
      windows.headBodyCueUntilMs,
      nowMs,
    )
  }

  releaseAll(): void {
    this.coordinator.release(this.expressionBaseline)
    this.coordinator.release(this.expressionCue)
    this.coordinator.release(this.headBodyCue)
    this.expressionBaseline = null
    this.expressionCue = null
    this.headBodyCue = null
  }

  private ensure(
    current: MotionLeaseHandle | null,
    channels: readonly ['expression'] | readonly ['headBody'],
    options: { nowMs: number; ttlMs?: number },
  ): MotionLeaseHandle | null {
    return (
      this.coordinator.renew(current, channels, options) ??
      this.coordinator.claim('performance', channels, options)
    )
  }

  private syncTimed(
    current: MotionLeaseHandle | null,
    channels: readonly ['expression'] | readonly ['headBody'],
    untilMs: number | null,
    nowMs: number,
  ): MotionLeaseHandle | null {
    if (untilMs === null || untilMs <= nowMs) {
      this.coordinator.release(current)
      return null
    }
    return this.ensure(current, channels, {
      nowMs,
      ttlMs: untilMs - nowMs,
    })
  }
}
