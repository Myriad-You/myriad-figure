import type { SpeechProsodyPlan } from '../speech/prosody'
import type { BehaviorPlan, ScheduledBehavior, TimePeg } from './behavior'

/** Future co-speech accents share the same lifecycle as other behaviors. */
export function compileSpeechBehaviorPlan(
  plan: SpeechProsodyPlan,
): BehaviorPlan {
  const planId = `speech:${plan.utteranceId}`
  const pegs: TimePeg[] = []
  const behaviors: ScheduledBehavior[] = []
  plan.accents.forEach((accent, index) => {
    const prefix = `${planId}:accent-${index}`
    const strokeAt = plan.startedAtMs + accent.offsetMs
    pegs.push(
      peg(`${prefix}:start`, strokeAt - 65),
      peg(`${prefix}:stroke`, strokeAt),
      peg(`${prefix}:hold`, strokeAt + 40),
      peg(`${prefix}:relax`, strokeAt + 140),
      peg(`${prefix}:end`, strokeAt + 260),
    )
    behaviors.push({
      id: prefix,
      function: 'emphasize',
      kind: 'oneShot',
      source: 'coSpeech',
      resources: ['face.expression', 'body.head', 'body.torso'],
      channels: ['expression', 'headBody'],
      timing: {
        start: `${prefix}:start`,
        stroke: `${prefix}:stroke`,
        hold: `${prefix}:hold`,
        relax: `${prefix}:relax`,
        end: `${prefix}:end`,
      },
      form: { family: 'co-speech', id: 'accent' },
      intensity: accent.intensity,
    })
  })
  return { id: planId, originMs: plan.startedAtMs, pegs, behaviors }
}

function peg(id: string, atMs: number): TimePeg {
  return { id, atMs: Math.max(0, atMs), revision: 0 }
}
