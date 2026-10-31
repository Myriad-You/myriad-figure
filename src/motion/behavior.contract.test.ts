import type { RigMotionPort } from '../rig/motionPort'
import type { ScheduledBehavior } from './behavior'
import type { MotionFrame } from './intents'
import assert from 'node:assert/strict'
import test from 'node:test'
import { PERFORMANCE_CUE_INTENTS } from '../events/performanceContract'
import { MUSIC_MODES } from '../singing/musicSignal'
import { musicSignalAt } from '../singing/musicSignal.test-support'
import { applyMotionFrame, createMotionApplyState } from './applyFrame'
import { applySingingWrite } from './applySnapshot'
import { MOTION_CHANNELS } from './channels'
import { RigMotionCoordinator } from './coordinator'
import { compileMusicBehaviorPlan } from './musicBehaviorPlan'
import { compilePerformanceBehaviorPlan } from './performanceBehaviorPlan'
import { BEHAVIOR_FUNCTIONS, BEHAVIOR_SOURCES, captureRigStateSummary } from './rigStateSummary'
import { MotionRuntime } from './runtime'
import { resolveSingingApply } from './singingApply'
import { compileSpeechBehaviorPlan } from './speechBehaviorPlan'

function recordingRig() {
  const calls: string[] = []
  return {
    calls,
    rig: {
      setMotionPolicy: (policy: { mouth: string; expression: string }) =>
        calls.push(`policy:${policy.mouth}:${policy.expression}`),
      setMood: () => undefined,
      setBearing: () => undefined,
      setSpeechActive: (value: boolean) => calls.push(`speechActive:${value}`),
      setAutoSpeech: (value: boolean) => calls.push(`auto:${value}`),
      setSpeechEnergy: () => undefined,
      setSpeechArticulation: () => undefined,
      setSpeechProsody: () => undefined,
      enqueueSpeechText: (text: string) => calls.push(`text:${text}`),
      playBehaviorPlan: (plan: { behaviors: readonly { id: string }[] }) => {
        calls.push('play')
        return plan.behaviors.map((behavior) => ({
          behaviorId: behavior.id,
          result: 'accepted' as const,
          atMs: 0,
        }))
      },
      stopBehaviorPlan: () => calls.push('stop'),
      setSinging: (value: boolean) => calls.push(`singing:${value}`),
      setSingingTrack: () => undefined,
      setMusicSignal: () => undefined,
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
    bearing: null,
    speech: null,
    performance: null,
    music: null,
    mood: null,
    behaviorPlan: null,
    behaviorRevision: 0,
    behaviors: [],
    ...extra,
  }
}

test('Chat speech occupies only the mouth; music keeps head and body', () => {
  const coordinator = new RigMotionCoordinator()
  coordinator.claim('music', ['mouth', 'headBody'], { nowMs: 0 })
  coordinator.claim('speech', ['mouth'], { nowMs: 1 })
  const snapshot = coordinator.snapshot(1)
  assert.equal(snapshot.owners.mouth, 'speech')
  assert.equal(snapshot.owners.headBody, 'music')

  const apply = resolveSingingApply({
    gap: 'active',
    holdExpired: false,
    audioPaused: false,
    mouthOwner: snapshot.owners.mouth,
    headBodyOwner: snapshot.owners.headBody,
  })
  assert.equal(apply.writeMouth, false)
  assert.equal(apply.writeGroove, true)
  assert.equal(apply.release, false)

  const writes: string[] = []
  applySingingWrite(
    {
      setSingingTrack: (value) => writes.push(`track:${value}`),
      setSinging: (value) => writes.push(`singing:${value}`),
      setMusicSignal: (value) => writes.push(`signal:${value !== null}`),
      setSpeechArticulation: () => writes.push('articulation'),
      setSpeechActive: () => writes.push('speechActive'),
    },
    apply,
    {
      trackId: 'song-a',
      signal: musicSignalAt(1),
      articulation: { energy: 0.6, viseme: 'open', amount: 0.8 },
    },
  )
  assert.deepEqual(writes, ['track:song-a', 'singing:true', 'signal:true'])
})

test('applyFrame writes speech text only while speech owns the mouth', () => {
  const coordinator = new RigMotionCoordinator()
  coordinator.claim('music', ['mouth', 'headBody'], { nowMs: 0 })
  coordinator.claim('speech', ['mouth'], { nowMs: 1 })
  const host = recordingRig()
  applyMotionFrame(
    host.rig,
    frame(coordinator, 1, {
      speech: {
        active: true,
        autoSpeech: true,
        energy: null,
        articulation: null,
        prosody: null,
        behaviorPlan: null,
        behaviors: [],
        queuedText: [{ seq: 1, text: '你好' }],
      },
    }),
    createMotionApplyState(),
  )
  assert.ok(host.calls.includes('policy:speech:idle'))
  assert.ok(host.calls.includes('text:你好'))
})

test('a frame reaches the rig only through the renderer-neutral port', () => {
  // Whatever the frame holds, applyFrame may call only the port's own methods:
  // no driver writes, debug snapshots or renderer-specific calls.
  const called = new Set<string>()
  const port = new Proxy({}, {
    get: (_target, name) => {
      called.add(String(name))
      return name === 'playBehaviorPlan' ? () => [] : () => undefined
    },
  }) as RigMotionPort
  const runtime = new MotionRuntime(new RigMotionCoordinator())
  const release = runtime.retain()
  try {
    runtime.mood.set(40, 'thinking', 70)
    runtime.performance.handleForTest({
      phase: 'delivery', moodRevision: 1, motionStyle: 'even',
      plan: { cues: [{ intent: 'question', atMs: 0, intensity: 1, tempo: 1, fadeInMs: 80, fadeOutMs: 200, interrupt: 'replace' }] },
    })
    applyMotionFrame(port, runtime.frame(), createMotionApplyState())
  } finally {
    release()
  }
  const allowed: ReadonlySet<string> = new Set(Object.keys(PORT_METHODS))
  assert.deepEqual([...called].filter(name => !allowed.has(name)), [])
  assert.ok(called.has('setMotionPolicy'))
})

// Every method of RigMotionPort, so the check above names the whole port.
const PORT_METHODS: Record<keyof RigMotionPort, true> = {
  setMotionPolicy: true, setBearing: true, setScore: true, setMood: true,
  setSpeechActive: true, setAutoSpeech: true, setSpeechEnergy: true, setSpeechArticulation: true,
  setSpeechProsody: true, enqueueSpeechText: true, setSinging: true, setSingingTrack: true,
  setMusicSignal: true, playBehaviorPlan: true, stopBehaviorPlan: true,
}

test('dead motion channels stay removed', () => {
  assert.ok(!(MOTION_CHANNELS as readonly string[]).includes('physics'))
})

test('agent turns get a semantic rig summary, not per-frame drivers', () => {
  const runtime = new MotionRuntime(new RigMotionCoordinator())
  runtime.mood.set(40, 'thinking', 70)
  const summary = JSON.stringify(captureRigStateSummary(runtime))
  for (const driver of ['mouthOpen', 'angleX', 'angleY', 'eyeOpenL', 'bodyLift']) {
    assert.ok(!summary.includes(`"${driver}"`), driver)
  }
})

test('idle self-motion never shows up as a semantic behavior', () => {
  // Drift, small idle moves and breathing run on the figure's own clock: an
  // undirected runtime schedules nothing and reports nothing to the director.
  const runtime = new MotionRuntime(new RigMotionCoordinator())
  const release = runtime.retain()
  try {
    runtime.mood.set(70, 'idle', 48)
    const frame = runtime.frame()
    assert.ok(!('autonomy' in frame))
    assert.deepEqual(frame.behaviors, [])
    assert.deepEqual(captureRigStateSummary(runtime).activeBehaviors, [])
  } finally {
    release()
  }
})

// The same lists against the director's: Myriad's frontend/src/features/merope/figureCore.test.ts.
test('the behavior vocabulary is exactly what a producer can emit', () => {
  const functions = new Set<string>()
  const sources = new Set<string>()
  const record = (plan: { behaviors: readonly ScheduledBehavior[] }): void => {
    for (const behavior of plan.behaviors) {
      functions.add(behavior.function)
      sources.add(behavior.source)
    }
  }
  for (const intent of PERFORMANCE_CUE_INTENTS) {
    record(
      compilePerformanceBehaviorPlan(
        {
          phase: 'delivery',
          moodRevision: 1,
          motionStyle: 'even',
          plan: {
            cues: [
              {
                intent,
                atMs: 0,
                intensity: 1,
                tempo: 1,
                fadeInMs: 120,
                fadeOutMs: 200,
                interrupt: 'replace',
              },
            ],
          },
        },
        0,
        'performance',
      ),
    )
  }
  record(
    compileSpeechBehaviorPlan({
      utteranceId: 'utt-1',
      startedAtMs: 0,
      durationMs: 800,
      accents: [{ offsetMs: 300, intensity: 0.8 }],
    }),
  )
  for (const mode of MUSIC_MODES) record(compileMusicBehaviorPlan(1, 0, mode))

  assert.deepEqual(
    Iterator.from(functions).toArray().toSorted(),
    BEHAVIOR_FUNCTIONS.toSorted(),
  )
  assert.deepEqual(
    Iterator.from(sources).toArray().toSorted(),
    BEHAVIOR_SOURCES.toSorted(),
  )
})
