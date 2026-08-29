import type { MotionLeaseHandle, RigMotionCoordinator } from './coordinator'

/** Idle floor: gaze, head/body, and physics at ambient priority. */
export class AmbientMotionSource {
  private handle: MotionLeaseHandle | null = null

  constructor(private readonly coordinator: RigMotionCoordinator) {}

  claim(): void {
    this.handle =
      this.coordinator.renew(this.handle, ['gaze', 'headBody', 'physics']) ??
      this.coordinator.claim('ambient', ['gaze', 'headBody', 'physics'])
  }

  release(): void {
    this.coordinator.release(this.handle)
    this.handle = null
  }
}
