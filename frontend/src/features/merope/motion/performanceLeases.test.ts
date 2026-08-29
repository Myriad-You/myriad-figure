import type { PerformanceDirective } from '../../../services/agent/types'
import assert from 'node:assert/strict'
import test from 'node:test'
import { cueDurationMs } from '../anime25drig/performanceMotion'
import { RigMotionCoordinator } from './coordinator'
import {
  performanceLeaseWindows,
  PerformanceMotionLeases,
} from './performanceLeases'

function cue(
  intent: PerformanceDirective['plan']['cues'][number]['intent'],
  atMs = 0,
): PerformanceDirective['plan']['cues'][number] {
  return {
    intent,
    atMs,
    intensity: 1,
    tempo: 1,
    fadeInMs: 80,
    fadeOutMs: 120,
    interrupt: 'replace',
  }
}

function directive(
  overrides: Partial<PerformanceDirective['plan']> = {},
): PerformanceDirective {
  return {
    phase: 'delivery',
    moodRevision: 1,
    plan: {
      baseline: {
        expression: 'warm',
        posture: 'neutral',
        motionEnergy: 1,
        attention: 1,
      },
      cues: [],
      ...overrides,
    },
  }
}

test('open posture without a body cue does not open a head/body window', () => {
  const windows = performanceLeaseWindows(
    directive({
      baseline: {
        expression: 'warm',
        posture: 'open',
        motionEnergy: 1,
        attention: 1,
      },
    }),
    0,
  )
  assert.equal(windows.headBodyCueUntilMs, null)
  assert.equal(windows.expressionCueUntilMs, null)
})

test('a greet cue times the head/body lease to its actual duration', () => {
  const greet = cue('greet')
  const windows = performanceLeaseWindows(directive({ cues: [greet] }), 0)
  assert.equal(windows.headBodyCueUntilMs, cueDurationMs(greet))
  assert.equal(windows.expressionCueUntilMs, cueDurationMs(greet))
})

test('think stays on expression and never takes the singing body', () => {
  const windows = performanceLeaseWindows(
    directive({ cues: [cue('think')] }),
    0,
  )
  assert.ok((windows.expressionCueUntilMs ?? 0) > 0)
  assert.equal(windows.headBodyCueUntilMs, null)
})

test('body cue lease expires and music groove resumes; baseline expression stays', () => {
  const coordinator = new RigMotionCoordinator()
  coordinator.claim('music', ['mouth', 'headBody'], { nowMs: 0 })
  const leases = new PerformanceMotionLeases(coordinator)
  const greet = cue('greet')
  leases.apply(directive({ cues: [greet] }), 0)
  assert.equal(coordinator.owner('headBody', 0), 'performance')
  assert.equal(coordinator.owner('expression', 0), 'performance')
  assert.equal(coordinator.owner('mouth', 0), 'music')
  const end = cueDurationMs(greet)
  coordinator.tick(end)
  assert.equal(coordinator.owner('headBody', end), 'music')
  assert.equal(coordinator.owner('expression', end), 'performance')
  leases.releaseAll()
  assert.equal(coordinator.owner('expression', end), 'idle')
})

test('cancel or unmount releases every performance lease, not someone else', () => {
  const coordinator = new RigMotionCoordinator()
  const panel = new PerformanceMotionLeases(coordinator)
  const home = new PerformanceMotionLeases(coordinator)
  panel.apply(directive({ cues: [cue('think')] }), 0)
  home.apply(directive({ cues: [cue('greet')] }), 0)
  assert.equal(coordinator.owner('expression', 0), 'performance')
  assert.equal(coordinator.owner('headBody', 0), 'performance')
  home.releaseAll()
  assert.equal(coordinator.owner('expression', 0), 'performance')
  assert.equal(coordinator.owner('headBody', 0), 'idle')
  panel.releaseAll()
  assert.equal(coordinator.owner('expression', 0), 'idle')
})
