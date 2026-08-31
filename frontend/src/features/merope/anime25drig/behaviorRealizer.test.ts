import type { BehaviorPlan } from '../motion/behavior'
import type { PerformanceDirective } from '../../../services/agent/types'
import assert from 'node:assert/strict'
import test from 'node:test'
import { compilePerformanceBehaviorPlan } from '../motion/performanceBehaviorPlan'
import { realizeAnime25DBehaviorPlan } from './behaviorRealizer'

const directive: PerformanceDirective = {
  phase: 'delivery',
  moodRevision: 2,
  plan: {
    cues: [
      {
        intent: 'emphasize',
        atMs: 200,
        intensity: 1.1,
        tempo: 1.2,
        fadeInMs: 100,
        fadeOutMs: 180,
        interrupt: 'queue',
      },
    ],
  },
}

test('Anime2.5D realizes a behavior form without restoring a legacy directive', () => {
  const plan = compilePerformanceBehaviorPlan(directive, 1_000, 'plan-a')
  const realized = realizeAnime25DBehaviorPlan(plan, 900)
  assert.equal(realized.cues.length, 1)
  assert.equal(realized.cues[0]?.intent, 'emphasize')
  assert.equal(realized.cues[0]?.atMs, 200)
  assert.equal(realized.cues[0]?.interrupt, 'replace')
  assert.deepEqual(realized.reports, [
    {
      behaviorId: 'plan-a:cue-0',
      result: 'accepted',
      atMs: 900,
    },
  ])
})

test('unsupported forms are rejected per behavior while supported peers survive', () => {
  const supported = compilePerformanceBehaviorPlan(directive, 0, 'plan-b')
  const plan: BehaviorPlan = {
    ...supported,
    behaviors: [
      ...supported.behaviors,
      {
        ...supported.behaviors[0]!,
        id: 'plan-b:unsupported',
        form: { family: 'future-locomotion', id: 'step-left' },
      },
    ],
  }
  const realized = realizeAnime25DBehaviorPlan(plan, 10)
  assert.equal(realized.cues.length, 1)
  assert.equal(realized.reports[1]?.behaviorId, 'plan-b:unsupported')
  assert.equal(realized.reports[1]?.result, 'rejected')
  assert.equal(realized.reports[1]?.reason, 'unsupported-form')
})
