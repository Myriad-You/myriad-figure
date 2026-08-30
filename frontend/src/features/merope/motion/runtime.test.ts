import type { MusicMotionSource, SingingFrame } from './musicSource'
import assert from 'node:assert/strict'
import test from 'node:test'
import { RigMotionCoordinator } from './coordinator'
import {
  createLiveMotionRuntime,
  createPreviewMotionRuntime,
  MotionRuntime,
} from './runtime'

function stubMusic(): MusicMotionSource & { listeners: number } {
  const listeners = new Set<(frame: SingingFrame) => void>()
  return {
    listeners: 0,
    subscribe(listener: (frame: SingingFrame) => void) {
      listeners.add(listener)
      this.listeners = listeners.size
      return () => {
        listeners.delete(listener)
        this.listeners = listeners.size
      }
    },
  } as MusicMotionSource & { listeners: number }
}

test('stopping speech drops queued viseme text so a remount does not replay it', () => {
  const runtime = new MotionRuntime(new RigMotionCoordinator())
  const release = runtime.retain()
  runtime.speech.handleForTest({
    phase: 'start',
    messageId: 'message-1',
    utteranceId: 'stream-1',
    source: 'reply',
  })
  runtime.speech.handleForTest({
    phase: 'chunk',
    messageId: 'message-1',
    utteranceId: 'stream-1',
    source: 'reply',
    text: '你好',
  })
  assert.ok((runtime.frame().speech?.queuedText.length ?? 0) > 0)
  runtime.speech.stop()
  assert.deepEqual(runtime.frame().speech?.queuedText ?? [], [])
  release()
})

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

test('live runtime attaches music and starts autonomy; preview stays still', () => {
  const coordinator = new RigMotionCoordinator()
  coordinator.claim('music', ['mouth', 'headBody'], { nowMs: 0 })
  const music = stubMusic()
  const live = createLiveMotionRuntime(coordinator, music)
  const release = live.retain()
  assert.equal(music.listeners, 1)
  live.autonomy.consider(0)
  assert.equal(live.frame().snapshot.owners.expression, 'autonomy')
  assert.equal(live.frame().snapshot.owners.mouth, 'music')
  assert.equal(live.frame().snapshot.owners.headBody, 'music')
  assert.ok(live.frame().autonomy?.directive)
  release()
  assert.equal(live.frame().autonomy, null)
  assert.equal(music.listeners, 0)

  const preview = createPreviewMotionRuntime()
  const previewRelease = preview.retain()
  preview.autonomy.consider(0)
  assert.equal(preview.frame().autonomy, null)
  assert.notEqual(preview.frame().snapshot.owners.expression, 'autonomy')
  previewRelease()
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
