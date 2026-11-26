import assert from 'node:assert/strict'
import test from 'node:test'
import { IDENTITY_DRIVER } from '@myriad-you/figure-player'
import { MAX_RESPONSE_SCALE, MIN_RESPONSE_SCALE, PoseResponseController } from '@myriad-you/figure-player/internals'
import { poseResponseScale, resolvePoseResponseScale } from './poseResponse'

const NEUTRAL_QUALITY = {
  extent: 1,
  tempo: 1,
  power: 1,
  fluidity: 0.8,
  directness: 0.72,
  rebound: 0.35,
  asymmetry: 0.2,
  density: 0.8,
}
const FORCEFUL = {
  ...NEUTRAL_QUALITY,
  tempo: 1.2,
  power: 1.2,
  fluidity: 0.58,
  directness: 0.9,
}
const GENTLE = {
  ...NEUTRAL_QUALITY,
  tempo: 0.9,
  power: 0.8,
  fluidity: 0.82,
  directness: 0.72,
}
test('a delivery neither snaps nor drifts outside the rig bandwidth', () => {
  assert.equal(poseResponseScale(NEUTRAL_QUALITY), 1)
  for (const quality of [FORCEFUL, GENTLE]) {
    const scale = poseResponseScale(quality)
    assert.ok(scale >= MIN_RESPONSE_SCALE && scale <= MAX_RESPONSE_SCALE)
  }
  const extreme = poseResponseScale({
    ...NEUTRAL_QUALITY,
    tempo: 99,
    power: 99,
    directness: 99,
    fluidity: -99,
  })
  assert.equal(extreme, MAX_RESPONSE_SCALE)
})
test('manner reaches the pose, not just its size', () => {
  assert.ok(poseResponseScale(FORCEFUL) > poseResponseScale(GENTLE))

  const travel = (quality: typeof FORCEFUL): number => {
    const response = new PoseResponseController()
    const current = { ...IDENTITY_DRIVER }
    const target = { ...IDENTITY_DRIVER, headYaw: 1 }
    const scale = poseResponseScale(quality)
    for (let step = 0; step < 4; step += 1) {
      response.step(current, target, 1 / 60, scale)
    }
    return current.headYaw
  }
  assert.ok(
    travel(FORCEFUL) > travel(GENTLE) * 1.1,
    `${travel(FORCEFUL)} vs ${travel(GENTLE)}`,
  )
})
test('an unclaimed pose keeps the rig own rate', () => {
  assert.equal(resolvePoseResponseScale([]), 1)
  assert.equal(
    resolvePoseResponseScale([{ weight: 0.8, quality: null }]),
    1,
  )
  const faint = resolvePoseResponseScale([{ weight: 0.1, quality: FORCEFUL }])
  const full = resolvePoseResponseScale([{ weight: 1, quality: FORCEFUL }])
  assert.ok(faint > 1 && faint < full)
  assert.ok(Math.abs(faint - 1 - (full - 1) * 0.1) < 1e-9)
})
test('two live sources are averaged by what each carries', () => {
  const blended = resolvePoseResponseScale([
    { weight: 0.9, quality: FORCEFUL },
    { weight: 0.1, quality: GENTLE },
  ])
  assert.ok(blended > resolvePoseResponseScale([{ weight: 1, quality: GENTLE }]))
  assert.ok(
    blended < resolvePoseResponseScale([{ weight: 1, quality: FORCEFUL }]),
  )
})
