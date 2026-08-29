import type { MeropeActivity } from '../types'
import type { MotionLeaseHandle, RigMotionCoordinator } from './coordinator'
import type { MoodIntent } from './intents'

const DEFAULT_MOOD = 70

/** Mood/activity baseline. Expression only; thinking is gated as ambient. */
export class MoodMotionSource {
  private handle: MotionLeaseHandle | null = null
  private intent: MoodIntent = { mood: DEFAULT_MOOD, activity: 'idle' }

  constructor(
    private readonly coordinator: RigMotionCoordinator,
    private readonly onChange: (intent: MoodIntent) => void,
  ) {}

  current(): MoodIntent {
    return this.intent
  }

  set(mood: number, activity: MeropeActivity): void {
    this.intent = { mood, activity }
    this.handle =
      this.coordinator.renew(this.handle, ['expression']) ??
      this.coordinator.claim('mood', ['expression'])
    this.onChange(this.intent)
  }

  release(): void {
    this.coordinator.release(this.handle)
    this.handle = null
  }
}
