import assert from 'node:assert/strict'
import test from 'node:test'
import { applyExpressiveMotionEnvelope } from './expressiveMotionEnvelope'

function neutralTarget() {
  return {
    brow: 0,
    eyeOpenL: 1,
    eyeOpenR: 1,
    angleX: 0.32,
    angleY: 0,
    angleZ: 0,
    body: -0.18,
  }
}

test('leaves idle, horizontal head, and body channels unchanged', () => {
  const target = neutralTarget()
  applyExpressiveMotionEnvelope(
    target,
    { angleY: 0, angleZ: 0 },
    { brow: 0, eyeOpen: 0, angleY: 0 },
  )

  assert.deepEqual(target, neutralTarget())
})

test('moderately expands only active semantic and co-speech motion', () => {
  const target = {
    ...neutralTarget(),
    brow: 0.095,
    eyeOpenL: 0.8,
    eyeOpenR: 0.94,
    angleY: 0.055,
    angleZ: -0.07,
  }
  applyExpressiveMotionEnvelope(
    target,
    { angleY: 0.02, angleZ: -0.07 },
    { brow: 0.095, eyeOpen: -0.018, angleY: 0.035 },
  )

  assert.ok(Math.abs(target.angleY - 0.06225) < 1e-12)
  assert.ok(Math.abs(target.angleZ - -0.0826) < 1e-12)
  assert.ok(Math.abs(target.brow - 0.1064) < 1e-12)
  assert.ok(Math.abs(target.eyeOpenL - 0.79784) < 1e-12)
  assert.ok(Math.abs(target.eyeOpenR - 0.93784) < 1e-12)
  assert.equal(target.angleX, 0.32)
  assert.equal(target.body, -0.18)
})

test('soft-limits combined extremes and preserves closed-eye asymmetry', () => {
  const target = {
    ...neutralTarget(),
    brow: 0.98,
    eyeOpenL: 0,
    eyeOpenR: 0.72,
    angleY: 0.98,
    angleZ: -0.98,
  }
  applyExpressiveMotionEnvelope(
    target,
    { angleY: 1, angleZ: -1 },
    { brow: 1, eyeOpen: 0.1, angleY: 1 },
  )

  assert.ok(target.angleY > 0.98 && target.angleY < 1)
  assert.ok(target.angleZ < -0.98 && target.angleZ > -1)
  assert.ok(target.brow > 0.98 && target.brow < 1)
  assert.equal(target.eyeOpenL, 0)
  assert.ok(target.eyeOpenR > 0.72)
  assert.equal(target.angleX, 0.32)
  assert.equal(target.body, -0.18)
})

test('ignores invalid signals instead of contaminating the frame', () => {
  const target = neutralTarget()
  applyExpressiveMotionEnvelope(
    target,
    { angleY: Number.NaN, angleZ: Number.POSITIVE_INFINITY },
    { brow: Number.NaN, eyeOpen: Number.NEGATIVE_INFINITY, angleY: Number.NaN },
  )

  assert.deepEqual(target, neutralTarget())
})
