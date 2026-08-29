import assert from 'node:assert/strict'
import test from 'node:test'
import { RigMotionCoordinator } from './coordinator'
import {
  captureRigStateSummary,
  sanitizeRigStateSummary,
  semanticRigCapabilities,
} from './rigStateSummary'
import { MotionRuntime } from './runtime'

test('summary keeps only semantic fields and drops drivers', () => {
  const summary = sanitizeRigStateSummary({
    expression: 'warm',
    posture: 'open',
    acting: { intent: 'listen', phase: 'delivery', remainingMs: 800 },
    owners: { mouth: 'speech', expression: 'coSpeech', gaze: 'ambient', headBody: 'music' },
    speaking: true,
    singing: true,
    musicPlaying: true,
    music: { energy: 'present', beat: 'downbeat' },
    capabilities: ['dizzy-eye', 'head-body', 'psd-layer'],
    recentIntents: ['delight', 'angleX'],
    motionStyle: 'restrained',
    pageVisible: true,
    faceVisible: true,
    angleX: 0.4,
    driver: { mouthOpen: 1 },
  })
  assert.ok(summary)
  const encoded = JSON.stringify(summary)
  assert.equal(encoded.includes('angleX'), false)
  assert.equal(encoded.includes('driver'), false)
  assert.equal(encoded.includes('mouthOpen'), false)
  assert.equal(summary?.owners.mouth, 'speech')
  assert.equal(summary?.owners.headBody, 'music')
  assert.deepEqual(summary?.capabilities, ['dizzy-eye', 'head-body'])
  assert.deepEqual(summary?.recentIntents, ['delight'])
})

test('capture samples the runtime once and never includes per-frame driver keys', () => {
  const runtime = new MotionRuntime(new RigMotionCoordinator())
  const release = runtime.retain()
  runtime.setCapabilities(['blink', 'head-body'])
  runtime.speech.handleForTest({
    phase: 'start',
    messageId: 'message-1',
    utteranceId: 'stream-1',
    source: 'reply',
  })
  const summary = captureRigStateSummary(runtime, 0)
  assert.equal(summary.speaking, true)
  assert.equal(summary.owners.mouth, 'speech')
  assert.equal(summary.faceVisible, true)
  assert.ok(summary.capabilities.includes('head-body'))
  const keys = Object.keys(summary)
  assert.equal(keys.includes('angleX'), false)
  assert.equal(keys.includes('driver'), false)
  release()
})

test('missing special-expression layers are not advertised as capabilities', () => {
  assert.deepEqual(semanticRigCapabilities(null), [])
})
