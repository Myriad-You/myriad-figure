import assert from 'node:assert/strict'
import test from 'node:test'
import {
  baselineDriverPatch,
  cueDriverPatch,
  cueDurationMs,
  cueRemainingDurationMs,
  idleSpeechDriverPatch,
  performanceRestDriverPatch,
  scheduleBodyCues,
  scheduledBodyCueRemainingDurationMs,
} from './performanceMotion'

test('keeps semantic face ownership out of the non-manual posture patch', () => {
  const patch = baselineDriverPatch({
    expression: 'warm',
    posture: 'open',
    motionEnergy: 1.4,
    attention: 0.8,
  })
  assert.equal(patch.mouthOpen, undefined)
  assert.equal(patch.talk, undefined)
  assert.equal(patch.mouthForm, undefined)
  assert.equal(patch.brow, undefined)
  assert.equal(patch.eyeOpenL, undefined)
  assert.ok((patch.armPos || 0) <= 0.2)
})

test('centers semantic hair energy on the runtime sway defaults', () => {
  const patch = baselineDriverPatch({
    expression: 'steady',
    posture: 'neutral',
    motionEnergy: 1,
    attention: 1,
  })
  assert.equal(patch.fhAmp, 1)
  assert.equal(patch.physAmp, 0.5)
})

test('restores performance pose without taking speech, face, or gaze ownership', () => {
  const patch = performanceRestDriverPatch(
    {
      expression: 'warm',
      posture: 'open',
      motionEnergy: 1,
      attention: 1,
    },
    false,
  )
  for (const key of [
    'talk',
    'mouthOpen',
    'mouthForm',
    'eyeOpenL',
    'eyeOpenR',
    'eyeX',
    'eyeY',
    'angleX',
    'angleY',
    'angleZ',
    'brow',
  ]) {
    assert.equal(key in patch, false)
  }
  assert.equal(patch.body, 0.12)
  assert.equal(performanceRestDriverPatch(null, true).body, 0)
  assert.equal(performanceRestDriverPatch(null, true).rand, false)
  assert.equal(performanceRestDriverPatch(null, true).thinking, true)
  assert.equal(performanceRestDriverPatch(null, true).idle, true)
  assert.equal(performanceRestDriverPatch(null, true).blink, true)
  assert.equal(performanceRestDriverPatch(null, true).phys, true)
  assert.equal(
    performanceRestDriverPatch(
      {
        expression: 'warm',
        posture: 'open',
        motionEnergy: 1,
        attention: 1,
      },
      true,
    ).rand,
    false,
  )
})

test('keeps active speech channels out of a full base refresh', () => {
  assert.deepEqual(idleSpeechDriverPatch(70, true), {})
  assert.deepEqual(idleSpeechDriverPatch(70, false), {
    talk: false,
    mouthOpen: 0,
    mouthForm: 0.07,
  })
})

test('maps cues to bounded deterministic patches and durations', () => {
  const cue = {
    intent: 'emphasize' as const,
    atMs: 0,
    intensity: 1.4,
    tempo: 1,
    fadeInMs: 150,
    fadeOutMs: 220,
    interrupt: 'replace' as const,
  }
  assert.ok((cueDriverPatch(cue).body || 0) < 0.35)
  assert.equal(cueDriverPatch(cue).brow, undefined)
  assert.equal(cueDriverPatch(cue).angleY, undefined)
  assert.equal(cueDurationMs(cue), 1_090)

  const dizzy = { ...cue, intent: 'dizzy' as const }
  assert.deepEqual(cueDriverPatch(dizzy), {})
  const think = { ...cue, intent: 'think' as const }
  assert.deepEqual(cueDriverPatch(think), {})
  const cry = { ...cue, intent: 'cry' as const }
  assert.deepEqual(cueDriverPatch(cry), {})
  const angry = { ...cue, intent: 'angry' as const }
  assert.ok((cueDriverPatch(angry).body || 0) > 0)
  const speechless = { ...cue, intent: 'speechless' as const }
  assert.equal(cueDriverPatch(speechless).idle, false)
  const maniac = { ...cue, intent: 'maniac' as const }
  assert.equal(cueDriverPatch(maniac).idle, false)
  const lovestruck = { ...cue, intent: 'lovestruck' as const }
  assert.equal(cueDriverPatch(lovestruck).idle, false)
})

test('does not replay expired body cues after a throttled timer', () => {
  const cue = {
    intent: 'emphasize' as const,
    atMs: 2_000,
    intensity: 1,
    tempo: 1,
    fadeInMs: 120,
    fadeOutMs: 250,
    interrupt: 'replace' as const,
  }
  const duration = cueDurationMs(cue)
  assert.equal(cueRemainingDurationMs(cue, 5_000, 4_900), duration)
  assert.equal(cueRemainingDurationMs(cue, 5_000, 5_300), duration - 300)
  assert.equal(cueRemainingDurationMs(cue, 5_000, 5_000 + duration), 0)
})

test('precomputes queued body timing independently of delayed callbacks', () => {
  const first = {
    intent: 'question' as const,
    atMs: 0,
    intensity: 1,
    tempo: 1,
    fadeInMs: 100,
    fadeOutMs: 200,
    interrupt: 'replace' as const,
  }
  const queued = {
    ...first,
    intent: 'notify' as const,
    interrupt: 'queue' as const,
  }
  const [scheduledFirst, scheduledQueued] = scheduleBodyCues(
    [first, queued],
    5_000,
  )
  assert.equal(scheduledFirst?.startMs, 5_000)
  assert.equal(scheduledQueued?.startMs, scheduledFirst?.endMs)
  assert.ok(
    cueRemainingDurationMs(
      queued,
      scheduledQueued?.startMs ?? 0,
      (scheduledFirst?.endMs ?? 0) + 100,
    ) > 0,
  )
})

test('queues after the surviving replacement rather than a truncated cue', () => {
  const long = {
    intent: 'respond' as const,
    atMs: 0,
    intensity: 1,
    tempo: 0.5,
    fadeInMs: 100,
    fadeOutMs: 200,
    interrupt: 'replace' as const,
  }
  const replacement = {
    ...long,
    intent: 'notify' as const,
    atMs: 200,
    tempo: 1,
  }
  const queued = {
    ...long,
    intent: 'question' as const,
    atMs: 300,
    tempo: 1,
    interrupt: 'queue' as const,
  }
  const [truncated, active, after] = scheduleBodyCues(
    [long, replacement, queued],
    1_000,
  )
  assert.equal(truncated?.endMs, active?.startMs)
  assert.equal(after?.startMs, active?.endMs)
  assert.equal(
    truncated ? scheduledBodyCueRemainingDurationMs(truncated, 1_250) : -1,
    0,
  )
})
