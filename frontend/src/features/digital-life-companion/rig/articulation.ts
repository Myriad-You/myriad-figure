export type SpeechViseme =
  | 'rest'
  | 'closed'
  | 'open'
  | 'wide'
  | 'round'
  | 'narrow'

export interface VisemeCue {
  atMs: number
  durationMs: number
  viseme: SpeechViseme
}

export interface SpeechArticulation {
  energy: number | null
  viseme: SpeechViseme
  amount: number
}

const PUNCTUATION = /[\s.,!?;:，。！？；：、…—\-]/u
const CLOSED = /[bmp唇ぱばまみむめもパバマミムメモ]/iu
const WIDE = /[eiyjxえいエイ]/iu
const ROUND = /[ouqwうおウオ]/iu
const NARROW = /[fvsztdnlrしちつすせそシチツスセソ]/iu

export function visemeForUnit(unit: string): SpeechViseme {
  if (!unit || PUNCTUATION.test(unit)) return 'rest'
  if (CLOSED.test(unit)) return 'closed'
  if (WIDE.test(unit)) return 'wide'
  if (ROUND.test(unit)) return 'round'
  if (NARROW.test(unit)) return 'narrow'
  if (/\p{Script=Han}/u.test(unit)) {
    const choices: SpeechViseme[] = ['open', 'wide', 'round', 'narrow']
    return choices[(unit.codePointAt(0) || 0) % choices.length]
  }
  return 'open'
}

export function planVisemes(text: string, durationMs: number): VisemeCue[] {
  const units = Array.from(text.trim())
  if (units.length === 0 || durationMs <= 0) return []
  const weights = units.map((unit) => (PUNCTUATION.test(unit) ? 1.8 : 1))
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  let cursor = 0
  const cues: VisemeCue[] = []
  for (let index = 0; index < units.length; index += 1) {
    const duration = Math.max(36, (durationMs * weights[index]) / totalWeight)
    const viseme = visemeForUnit(units[index])
    const previous = cues[cues.length - 1]
    if (previous?.viseme === viseme) {
      previous.durationMs += duration
    } else {
      cues.push({ atMs: cursor, durationMs: duration, viseme })
    }
    cursor += duration
  }
  return cues
}

export function visemeAt(
  cues: readonly VisemeCue[],
  elapsedMs: number,
): SpeechViseme {
  if (elapsedMs < 0) return 'rest'
  const cue = cues.find(
    (candidate) =>
      elapsedMs >= candidate.atMs &&
      elapsedMs < candidate.atMs + candidate.durationMs,
  )
  return cue?.viseme || 'rest'
}

export function estimateSpeechDurationMs(text: string): number {
  const cjk = Array.from(text).filter((unit) => /\p{Script=Han}/u.test(unit)).length
  const words = text.trim().split(/\s+/u).filter(Boolean).length
  const punctuation = Array.from(text).filter((unit) => PUNCTUATION.test(unit)).length
  return Math.max(500, cjk * 190 + words * 330 + punctuation * 45)
}

export function visemeAmount(viseme: SpeechViseme, energy: number): number {
  if (viseme === 'rest') return 0
  if (viseme === 'closed') return Math.max(0.12, energy * 0.3)
  return Math.max(0.28, Math.min(1, 0.34 + energy * 0.78))
}
