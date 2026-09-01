import assert from 'node:assert/strict'
import test from 'node:test'
import { RigMotionCoordinator } from './coordinator'
import { setLiveMotionGeneration } from './liveGeneration'
import { SpeechMotionSource } from './speechSource'

test('text-only speech sends one predicted prosody to scheduler and rig', () => {
  const source = new SpeechMotionSource(new RigMotionCoordinator(), () => {})
  source.start()
  source.handleForTest({
    phase: 'start',
    messageId: 'message-a',
    utteranceId: 'utterance-a',
    source: 'reply',
  })
  source.handleForTest({
    phase: 'chunk',
    messageId: 'message-a',
    utteranceId: 'utterance-a',
    source: 'reply',
    text: '不过这个部分很重要，所以需要自然一点。',
  })
  const intent = source.current()
  assert.equal(intent.prosody?.utteranceId, 'utterance-a')
  assert.ok((intent.prosody?.accents.length ?? 0) > 0)
  assert.equal(intent.behaviorPlan?.id, 'speech:utterance-a')
  assert.deepEqual(
    intent.behaviorPlan?.behaviors
      .filter((behavior) => behavior.form.id === 'accent')
      .map((behavior) => behavior.timing.strokePeak),
    intent.prosody?.accents.map(
      (_, index) => `speech:utterance-a:accent-${index}:stroke-peak`,
    ),
  )
  source.stop()
})

test('a replacement utterance keeps its new predicted plan', () => {
  const source = new SpeechMotionSource(new RigMotionCoordinator(), () => {})
  source.start()
  source.handleForTest({
    phase: 'start',
    messageId: 'message-a',
    utteranceId: 'utterance-a',
    source: 'reply',
  })
  source.handleForTest({
    phase: 'start',
    messageId: 'message-b',
    utteranceId: 'utterance-b',
    source: 'reply',
  })
  assert.equal(source.current().prosody?.utteranceId, 'utterance-b')
  assert.equal(source.current().behaviorPlan?.id, 'speech:utterance-b')
  source.stop()
})

test('stale generations cannot publish a body behavior', () => {
  setLiveMotionGeneration(8)
  try {
    const source = new SpeechMotionSource(new RigMotionCoordinator(), () => {})
    source.start()
    source.handleForTest({
      phase: 'start',
      messageId: 'stale',
      utteranceId: 'stale',
      source: 'reply',
      generation: 7,
    })
    assert.equal(source.current().active, false)
    assert.equal(source.current().behaviorPlan, null)
    source.stop()
  } finally {
    setLiveMotionGeneration(0)
  }
})

test('losing real prosody mid-utterance falls back to the predicted plan', () => {
  const source = new SpeechMotionSource(new RigMotionCoordinator(), () => {})
  source.start()
  source.handleForTest({
    phase: 'start',
    messageId: 'message-c',
    utteranceId: 'utterance-c',
    source: 'reply',
  })
  source.handleForTest({
    phase: 'chunk',
    messageId: 'message-c',
    utteranceId: 'utterance-c',
    source: 'reply',
    text: '这句话得有重音，不然身体就不动了。',
  })
  assert.ok(source.current().behaviorPlan)
  // TTS drops out and clears prosody: the utterance must not lose its body.
  source.handleForTest({
    phase: 'prosody',
    messageId: 'message-c',
    utteranceId: 'utterance-c',
    source: 'reply',
    prosody: null,
  })
  const intent = source.current()
  assert.equal(intent.behaviorPlan?.id, 'speech:utterance-c')
  assert.ok(
    intent.behaviorPlan?.behaviors.some(
      (behavior) => behavior.form.id === 'presence',
    ),
  )
  source.stop()
})
