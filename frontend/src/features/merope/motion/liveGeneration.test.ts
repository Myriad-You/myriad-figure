import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isLiveMotionGeneration,
  liveMotionGeneration,
  newMotionIntentId,
  setLiveMotionGeneration,
} from './liveGeneration'

test('live generation is in-memory and missing values stay compatible', () => {
  setLiveMotionGeneration(4)
  assert.equal(liveMotionGeneration(), 4)
  assert.equal(isLiveMotionGeneration(4), true)
  assert.equal(isLiveMotionGeneration(3), false)
  assert.equal(isLiveMotionGeneration(undefined), true)
  assert.ok(newMotionIntentId().startsWith('motion-'))
  setLiveMotionGeneration(0)
  assert.equal(liveMotionGeneration(), 0)
})
