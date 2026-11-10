import type { Anime25DArmAim } from './arm3dReach'

/**
 * A stage phrase for the arms, written against the beat: where each hand is on which beat and how long it takes
 * to get there, and what the body does meanwhile. Read each frame (`armScoreAt`) it gives each arm's aim and the
 * drivers to add, so a phrase plays the same at any frame rate and can be cut to music.
 */
export interface Anime25DArmScore {
  /** Beats a minute. */
  bpm: number
  arms: readonly Anime25DArmCue[]
  body?: readonly Anime25DBodyCue[]
}

export interface Anime25DArmCue {
  /** The beat the hand sets off on. */
  at: number
  side: 'L' | 'R' | 'both'
  /** A gesture drawn for the side (held as drawn), a place for the hand, or null: the arm let hang. */
  to: string | Anime25DArmAim | null
  /** Beats the move takes (1 unless given): short is sharp, long is slow. */
  over?: number
  /** How far the hand swings out toward the viewer on its way, against how far it goes (0.25 unless given). */
  arc?: number
}

export interface Anime25DBodyCue {
  at: number
  /** Beats it takes (1 unless given). */
  over?: number
  /** Drivers to be at (`body`, `torsoTurn`, …); one not named stays where it was. */
  drive: Readonly<Record<string, number>>
}

export interface Anime25DArmScoreFrame {
  /** Each scored side's aim now; null lets the arm hang; a side the score never moves is not given. */
  arms: Partial<Record<'L' | 'R', Anime25DArmAim | null>>
  drive: Record<string, number>
}

type Place = Required<Omit<Anime25DArmAim, 'hand'>> & { hand?: string }

/** An arm as good as hanging: where a move from hanging starts and one back to it ends. */
const HANGING: Place = { out: 0.05, up: -0.96, forward: 0.03, swivel: 0 }
const ARC = 0.25

/** Slow out, slow in, with no jolt at either end. */
function eased(f: number): number {
  const t = Math.min(1, Math.max(0, f))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

interface Move { from: Place; to: Place; at: number; over: number; arc: number; hangs: boolean }

function along(m: Move, beat: number): Place {
  const e = eased((beat - m.at) / m.over)
  const mix = (a: number, b: number) => a + (b - a) * e
  const far = Math.hypot(m.to.out - m.from.out, m.to.up - m.from.up, m.to.forward - m.from.forward)
  const hand = e < 0.5 ? m.from.hand ?? m.to.hand : m.to.hand ?? m.from.hand
  return {
    out: mix(m.from.out, m.to.out),
    up: mix(m.from.up, m.to.up),
    forward: mix(m.from.forward, m.to.forward) + m.arc * far * Math.sin(Math.PI * e) ** 2,
    swivel: mix(m.from.swivel, m.to.swivel),
    ...(hand === undefined ? {} : { hand }),
  }
}

/**
 * The score at `seconds` from its start. `gestureAim` gives the aim that holds a side's arm as a gesture is
 * drawn (the player's `armGestureAim`); a cue to a gesture the side was not drawn with is passed over.
 */
export function armScoreAt(score: Anime25DArmScore, seconds: number, gestureAim: (side: 'L' | 'R', gesture: string) => Anime25DArmAim | null): Anime25DArmScoreFrame {
  const beat = seconds * score.bpm / 60
  const arms: Anime25DArmScoreFrame['arms'] = {}
  for (const side of ['L', 'R'] as const) {
    const cues = score.arms.filter((c) => c.side === side || c.side === 'both').sort((a, b) => a.at - b.at)
    if (cues.length === 0) continue
    let move: Move | null = null
    for (const cue of cues) {
      if (cue.at > beat) break
      let to: Place
      if (cue.to === null) {
        to = HANGING
      }
      else if (typeof cue.to === 'string') {
        const aim = gestureAim(side, cue.to)
        if (!aim) continue
        to = { out: aim.out, up: aim.up, forward: aim.forward, swivel: aim.swivel ?? 0, hand: cue.to }
      }
      else {
        to = { out: cue.to.out, up: cue.to.up, forward: cue.to.forward, swivel: cue.to.swivel ?? 0, ...(cue.to.hand === undefined ? {} : { hand: cue.to.hand }) }
      }
      // Cut short, a move hands on from wherever it had got to.
      const from: Place = move ? along(move, cue.at) : HANGING
      move = { from, to, at: cue.at, over: Math.max(1e-3, cue.over ?? 1), arc: cue.arc ?? ARC, hangs: cue.to === null }
    }
    if (!move || (move.hangs && beat >= move.at + move.over)) arms[side] = null
    else arms[side] = along(move, beat)
  }
  const drive: Record<string, number> = {}
  const last: Record<string, { from: number; to: number; at: number; over: number }> = {}
  const now = (key: string, at: number) => {
    const m = last[key]
    return m ? m.from + (m.to - m.from) * eased((at - m.at) / m.over) : 0
  }
  for (const cue of [...(score.body ?? [])].sort((a, b) => a.at - b.at)) {
    if (cue.at > beat) break
    for (const [key, to] of Object.entries(cue.drive)) last[key] = { from: now(key, cue.at), to, at: cue.at, over: Math.max(1e-3, cue.over ?? 1) }
  }
  for (const key of Object.keys(last)) drive[key] = now(key, beat)
  return { arms, drive }
}
