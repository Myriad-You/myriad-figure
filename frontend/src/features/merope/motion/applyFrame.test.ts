import type { PerformanceDirective } from '../../../services/agent/types'
import type { MotionFrame } from './intents'
import assert from 'node:assert/strict'
import test from 'node:test'
import { applyMotionFrame, createMotionApplyState } from './applyFrame'
import { RigMotionCoordinator } from './coordinator'

function recordingRig() {
  const calls: string[] = []
  return {
    calls,
    rig: {
      setMotionPolicy: (policy: { mouth: string }) =>
        calls.push(`policy:${policy.mouth}`),
      setSpeechActive: (value: boolean) => calls.push(`speechActive:${value}`),
      setAutoSpeech: (value: boolean) => calls.push(`auto:${value}`),
      setSpeechEnergy: (value: number | null) =>
        calls.push(`energy:${value}`),
      setSpeechArticulation: (value: { viseme: string }) =>
        calls.push(`articulation:${value.viseme}`),
      enqueueSpeechText: (text: string) => calls.push(`text:${text}`),
      playMotionPlan: () => {
        calls.push('play')
        return true
      },
      stopMotionPlan: () => calls.push('stop'),
      setSinging: (value: boolean) => calls.push(`singing:${value}`),
      setSingingSpectrum: (value: unknown) =>
        calls.push(`spectrum:${value !== null}`),
    },
  }
}

function frame(
  coordinator: RigMotionCoordinator,
  nowMs: number,
  extra: Partial<MotionFrame> = {},
): MotionFrame {
  return {
    snapshot: coordinator.snapshot(nowMs),
    speech: null,
    performance: null,
    music: null,
    mood: null,
    autonomy: null,
    ...extra,
  }
}

const directive: PerformanceDirective = {
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
  },
}

test('speech intent writes the mouth only while speech owns it', () => {
  const coordinator = new RigMotionCoordinator()
  coordinator.claim('speech', ['mouth'], { nowMs: 1 })
  const host = recordingRig()
  const state = createMotionApplyState()
  applyMotionFrame(
    host.rig,
    frame(coordinator, 1, {
      speech: {
        active: true,
        autoSpeech: true,
        energy: null,
        articulation: null,
        queuedText: [{ seq: 1, text: '你好' }],
      },
    }),
    state,
  )
  assert.ok(host.calls.includes('speechActive:true'))
  assert.ok(host.calls.includes('auto:true'))
  assert.ok(host.calls.includes('text:你好'))
})

test('the same performance plan is not replayed on later frames', () => {
  const coordinator = new RigMotionCoordinator()
  coordinator.claim('performance', ['expression'], { nowMs: 1 })
  const host = recordingRig()
  const state = createMotionApplyState()
  const performance = { directive, startedAtMs: 10 }
  applyMotionFrame(
    host.rig,
    frame(coordinator, 1, { performance }),
    state,
  )
  applyMotionFrame(
    host.rig,
    frame(coordinator, 2, { performance }),
    state,
  )
  assert.equal(host.calls.filter((call) => call === 'play').length, 1)
})

test('clearing the performance intent stops the plan once', () => {
  const coordinator = new RigMotionCoordinator()
  const host = recordingRig()
  const state = createMotionApplyState()
  applyMotionFrame(
    host.rig,
    frame(coordinator, 1, { performance: { directive, startedAtMs: 10 } }),
    state,
  )
  applyMotionFrame(
    host.rig,
    frame(coordinator, 2, { performance: { directive: null, startedAtMs: 0 } }),
    state,
  )
  applyMotionFrame(
    host.rig,
    frame(coordinator, 3, { performance: { directive: null, startedAtMs: 0 } }),
    state,
  )
  assert.equal(host.calls.filter((call) => call === 'stop').length, 1)
})

test('autonomy plays only while it owns expression or gaze', () => {
  const coordinator = new RigMotionCoordinator()
  const handle = coordinator.claim('autonomy', ['expression', 'gaze'], {
    nowMs: 1,
  })
  const host = recordingRig()
  const state = createMotionApplyState()
  const autonomy = { directive, startedAtMs: 20 }
  applyMotionFrame(host.rig, frame(coordinator, 1, { autonomy }), state)
  applyMotionFrame(host.rig, frame(coordinator, 2, { autonomy }), state)
  assert.equal(host.calls.filter((call) => call === 'play').length, 1)

  coordinator.release(handle)
  applyMotionFrame(host.rig, frame(coordinator, 3, { autonomy }), state)
  assert.equal(host.calls.filter((call) => call === 'stop').length, 1)
})

test('a live performance plan takes the rig from an autonomy pulse', () => {
  const coordinator = new RigMotionCoordinator()
  coordinator.claim('autonomy', ['expression', 'gaze'], { nowMs: 1 })
  const host = recordingRig()
  const state = createMotionApplyState()
  applyMotionFrame(
    host.rig,
    frame(coordinator, 1, { autonomy: { directive, startedAtMs: 20 } }),
    state,
  )
  applyMotionFrame(
    host.rig,
    frame(coordinator, 2, {
      performance: { directive, startedAtMs: 30 },
      autonomy: { directive, startedAtMs: 20 },
    }),
    state,
  )
  assert.equal(host.calls.filter((call) => call === 'stop').length, 1)
  assert.equal(host.calls.filter((call) => call === 'play').length, 2)
})
