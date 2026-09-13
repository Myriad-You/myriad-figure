import type { Anime25DPlayback } from './types'
import assert from 'node:assert/strict'
import test from 'node:test'
import { WORKBENCH_DRIVER } from './driver'
import { appendPoseCorrectionPatch, capturePoseCorrection, poseCorrectionPreviewDriver } from './poseAuthoring'

const playback = {
  anchors: { face: { y1: 450 }, eyeL: { icx: 210, closeY: 260 }, mouth: { cx: 300, cy: 380 } },
  layers: [{ role: 'face' }, { role: 'front-hair' }],
  shellProfile: { head: { centerX: 300, centerY: 250, radiusX: 180, radiusY: 240 } },
} as Anime25DPlayback
const driver = { ...WORKBENCH_DRIVER, angleX: 0.8, angleY: -0.6, eyeOpenL: 0 }

test('capture uses actual asset anchors and pose conditions, not avatar names', () => {
  const c = capturePoseCorrection(playback, driver, 'leftEye')!
  assert.deepEqual(c.at, { angleX: 0.8, angleY: -0.6, eyeCloseL: 1 })
  assert.equal(c.surface, 'head')
  assert.equal(c.patches[0].x, -0.5)
  assert.equal(c.patches[0].y, 10 / 240)
  assert.equal(c.patches[0].dx, 0)
  assert.equal(capturePoseCorrection(playback, WORKBENCH_DRIVER, 'leftEye'), null)
  assert.equal(capturePoseCorrection(playback, driver, 'rightEye'), null)
  assert.equal(capturePoseCorrection(playback, driver, 'rearCrown'), null)
  assert.equal(capturePoseCorrection(playback, driver, 'frontCrown')?.surface, 'front-hair')
})

test('adding patches reuses the existing corner without overwriting its calibration or source arrays', () => {
  const c = capturePoseCorrection(playback, driver, 'leftEye')!
  c.patches[0].dx = 0.1
  const current = [c]
  const candidate = { ...c, at: { ...c.at, angleX: 1 }, patches: [{ ...c.patches[0], dx: 0 }] }
  const result = appendPoseCorrectionPatch(current, candidate)!
  assert.equal(result.index, 0)
  assert.equal(result.patch, 1)
  assert.equal(result.corrections.length, 1)
  assert.equal(result.corrections[0].at.angleX, 0.8)
  assert.equal(result.corrections[0].patches[0].dx, 0.1)
  assert.equal(current[0].patches.length, 1)
  result.corrections[0].patches[0].dx = 0.2
  assert.equal(current[0].patches[0].dx, 0.1)
  assert.equal(appendPoseCorrectionPatch([{ ...c, patches: Array.from({ length: 8 }).fill(c.patches[0]) }], candidate), null)
})

test('selecting a correction freezes distracting motion and preserves unrelated expression controls', () => {
  const c = capturePoseCorrection(playback, driver, 'leftEye')!
  const selected = poseCorrectionPreviewDriver(c, { ...WORKBENCH_DRIVER, mouthForm: 0.7, eyeOpenR: 0 })
  assert.equal(selected.angleX, 0.8)
  assert.equal(selected.angleY, -0.6)
  assert.equal(selected.eyeOpenL, 0)
  assert.equal(selected.eyeOpenR, 0)
  assert.equal(selected.mouthForm, 0.7)
  for (const key of ['idle', 'rand', 'blink', 'talk', 'mouse', 'phys'] as const) assert.equal(selected[key], false)
})
