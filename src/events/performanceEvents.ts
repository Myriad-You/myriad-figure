import type { MeropeStateEventDetail, PerformanceDirective } from '@myriad-you/figure-player/contract'
import type { FigureChannel } from '../channel'
import { meropeStateEventDetail, moodBand, sanitizePerformanceDirective } from '@myriad-you/figure-player/contract'

export const MEROPE_PERFORMANCE_EVENT = 'merope-performance'
export const MEROPE_STATE_EVENT = 'merope-state'
/** They typed to her: a listener's attention, nothing more is sent. */
export const MEROPE_LISTENING_EVENT = 'merope-listening'

export type { MeropeStateEventDetail } from '@myriad-you/figure-player/contract'

export interface MeropePerformanceEventDetail {
  text: string
  source: 'reply' | 'proactive' | 'interaction' | 'preview'
  messageId?: string
  runId?: string
  generation?: number
  motionIntentId?: string
  performance?: PerformanceDirective
}

/** A slow GET must not undo a newer live event */
export function resolveLoadedMeropeAffect(channel: FigureChannel, snapshot: {
  mood?: number
  arousal?: number
  moodRevision?: number
  activity?: string
}): { mood: number; arousal: number } {
  const mood = snapshot.mood ?? 70
  const arousal = snapshot.arousal ?? 48
  const revision = snapshot.moodRevision ?? 0
  dispatchMeropeState(channel, {
    mood: {
      before: mood,
      after: mood,
      arousalBefore: arousal,
      arousalAfter: arousal,
      bandBefore: moodBand(mood, arousal),
      bandAfter: moodBand(mood, arousal),
      delta: 0,
      cause: 'state_snapshot',
      revision,
    },
    activity: snapshot.activity ?? 'idle',
  })
  const live = channel.currentState()
  if (live && live.mood.revision > revision) {
    return {
      mood: live.mood.after,
      arousal: live.mood.arousalAfter ?? arousal,
    }
  }
  return { mood, arousal }
}

export function dispatchMeropePerformance(channel: FigureChannel, detail: unknown): void {
  const sanitized = meropePerformanceEventDetail(detail)
  if (!sanitized) return
  channel.dispatchEvent(
    new CustomEvent<MeropePerformanceEventDetail>(MEROPE_PERFORMANCE_EVENT, {
      detail: sanitized,
    }),
  )
}

export function meropePerformanceEventDetail(
  value: unknown,
): MeropePerformanceEventDetail | null {
  if (!isRecord(value)) return null
  const text =
    typeof value.text === 'string' ? value.text.trim().slice(0, 2_000) : ''
  const performance = sanitizePerformanceDirective(value.performance)
  if (!text && !performance) return null
  const source = ['reply', 'proactive', 'interaction', 'preview'].includes(
    String(value.source),
  )
    ? (value.source as MeropePerformanceEventDetail['source'])
    : 'reply'
  const messageId =
    typeof value.messageId === 'string'
      ? value.messageId.trim().slice(0, 160)
      : ''
  const generation =
    typeof value.generation === 'number' &&
    Number.isFinite(value.generation) &&
    value.generation > 0
      ? Math.min(1_000_000_000, Math.trunc(value.generation))
      : 0
  const runId =
    typeof value.runId === 'string' ? value.runId.trim().slice(0, 160) : ''
  const motionIntentId =
    typeof value.motionIntentId === 'string'
      ? value.motionIntentId.trim().slice(0, 160)
      : ''
  return {
    text,
    source,
    ...(messageId ? { messageId } : {}),
    ...(runId ? { runId } : {}),
    ...(generation ? { generation } : {}),
    ...(motionIntentId ? { motionIntentId } : {}),
    ...(performance ? { performance } : {}),
  }
}

export function dispatchMeropeState(channel: FigureChannel, value: unknown): void {
  const detail = meropeStateEventDetail(value)
  const live = channel.currentState()
  if (!detail || (live && detail.mood.revision <= live.mood.revision)) {
    return
  }
  channel.writeState(detail)
  channel.dispatchEvent(
    new CustomEvent<MeropeStateEventDetail>(MEROPE_STATE_EVENT, {
      detail,
    }),
  )
}

/** They typed a character to her; she attends while it goes on. */
export function dispatchMeropeListening(channel: FigureChannel): void {
  channel.dispatchEvent(new Event(MEROPE_LISTENING_EVENT))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
