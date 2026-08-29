import assert from 'node:assert/strict'
import test from 'node:test'
import { channelPriority } from './channels'
import { RigMotionCoordinator } from './coordinator'

test('channel table matches the live-face control order', () => {
  assert.ok(
    channelPriority('mouth', 'preview') > channelPriority('mouth', 'speech'),
  )
  assert.ok(
    channelPriority('mouth', 'speech') > channelPriority('mouth', 'music'),
  )
  assert.ok(
    channelPriority('expression', 'performance') >
      channelPriority('expression', 'music'),
  )
  assert.ok(
    channelPriority('expression', 'music') >
      channelPriority('expression', 'mood'),
  )
  assert.ok(
    channelPriority('gaze', 'pointer') > channelPriority('gaze', 'performance'),
  )
  assert.ok(
    channelPriority('headBody', 'performance') >
      channelPriority('headBody', 'music'),
  )
  assert.ok(
    channelPriority('headBody', 'music') >
      channelPriority('headBody', 'ambient'),
  )
})

test('speech steals only the mouth; music keeps the body', () => {
  const coordinator = new RigMotionCoordinator()
  coordinator.claim('music', ['mouth', 'headBody'], { nowMs: 0 })
  coordinator.claim('speech', ['mouth'], { nowMs: 1 })
  const snapshot = coordinator.snapshot(1)
  assert.equal(snapshot.owners.mouth, 'speech')
  assert.equal(snapshot.owners.headBody, 'music')
  assert.equal(snapshot.owners.expression, 'idle')
})

test('explicit performance only takes the channels it claimed', () => {
  const coordinator = new RigMotionCoordinator()
  coordinator.claim('music', ['mouth', 'headBody'], { nowMs: 0 })
  coordinator.claim('performance', ['expression'], { nowMs: 1 })
  const faceOnly = coordinator.snapshot(1)
  assert.equal(faceOnly.owners.expression, 'performance')
  assert.equal(faceOnly.owners.headBody, 'music')
  assert.equal(faceOnly.owners.mouth, 'music')

  coordinator.claim('performance', ['expression', 'headBody'], { nowMs: 2 })
  const withBody = coordinator.snapshot(2)
  assert.equal(withBody.owners.headBody, 'performance')
  assert.equal(withBody.owners.mouth, 'music')
})

test('preview outranks every live source on the selected channels', () => {
  const coordinator = new RigMotionCoordinator()
  coordinator.claim('speech', ['mouth'], { nowMs: 0 })
  coordinator.claim('music', ['headBody'], { nowMs: 0 })
  coordinator.claim('preview', ['mouth', 'headBody'], { nowMs: 1 })
  const snapshot = coordinator.snapshot(1)
  assert.equal(snapshot.owners.mouth, 'preview')
  assert.equal(snapshot.owners.headBody, 'preview')
})

test('expired leases auto-release and bump generation', () => {
  const coordinator = new RigMotionCoordinator()
  const first = coordinator.claim('music', ['mouth', 'headBody'], {
    nowMs: 0,
    ttlMs: 50,
  })
  assert.equal(coordinator.owner('headBody', 40), 'music')
  coordinator.tick(50)
  assert.equal(coordinator.owner('headBody', 50), 'idle')
  assert.ok(coordinator.snapshot(50).generation > first)
})

test('releasing one channel leaves the rest of the lease', () => {
  const coordinator = new RigMotionCoordinator()
  coordinator.claim('music', ['mouth', 'headBody'], { nowMs: 0 })
  coordinator.release('music', ['mouth'])
  const snapshot = coordinator.snapshot(0)
  assert.equal(snapshot.owners.mouth, 'idle')
  assert.equal(snapshot.owners.headBody, 'music')
})

test('physics overlays instead of taking exclusive ownership', () => {
  const coordinator = new RigMotionCoordinator()
  coordinator.claim('music', ['physics'], { nowMs: 0 })
  coordinator.claim('ambient', ['physics'], { nowMs: 1 })
  const snapshot = coordinator.snapshot(1)
  assert.deepEqual(snapshot.physics.slice().sort(), ['ambient', 'music'])
  assert.equal(snapshot.owners.headBody, 'idle')
})
