import type { PerformanceDirective } from '../../../services/agent/types'
import assert from 'node:assert/strict'
import test from 'node:test'
import { compilePerformanceBehaviorPlan } from './performanceBehaviorPlan'

function directive(): PerformanceDirective {
  return {
    phase: 'delivery',
    moodRevision: 1,
    plan: {
      baseline: {
        expression: 'warm',
        posture: 'open',
        motionEnergy: 0.8,
        attention: 0.9,
      },
      cues: [
        {
          intent: 'emphasize',
          atMs: 200,
          intensity: 1,
          tempo: 1,
          fadeInMs: 100,
          fadeOutMs: 160,
          interrupt: 'replace',
        },
      ],
    },
  }
}

test('compiles only transient functions and monotonic time pegs', () => {
  const plan = compilePerformanceBehaviorPlan(directive(), 1_000, 'plan-a')
  const cue = plan.behaviors.find(
    (behavior) => behavior.form.id === 'emphasize',
  )
  assert.equal(cue?.function, 'emphasize')
  assert.deepEqual(cue?.channels, ['expression', 'headBody'])
  assert.deepEqual(cue?.resources, [
    'face.expression',
    'body.head',
    'body.torso',
  ])
  assert.equal(plan.originMs, 1_000)
  assert.deepEqual(plan.metadata, { phase: 'delivery', moodRevision: 1 })
  assert.equal(
    plan.behaviors.some(
      (behavior) => behavior.form.family === 'performance-baseline',
    ),
    false,
  )
  const times = plan.pegs
    .filter((peg) => peg.id.startsWith('plan-a:cue-0'))
    .map((peg) => peg.atMs)
  assert.deepEqual(
    times,
    [...times].sort((left, right) => left - right),
  )
})

test('keeps a face-only cue off the head/body channel', () => {
  const value = directive()
  value.plan.baseline = undefined
  value.plan.cues[0] = { ...value.plan.cues[0]!, intent: 'respond' }
  const plan = compilePerformanceBehaviorPlan(value, 0, 'plan-b')
  const cue = plan.behaviors.find((behavior) => behavior.form.id === 'respond')
  assert.deepEqual(cue?.channels, ['expression'])
  assert.deepEqual(cue?.resources, ['face.expression'])
})
