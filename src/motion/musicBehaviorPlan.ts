import type { MusicMode } from '../singing/musicSignal'
import type { BehaviorPlan } from './behavior'
import { MUSIC_QUALITY } from './musicReaction'

/** Entrainment to the music: one rhythmic behavior on head and body, anticipating the next beat. */
export function compileMusicBehaviorPlan(sequence: number, nowMs: number, mode: MusicMode): BehaviorPlan {
  const prefix = `music-${sequence}`
  const start = `${prefix}:start`
  const ready = `${prefix}:ready`
  const strokeStart = `${prefix}:stroke-start`
  const strokePeak = `${prefix}:stroke-peak`
  const strokeEnd = `${prefix}:stroke-end`
  const anticipation = `${prefix}:next-beat`
  const behaviorId = `${prefix}:entrain`
  return {
    id: prefix,
    originMs: nowMs,
    pegs: [
      { id: start, atMs: nowMs, revision: 0 },
      { id: ready, atMs: nowMs + 55, revision: 0 },
      { id: strokeStart, atMs: nowMs + 88, revision: 0 },
      { id: strokePeak, atMs: nowMs + 120, revision: 0 },
      { id: strokeEnd, atMs: nowMs + 180, revision: 0 },
      {
        id: anticipation,
        atMs: nowMs + 500,
        revision: 0,
        confidence: 0,
      },
    ],
    behaviors: [
      {
        id: behaviorId,
        function: 'entrain',
        kind: 'rhythmic',
        source: 'music',
        resources: [
          'body.head',
          'body.torso',
          'body.arm.left',
          'body.arm.right',
        ],
        channels: ['headBody'],
        timing: {
          start,
          ready,
          strokeStart,
          strokePeak,
          strokeEnd,
          relax: null,
          end: null,
        },
        anticipation,
        form: { family: 'music', id: mode },
        intensity: 1,
        quality: MUSIC_QUALITY[mode],
        confidence: 0.8,
      },
    ],
  }
}
