import type { PerformanceDirective } from '../../../services/agent/types'
import type { SpeechArticulation } from '../rig/articulation'
import type { MeropeActivity } from '../types'
import type { MotionSnapshot } from './coordinator'
import type { SingingFrame } from './musicSource'

export interface SpeechTextChunk {
  seq: number
  text: string
  locale?: string
}

export interface SpeechIntent {
  active: boolean
  autoSpeech: boolean
  energy: number | null
  articulation: SpeechArticulation | null
  queuedText: readonly SpeechTextChunk[]
}

export interface PerformanceIntent {
  directive: PerformanceDirective | null
  startedAtMs: number
  motionIntentId?: string | null
  generation?: number
}

export interface MoodIntent {
  mood: number
  activity: MeropeActivity
}

/**
 * One generation of semantic motion. Sources publish intents; each live
 * rig consumes this frame. Algorithms stay in the player.
 */
export interface MotionFrame {
  snapshot: MotionSnapshot
  speech: SpeechIntent | null
  performance: PerformanceIntent | null
  music: SingingFrame | null
  mood: MoodIntent | null
}
