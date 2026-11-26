import type { PoseCorrection } from '@myriad-you/figure-player/workbench'
import assert from 'node:assert/strict'
import test from 'node:test'
import { IDENTITY_DRIVER } from '@myriad-you/figure-player'
import { applyPoseCorrections, bindPoseCorrections, writePoseCorrectionWeights } from '@myriad-you/figure-player/internals'
import { poseCorrectionPatch } from './poseCorrections'

const head = {
  centerX: 300,
  centerY: 250,
  radiusX: 160,
  radiusY: 200,
  radiusZ: 100,
}
const correction: PoseCorrection = {
  surface: 'head',
  at: { headYaw: 0.8, headPitch: -0.6 },
  patches: [{ x: 0, y: 0, radiusX: 0.6, radiusY: 0.4, dx: 0.05, dy: -0.04 }],
}
test('authoring captures a residual and scales with the asset, not canvas pixels', () => {
  const patch = poseCorrectionPatch(
    head,
    { x: 300, y: 250 },
    { x: 350, y: 280 },
    { x: 358, y: 272 },
    { x: 96, y: 80 },
  )
  assert.deepEqual(patch, correction.patches[0])
  const scaled = {
    centerX: 600,
    centerY: 500,
    radiusX: 320,
    radiusY: 400,
    radiusZ: 200,
  }
  const bound = bindPoseCorrections(
    [correction],
    'head',
    new Float32Array([600, 500]),
    scaled,
  )!
  writePoseCorrectionWeights(bound, {
    ...IDENTITY_DRIVER,
    headYaw: 0.8,
    headPitch: -0.6,
  })
  const point = { x: 700, y: 560 }
  applyPoseCorrections(point, 0, bound)
  assert.deepEqual(point, { x: 716, y: 544 })
})
