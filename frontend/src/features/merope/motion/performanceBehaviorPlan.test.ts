import type {
  PerformanceCue,
  PerformanceDirective,
} from '../../../services/agent/types'
import assert from 'node:assert/strict'
import test from 'node:test'
import { compilePerformanceBehaviorPlan } from './performanceBehaviorPlan'

function directive(): PerformanceDirective {
  return {
    phase: 'delivery',
    moodRevision: 1,
    motionStyle: 'even',
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

test('declares head and torso resources for a readable acknowledgement', () => {
  const value = directive()
  value.plan.baseline = undefined
  value.plan.cues[0] = { ...value.plan.cues[0]!, intent: 'respond' }
  const plan = compilePerformanceBehaviorPlan(value, 0, 'plan-b')
  const cue = plan.behaviors.find((behavior) => behavior.form.id === 'respond')
  assert.deepEqual(cue?.channels, ['expression', 'headBody'])
  assert.deepEqual(cue?.resources, [
    'face.expression',
    'body.head',
    'body.torso',
  ])
})

test('recompiling a realized cue does not shrink it', () => {
  const cue: PerformanceCue = {
    intent: 'greet',
    atMs: 0,
    intensity: 1,
    tempo: 1,
    fadeInMs: 160,
    fadeOutMs: 240,
    interrupt: 'replace',
  }
  const directive: PerformanceDirective = {
    phase: 'delivery',
    moodRevision: 1,
    motionStyle: 'even',
    plan: { cues: [cue] },
  }
  const first = compilePerformanceBehaviorPlan(directive, 0, 'plan-1')
  const holdMs = Math.round(
    pegAt(first, 'plan-1:cue-0:relax') - pegAt(first, 'plan-1:cue-0:stroke-end'),
  )
  // Feed the realized hold straight back in: peg spacing must not move.
  const second = compilePerformanceBehaviorPlan(
    { ...directive, plan: { cues: [{ ...cue, holdMs }] } },
    0,
    'plan-2',
  )
  assert.equal(
    pegAt(second, 'plan-2:cue-0:end'),
    pegAt(first, 'plan-1:cue-0:end'),
  )
})

function pegAt(plan: ReturnType<typeof compilePerformanceBehaviorPlan>, id: string): number {
  const found = plan.pegs.find((peg) => peg.id === id)
  assert.ok(found, `${id} missing`)
  return found.atMs
}
