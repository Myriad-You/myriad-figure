/**
 * Exclusive control of the live face. Algorithms stay in the player;
 * this table only decides who may drive which group of drivers.
 *
 * Physics is overlay, not exclusive: every claimed source may mix.
 */

export const MOTION_CHANNELS = [
  'mouth',
  'expression',
  'gaze',
  'headBody',
  'physics',
] as const

export type MotionChannel = (typeof MOTION_CHANNELS)[number]

export const MOTION_SOURCES = [
  'preview',
  'speech',
  'performance',
  'music',
  'coSpeech',
  'mood',
  'pointer',
  'ambient',
  'autonomy',
  'idle',
] as const

export type MotionSourceId = (typeof MOTION_SOURCES)[number]

export const EXCLUSIVE_CHANNELS = [
  'mouth',
  'expression',
  'gaze',
  'headBody',
] as const satisfies readonly MotionChannel[]

export type ExclusiveMotionChannel = (typeof EXCLUSIVE_CHANNELS)[number]

/** Higher number wins. Missing source is idle. */
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
    coSpeech: 50,
    music: 50,
    mood: 20,
  },
  gaze: {
    preview: 100,
    pointer: 80,
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

export function isExclusiveChannel(
  channel: MotionChannel,
): channel is ExclusiveMotionChannel {
  return channel !== 'physics'
}
