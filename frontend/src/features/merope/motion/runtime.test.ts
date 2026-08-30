import assert from 'node:assert/strict'
import test from 'node:test'
import { RigMotionCoordinator } from './coordinator'
import { createPreviewMotionRuntime, MotionRuntime } from './runtime'

test('two consumers see the same speech intent; one unmount does not stop the source', () => {
  const runtime = new MotionRuntime(new RigMotionCoordinator())
  const releaseA = runtime.retain()
  const releaseB = runtime.retain()
  runtime.speech.start()
  runtime.speech.handleForTest({
    phase: 'start',
    messageId: 'message-1',
    utteranceId: 'stream-1',
    source: 'reply',
  })
  const frames: string[] = []
  const unsubA = runtime.subscribe((frame) => {
    frames.push(`a:${frame.snapshot.owners.mouth}`)
  })
  const unsubB = runtime.subscribe((frame) => {
    frames.push(`b:${frame.snapshot.owners.mouth}`)
  })
  assert.equal(runtime.frame().snapshot.owners.mouth, 'speech')
  assert.equal(runtime.frame().snapshot.owners.headBody, 'coSpeech')
  unsubA()
  releaseA()
  assert.equal(runtime.frame().snapshot.owners.mouth, 'speech')
  unsubB()
  releaseB()
  assert.equal(runtime.frame().snapshot.owners.mouth, 'idle')
})

test('preview runtime ticks timed leases without a music sampler', async () => {
  const runtime = createPreviewMotionRuntime()
  const release = runtime.retain()
  const now = performance.now()
  runtime.coordinator.claim('performance', ['headBody'], {
    nowMs: now,
    ttlMs: 40,
  })
  assert.equal(runtime.coordinator.owner('headBody', now), 'performance')
  await new Promise((resolve) => setTimeout(resolve, 80))
  const after = runtime.coordinator.owner('headBody')
  assert.notEqual(after, 'performance')
  assert.ok(after === 'idle' || after === 'ambient')
  release()
})

test('mood claims expression below co-speech', () => {
  const coordinator = new RigMotionCoordinator()
  const runtime = new MotionRuntime(coordinator)
  const release = runtime.retain()
  runtime.mood.set(80, 'idle')
  assert.equal(runtime.frame().snapshot.owners.expression, 'mood')
  runtime.speech.handleForTest({
    phase: 'start',
    messageId: 'message-1',
    utteranceId: 'stream-1',
    source: 'reply',
  })
  assert.equal(runtime.frame().snapshot.owners.expression, 'coSpeech')
  assert.equal(runtime.frame().mood?.mood, 80)
  release()
})
