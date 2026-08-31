/**
 * Exclusive control of the live face. Algorithms stay in the player;
 * this table only decides who may drive which group of drivers.
 *
 */

export const MOTION_CHANNELS = [
  'mouth',
  'expression',
  'gaze',
  'headBody',
] as const

export type MotionChannel = (typeof MOTION_CHANNELS)[number]

export const MOTION_SOURCES = [
  'preview',
  'speech',
  'performance',
  'music',
  'coSpeech',
  'mood',
  'ambient',
  'idle',
] as const

export type MotionSourceId = (typeof MOTION_SOURCES)[number]

export const EXCLUSIVE_CHANNELS = MOTION_CHANNELS

export type ExclusiveMotionChannel = MotionChannel

/**
 * Higher number wins. Missing source is idle.
 * Pointer gaze is a local overlay (`allowsPointerGaze`), not a lease.
 */
export const CHANNEL_PRIORITY: Record<
  ExclusiveMotionChannel,
  Partial<Record<MotionSourceId, number>>
> = {
  mouth: {
    preview: 100,
    speech: 80,
    music: 60,
  },
  expression: {
    preview: 100,
    performance: 80,
    coSpeech: 55,
    mood: 20,
  },
  gaze: {
    preview: 100,
    performance: 60,
    ambient: 20,
  },
  headBody: {
    preview: 100,
    performance: 80,
    music: 60,
    coSpeech: 40,
    ambient: 20,
  },
}

export function channelPriority(
  channel: ExclusiveMotionChannel,
  source: MotionSourceId,
): number {
  return CHANNEL_PRIORITY[channel][source] ?? 0
}
