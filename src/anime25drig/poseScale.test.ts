import assert from 'node:assert/strict'
import test from 'node:test'
import { HEAD_TILT_RADIANS, headRollRadians } from '@myriad/figure-player/internals'
import { headRollForRadians } from './poseScale'

test('the headRoll for a roll in radians undoes headRollRadians over the whole range', () => {
  for (let headRoll = -1; headRoll <= 1; headRoll += 0.05) {
    assert.ok(Math.abs(headRollForRadians(headRollRadians(headRoll)) - headRoll) < 1e-9, `${headRoll}`)
  }
  assert.equal(headRollForRadians(HEAD_TILT_RADIANS * 2), 1, 'no further than the full tilt')
})
