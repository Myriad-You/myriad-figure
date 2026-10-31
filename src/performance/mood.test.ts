import assert from 'node:assert/strict'
import test from 'node:test'
import { moodBand } from './mood'

// The thresholds against the core's mood_band: Myriad's frontend/src/features/merope/figureCore.test.ts.
test('moodBand matches Merope circumplex thresholds', () => {
  assert.equal(moodBand(0), 'floor')
  assert.equal(moodBand(10, 48), 'floor')
  assert.equal(moodBand(30, 40), 'sad')
  assert.equal(moodBand(30, 70), 'tense')
  assert.equal(moodBand(70, 48), 'calm')
  assert.equal(moodBand(90, 48), 'calm')
  assert.equal(moodBand(90, 70), 'excited')
  assert.equal(moodBand(undefined), 'calm')
})
