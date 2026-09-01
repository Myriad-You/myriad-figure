const MAX_TEXT_UNITS = 2_000
const MAX_VISUAL_SPEECH_MS = 12_000
const MIN_VISUAL_SPEECH_MS = 650

export const VISUAL_SPEECH_WORD_GAP_SECONDS = 0.05
export const VISUAL_SPEECH_MINOR_PAUSE_SECONDS = 0.18
export const VISUAL_SPEECH_MAJOR_PAUSE_SECONDS = 0.32
export const VISUAL_SPEECH_HESITATION_SECONDS = 0.24

const CJK_UNIT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const LATIN_OR_NUMBER_RUN = /[\p{Script=Latin}\p{Number}]+/gu

/**
 * Shared phrasing for visual-only speech. Text visemes and the lifecycle tail
 * must agree about silence, otherwise the mouth either races the sentence or
 * gets cut off before its final pause.
 */
export function visualSpeechPauseSeconds(symbol: string): number | null {
  if (/[\r\n]/u.test(symbol)) return VISUAL_SPEECH_MAJOR_PAUSE_SECONDS
  if (/\s/u.test(symbol)) return VISUAL_SPEECH_WORD_GAP_SECONDS
  if (/[。.!！？?]/u.test(symbol)) return VISUAL_SPEECH_MAJOR_PAUSE_SECONDS
  if (/[，、,;；:：]/u.test(symbol)) return VISUAL_SPEECH_MINOR_PAUSE_SECONDS
  if (/[…—–-]/u.test(symbol)) return VISUAL_SPEECH_HESITATION_SECONDS
  return null
}

export function isMajorVisualSpeechPause(durationSeconds: number): boolean {
  return durationSeconds >= VISUAL_SPEECH_MAJOR_PAUSE_SECONDS - 0.001
}

/**
 * Body expression stays present between words, softens at commas, and rests
 * completely at a sentence boundary.
 */
export function visualSpeechPauseActivity(durationSeconds: number): number {
  if (isMajorVisualSpeechPause(durationSeconds)) return 0
  if (durationSeconds >= VISUAL_SPEECH_HESITATION_SECONDS - 0.001) return 0.08
  if (durationSeconds >= VISUAL_SPEECH_MINOR_PAUSE_SECONDS - 0.001) return 0.18
  return 0.58
}

/**
 * Synchronous duration estimate for speech without audio. It follows the same
 * pause vocabulary as the viseme compiler and intentionally models a calm
 * conversational cadence rather than token arrival speed.
 */
export function estimateVisualSpeechDurationMs(
  text: string,
  locale?: string,
): number {
  const bounded = text.normalize('NFKC').slice(0, MAX_TEXT_UNITS)
  const language = locale?.toLowerCase() || ''
  let seconds = 0.22
  let cursor = 0

  for (const match of bounded.matchAll(LATIN_OR_NUMBER_RUN)) {
    const index = match.index ?? 0
    seconds += estimateSymbols(bounded.slice(cursor, index), language)
    const token = match[0]
    if (/^\p{Number}+$/u.test(token)) {
      seconds += Math.min(0.9, Math.max(0.16, token.length * 0.15))
    } else {
      seconds += Math.min(0.78, Math.max(0.23, 0.17 + token.length * 0.052))
    }
    cursor = index + token.length
  }
  seconds += estimateSymbols(bounded.slice(cursor), language)
  return Math.round(
    // Runtime text-only rhythm is intentionally non-deterministic. Keep the
    // lifecycle alive through its slower natural variants instead of cutting
    // the final mouth cue at the nominal mean.
    clamp(seconds * 1_160, MIN_VISUAL_SPEECH_MS, MAX_VISUAL_SPEECH_MS),
  )
}

function estimateSymbols(text: string, language: string): number {
  let seconds = 0
  for (const symbol of text) {
    const pause = visualSpeechPauseSeconds(symbol)
    if (pause !== null) {
      seconds += pause
    } else if (CJK_UNIT.test(symbol)) {
      if (
        language.startsWith('ja') ||
        /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(symbol)
      ) {
        seconds += 0.135
      } else if (
        language.startsWith('ko') ||
        /\p{Script=Hangul}/u.test(symbol)
      ) {
        seconds += 0.165
      } else {
        seconds += 0.195
      }
    }
  }
  return seconds
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
