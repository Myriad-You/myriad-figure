import assert from 'node:assert/strict'
import test from 'node:test'
import { RigMotionCoordinator } from './coordinator'
import { SpeechMotionSource } from './speechSource'

test('text increments reach the source without renaming earlier beats, and cancel clears them', () => {
  const source = new SpeechMotionSource(new RigMotionCoordinator(), () => {})
  source.start()
  try {
    const base = {
      messageId: 'message',
      utteranceId: 'stream',
      source: 'reply' as const,
    }
    source.handleForTest({ ...base, phase: 'start' })
    source.handleForTest({
      ...base,
      phase: 'chunk',
      text: '其实我们可以试试。',
    })
    const first = source.current().prosody!
    assert.ok(first.accents.length > 0)
    source.handleForTest({
      ...base,
      phase: 'chunk',
      text: '不过后面的结果呢？',
    })
    const later = source.current().prosody!
    assert.ok(later.accents.length > first.accents.length)
    assert.deepEqual(
      later.accents.slice(0, first.accents.length),
      first.accents,
    )
    source.handleForTest({ ...base, phase: 'end' })
    assert.deepEqual(source.current().prosody!.accents, later.accents)
    source.handleForTest({ ...base, phase: 'cancel' })
    assert.equal(source.current().behaviorPlan, null)
    assert.equal(source.current().prosody, null)
    source.handleForTest({ ...base, utteranceId: 'next', phase: 'start' })
    assert.deepEqual(source.current().prosody!.accents, [])
  } finally {
    source.stop()
  }
})
