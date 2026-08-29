import type {
  ExclusiveMotionChannel,
  MotionChannel,
  MotionSourceId,
} from './channels'
import { channelPriority, isExclusiveChannel } from './channels'

export interface MotionLease {
  source: MotionSourceId
  channels: readonly MotionChannel[]
  generation: number
  expiresAtMs: number | null
}

export interface MotionSnapshot {
  generation: number
  owners: Record<ExclusiveMotionChannel, MotionSourceId>
  physics: MotionSourceId[]
  leases: readonly MotionLease[]
}

export interface MotionClaimOptions {
  nowMs?: number
  ttlMs?: number | null
}

const IDLE: MotionSourceId = 'idle'

/**
 * Runtime motion leases for every mounted face. One process-wide owner;
 * each rig only reads the snapshot. Physics overlays; the rest are exclusive.
 */
export class RigMotionCoordinator {
  private readonly leases = new Map<MotionSourceId, MotionLease>()
  private generation = 0
  private clockMs = 0

  claim(
    source: MotionSourceId,
    channels: readonly MotionChannel[],
    options: MotionClaimOptions = {},
  ): number {
    if (source === IDLE) return this.generation
    const unique = uniqueChannels(channels)
    if (unique.length === 0) {
      this.leases.delete(source)
      return this.generation
    }
    const nowMs = options.nowMs ?? this.clockMs
    this.clockMs = nowMs
    this.generation += 1
    const ttlMs = options.ttlMs
    this.leases.set(source, {
      source,
      channels: unique,
      generation: this.generation,
      expiresAtMs:
        typeof ttlMs === 'number' && ttlMs > 0 ? nowMs + ttlMs : null,
    })
    return this.generation
  }

  release(source: MotionSourceId, channels?: readonly MotionChannel[]): void {
    if (!channels || channels.length === 0) {
      this.leases.delete(source)
      this.generation += 1
      return
    }
    const current = this.leases.get(source)
    if (!current) return
    const drop = new Set(channels)
    const next = current.channels.filter((channel) => !drop.has(channel))
    if (next.length === 0) {
      this.leases.delete(source)
    } else {
      this.leases.set(source, { ...current, channels: next })
    }
    this.generation += 1
  }

  tick(nowMs: number): void {
    this.clockMs = nowMs
    let expired = false
    for (const [source, lease] of this.leases) {
      if (lease.expiresAtMs !== null && lease.expiresAtMs <= nowMs) {
        this.leases.delete(source)
        expired = true
      }
    }
    if (expired) this.generation += 1
  }

  owner(
    channel: ExclusiveMotionChannel,
    nowMs: number = this.clockMs,
  ): MotionSourceId {
    this.tick(nowMs)
    let winner: MotionSourceId = IDLE
    let best = 0
    let bestGeneration = 0
    for (const lease of this.leases.values()) {
      if (!lease.channels.includes(channel)) continue
      const priority = channelPriority(channel, lease.source)
      if (
        priority > best ||
        (priority === best && lease.generation > bestGeneration)
      ) {
        winner = lease.source
        best = priority
        bestGeneration = lease.generation
      }
    }
    return winner
  }

  snapshot(nowMs: number = this.clockMs): MotionSnapshot {
    this.tick(nowMs)
    const owners = {
      mouth: this.owner('mouth', nowMs),
      expression: this.owner('expression', nowMs),
      gaze: this.owner('gaze', nowMs),
      headBody: this.owner('headBody', nowMs),
    }
    const physics: MotionSourceId[] = []
    for (const lease of this.leases.values()) {
      if (lease.channels.includes('physics')) physics.push(lease.source)
    }
    return {
      generation: this.generation,
      owners,
      physics,
      leases: [...this.leases.values()],
    }
  }
}

const runtime = { current: new RigMotionCoordinator() }

export function getRigMotionCoordinator(): RigMotionCoordinator {
  return runtime.current
}

export function resetRigMotionCoordinator(): RigMotionCoordinator {
  runtime.current = new RigMotionCoordinator()
  return runtime.current
}

function uniqueChannels(channels: readonly MotionChannel[]): MotionChannel[] {
  const seen = new Set<MotionChannel>()
  const unique: MotionChannel[] = []
  for (const channel of channels) {
    if (!isExclusiveChannel(channel) && channel !== 'physics') continue
    if (seen.has(channel)) continue
    seen.add(channel)
    unique.push(channel)
  }
  return unique
}

export type { ExclusiveMotionChannel }
