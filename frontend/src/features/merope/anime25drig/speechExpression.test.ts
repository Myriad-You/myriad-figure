import assert from 'node:assert/strict'
import test from 'node:test'
import { CoSpeechExpressionController } from './speechExpression'

/** 不带 authored energy 的那一路：直接把三个包络喂进 writeOffset。 */
function envelopeOnly(
  expression: CoSpeechExpressionController,
  phraseActivity: number,
  browAccent: number,
  headAccent: number,
) {
  return expression.sample(
    0,
    false,
    null,
    phraseActivity,
    browAccent,
    headAccent,
  )
}

test('keeps co-speech expression neutral without a speech envelope', () => {
  assert.deepEqual(
    { ...envelopeOnly(new CoSpeechExpressionController(), 0, 0, 0) },
    { brow: 0, eyeOpen: 0, angleY: 0 },
  )
})

test('adds a small bounded expression without owning the base pose', () => {
  const offset = {
    ...envelopeOnly(new CoSpeechExpressionController(), 1, 1, 1),
  }
  assert.equal(offset.brow, 0.095)
  assert.ok(offset.eyeOpen < 0)
  assert.ok(Math.abs(offset.eyeOpen) < 0.01)
  assert.equal(offset.angleY, 0.035)
})

test('sanitizes unusable inputs and reuses its frame result', () => {
  const expression = new CoSpeechExpressionController()
  const first = envelopeOnly(expression, Number.NaN, -1, 2)
  assert.equal(first.brow, 0)
  assert.equal(first.eyeOpen, 0)
  assert.equal(first.angleY, 0.035)
  assert.equal(first, envelopeOnly(expression, 0.5, 0.5, 0.5))
})

test('derives a delayed visual beat from authored energy without frame allocation', () => {
  const expression = new CoSpeechExpressionController()
  const neutral = expression.sample(0, true, 0, 0, 0, 0)
  const onset = expression.sample(0.1, true, 0.8, 0, 0, 0)
  const browLead = { ...expression.sample(0.14, true, 0.8, 0, 0, 0) }
  const headFollow = { ...expression.sample(0.18, true, 0.8, 0, 0, 0) }

  assert.equal(neutral, onset)
  assert.ok(browLead.brow > 0.04)
  assert.equal(browLead.angleY, 0)
  assert.ok(headFollow.angleY > 0)
  const releaseStart = { ...expression.sample(0.2, false, null, 0, 0, 0) }
  assert.ok(releaseStart.brow > 0)
  assert.ok(releaseStart.brow <= headFollow.brow + 1e-6)
  const mid = { ...expression.sample(0.32, false, null, 0, 0, 0) }
  assert.ok(mid.brow < releaseStart.brow)
  let rest = mid
  for (let frame = 1; frame <= 48; frame += 1) {
    rest = { ...expression.sample(0.32 + frame / 60, false, null, 0, 0, 0) }
  }
  assert.ok(Math.abs(rest.brow) < 1e-3)
  assert.ok(Math.abs(rest.eyeOpen) < 1e-3)
  assert.ok(Math.abs(rest.angleY) < 1e-3)
})

test('anticipates known TTS emphasis instead of waiting for the loudness edge', () => {
  const expression = new CoSpeechExpressionController()
  expression.setProsody(
    {
      utteranceId: 'utt-1',
      startedAtMs: 1_000,
      durationMs: 1_000,
      accents: [{ offsetMs: 400, intensity: 0.8 }],
    },
    0,
    1_000,
  )
  expression.sample(0.3, true, 0.2, 0, 0, 0)
  const preparation = {
    ...expression.sample(0.36, true, 0.2, 0, 0, 0),
  }
  const stroke = { ...expression.sample(0.4, true, 0.2, 0, 0, 0) }
  assert.ok(preparation.brow > 0)
  assert.ok(stroke.brow > preparation.brow)
})
