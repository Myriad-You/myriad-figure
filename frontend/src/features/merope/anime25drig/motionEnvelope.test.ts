import assert from 'node:assert/strict'
import test from 'node:test'
import { IDENTITY_DRIVER } from './driver'
import { projectAnime25DMotionEnvelope } from './motionEnvelope'

test('high collar transfers unsafe pitch instead of globally shrinking the pose', () => {
  const driver = {
    ...IDENTITY_DRIVER,
    angleY: 1,
    angleZ: -0.2,
    body: 0.2,
  }
  const result = projectAnime25DMotionEnvelope(
    driver,
    { highCollar: true, armMotion: true },
    { clippedEnergy: 0, transferredEnergy: 0 },
  )
  assert.ok(driver.angleY < 0.8)
  assert.ok(driver.angleZ < -0.2)
  assert.ok(driver.armY > 0)
  assert.ok(result.clippedEnergy > 0)
  assert.equal(result.clippedEnergy, result.transferredEnergy)
})

test('ordinary poses pass through the joint envelope unchanged', () => {
  const driver = { ...IDENTITY_DRIVER, angleX: 0.2, angleY: 0.3, body: 0.4 }
  projectAnime25DMotionEnvelope(
    driver,
    { highCollar: true, armMotion: false },
    { clippedEnergy: 0, transferredEnergy: 0 },
  )
  assert.equal(driver.angleX, 0.2)
  assert.equal(driver.angleY, 0.3)
  assert.equal(driver.body, 0.4)
})
