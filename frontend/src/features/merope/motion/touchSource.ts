import type { TouchObservation } from '../interaction/touchGesture'
import type { BehaviorPlan } from './behavior'
import type { MotionLeaseHandle, RigMotionCoordinator } from './coordinator'
import { compilePerformanceBehaviorPlan } from './performanceBehaviorPlan'

/** A separate candidate plan, not a replacement of the reply director plan. */
export class TouchMotionSource {
  private plan: BehaviorPlan | null = null
  private lease: MotionLeaseHandle | null = null
  private owner: string | null = null
  private contactId = 0
  private gesture = ''
  private releaseTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly coordinator: RigMotionCoordinator, private readonly changed: () => void) {}

  current(): BehaviorPlan | null { return this.plan }

  update(owner: string, touch: TouchObservation, nowMs: number): void {
    if (touch.phase === 'end' || touch.phase === 'cancel') {
      if (this.owner === owner && this.contactId === touch.id) {
        if (touch.phase === 'end' && touch.gesture === 'tap') {
          if (this.releaseTimer) clearTimeout(this.releaseTimer)
          this.releaseTimer = setTimeout(() => {
            if (this.owner === owner && this.contactId === touch.id) this.release(owner)
          }, 220)
        } else { this.release(owner)
}
      }
      return
    }
    if (touch.phase !== 'start' && (this.owner !== owner || this.contactId !== touch.id)) return
    const same = this.owner === owner && this.contactId === touch.id
    if (same && this.gesture === touch.gesture) return
    if (!same) this.release()
    this.owner = owner
    this.contactId = touch.id
    this.gesture = touch.gesture
    const origin = same ? this.plan!.originMs : nowMs
    const plan = compilePerformanceBehaviorPlan({
      phase: 'reaction', moodRevision: 0, motionStyle: 'even',
      plan: { cues: [{ intent: 'listen', atMs: 0, intensity: touch.gesture === 'stroke' ? 0.85 : 0.55,
        tempo: 1, fadeInMs: 120, fadeOutMs: 260, interrupt: 'if-lower' }] },
    }, origin, `touch:${owner}:${touch.id}`)
    this.plan = {
      ...plan,
      behaviors: plan.behaviors.map((behavior) => ({
        ...behavior, kind: 'state',
        timing: { ...behavior.timing, relax: null, end: null },
      })),
    }
    const channels = this.plan.behaviors.flatMap((behavior) => behavior.channels)
    this.lease = this.coordinator.renew(this.lease, channels, { nowMs })
      ?? this.coordinator.claim('performance', channels, { nowMs })
    this.changed()
  }

  release(owner?: string): void {
    if (owner !== undefined && owner !== this.owner) return
    if (this.releaseTimer) clearTimeout(this.releaseTimer)
    this.releaseTimer = null
    const changed = this.plan !== null
    this.coordinator.release(this.lease)
    this.lease = null
    this.plan = null
    this.owner = null
    if (changed) this.changed()
  }
}
