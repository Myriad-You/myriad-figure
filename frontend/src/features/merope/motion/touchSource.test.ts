import assert from 'node:assert/strict'
import test from 'node:test'
import { realizeAnime25DBehaviorPlan } from '../anime25drig/behaviorRealizer'
import { TouchGestureTracker } from '../interaction/touchGesture'
import { RigMotionCoordinator } from './coordinator'
import { HumanPerformanceRuntime } from './humanPerformanceRuntime'
import { TouchMotionSource } from './touchSource'

test('contact is realized by the shared scheduler without claiming mouth or restarting on hold', () => {
  const coordinator = new RigMotionCoordinator()
  const speech = coordinator.claim('speech', ['mouth'])
  const music = coordinator.claim('music', ['headBody'])
  const source = new TouchMotionSource(coordinator, () => {})
  const gestures = new TouchGestureTracker()
  const sample = { pointerId: 1, x: 0, y: 0, atMs: 1000, region: 'hair' as const }
  source.update('widget', gestures.begin(sample)!, 1000)
  const first = source.current()!
  const runtime = new HumanPerformanceRuntime()
  const initial = runtime.frame([first], 1000)
  assert.equal(realizeAnime25DBehaviorPlan(initial.plan!, 1000).reports[0].result, 'accepted')
  source.update('widget', gestures.update({ ...sample, atMs: 1500 })!, 1500)
  const hold = runtime.frame([source.current()], 1500)
  assert.equal(hold.plan!.behaviors[0].id, first.behaviors[0].id)
  assert.equal(source.current()!.originMs, 1000)
  assert.equal(coordinator.snapshot(1500).owners.mouth, 'speech')
  source.release('old-panel')
  assert.ok(source.current())
  source.update('widget', gestures.cancel(1600)!, 1600)
  assert.equal(source.current(), null)
  assert.equal(coordinator.snapshot(1600).owners.headBody, 'music')
  assert.equal(coordinator.snapshot(1600).owners.mouth, 'speech')
  coordinator.release(speech)
  coordinator.release(music)
})

test('motion intensity changes preserve identity; old owner cannot cancel a successor', () => {
  const source = new TouchMotionSource(new RigMotionCoordinator(), () => {})
  const gestures = new TouchGestureTracker()
  const sample = { pointerId: 1, x: 0, y: 0, atMs: 0, region: 'face' as const }
  source.update('panel', gestures.begin(sample)!, 0)
  const id = source.current()!.behaviors[0].id
  source.update('panel', gestures.update({ ...sample, x: 0.2, atMs: 200 })!, 200)
  assert.equal(source.current()!.behaviors[0].id, id)
  assert.equal(source.current()!.behaviors[0].intensity, 0.85)
  const other = new TouchGestureTracker()
  source.update('widget', other.begin({ ...sample, atMs: 300 })!, 300)
  source.update('panel', gestures.cancel(400)!, 400)
  assert.ok(source.current()!.id.includes('widget'))
  source.release()
})
