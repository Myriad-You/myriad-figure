// The words of core's performance contract that the directing page writes and
// the figure reads. Types are derived from these lists, and
// vocabulary.contract.test.ts holds each list to the contract word for word.

export const BASELINE_EXPRESSIONS = ['withdrawn', 'subdued', 'steady', 'warm', 'tense'] as const
export const POSTURES = ['closed', 'neutral', 'open'] as const
export const CUE_INTENTS = [
  'greet',
  'respond',
  'question',
  'delight',
  'emphasize',
  'listen',
  'notify',
  'think',
  'dizzy',
  'cry',
  'angry',
  'speechless',
  'maniac',
  'silly',
  'lovestruck',
] as const
export const INTERRUPT_MODES = ['replace', 'queue', 'if-lower'] as const
export const PHRASE_INTENTS = ['ask', 'hesitate', 'tease', 'explain', 'check-in', 'laugh', 'none'] as const
export const SCORE_SIDES = ['left', 'right', 'both'] as const
export const SCORE_DIRECTIONS = ['left', 'right', 'up', 'down', 'up-left', 'up-right', 'down-left', 'down-right'] as const

export function isWord<T extends string>(words: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (words as readonly string[]).includes(value)
}
