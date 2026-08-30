import assert from 'node:assert/strict'
import test from 'node:test'
import { applyIdleBreath, idleBreathOffset } from './idleBreath'

test('idle breath phase depends only on time, not an authored idle flag', () => {
  const at = idleBreathOffset(3.7)
  assert.equal(
    at.angleX,
    0.13 * Math.sin(3.7 * 0.42) + 0.05 * Math.sin(3.7 * 1.13),
  )
  assert.deepEqual(idleBreathOffset(3.7), at)
  const target = { angleX: 0.2, angleY: -0.1, angleZ: 0.15, body: 0.25 }
  applyIdleBreath(target, 0, 3.7)
  assert.deepEqual(target, {
    angleX: 0.2,
    angleY: -0.1,
    angleZ: 0.15,
    body: 0.25,
  })
  applyIdleBreath(target, 1, 3.7)
  assert.equal(target.angleX, 0.2 + at.angleX)
  assert.equal(target.body, 0.25 + at.body)
})
