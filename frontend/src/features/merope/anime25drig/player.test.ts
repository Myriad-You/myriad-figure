import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_FRONT_HAIR_SWAY,
  DEFAULT_REAR_HAIR_SWAY,
  fadeOpacity,
  IDENTITY_DRIVER,
  sanitizeDriverPatch,
} from './player'

test('uses restrained front and rear hair sway defaults', () => {
  assert.equal(DEFAULT_FRONT_HAIR_SWAY, 1)
  assert.equal(DEFAULT_REAR_HAIR_SWAY, 0.5)
  assert.equal(IDENTITY_DRIVER.fhAmp, 1)
  assert.equal(IDENTITY_DRIVER.physAmp, 0.5)
})

test('clamps all external driver writes at the runtime boundary', () => {
  const patch = sanitizeDriverPatch({
    angleX: 99,
    mouthOpen: -2,
    armPos: 8,
    bust: Number.NaN,
    talk: true,
  })
  assert.equal(patch.angleX, 1)
  assert.equal(patch.mouthOpen, 0)
  assert.equal(patch.armPos, 1)
  assert.equal(patch.bust, undefined)
  assert.equal(patch.talk, true)
})

test('symbol artwork replaces both open and closed eyes without stacking', () => {
  const layer = (
    fade: 'eyeOpen' | 'eyeClose' | 'eyeDizzy' | 'eyeSqueeze' | 'eyeCry',
  ) => ({ fade, side: 'L' }) as never
  const half = { ...IDENTITY_DRIVER, eyeDizzy: 0.5 }
  assert.ok(Math.abs(fadeOpacity(layer('eyeDizzy'), half) - 0.5) < 1e-12)
  assert.ok(Math.abs(fadeOpacity(layer('eyeOpen'), half) - 0.5) < 1e-12)
  assert.equal(fadeOpacity(layer('eyeClose'), half), 0)

  const dizzy = { ...IDENTITY_DRIVER, eyeDizzy: 1 }
  assert.equal(fadeOpacity(layer('eyeDizzy'), dizzy), 1)
  assert.equal(fadeOpacity(layer('eyeOpen'), dizzy), 0)
  assert.equal(fadeOpacity(layer('eyeClose'), dizzy), 0)

  const squeeze = { ...IDENTITY_DRIVER, eyeSqueeze: 1 }
  assert.equal(fadeOpacity(layer('eyeSqueeze'), squeeze), 1)
  assert.equal(fadeOpacity(layer('eyeOpen'), squeeze), 0)
  assert.equal(fadeOpacity(layer('eyeClose'), squeeze), 0)

  const cry = { ...IDENTITY_DRIVER, eyeCry: 1 }
  assert.equal(fadeOpacity(layer('eyeCry'), cry), 1)
  assert.equal(fadeOpacity(layer('eyeSqueeze'), cry), 0)
  assert.equal(fadeOpacity(layer('eyeOpen'), cry), 0)
  assert.equal(fadeOpacity(layer('eyeClose'), cry), 0)

  const cryAndSqueeze = {
    ...IDENTITY_DRIVER,
    eyeCry: 1,
    eyeSqueeze: 1,
  }
  assert.equal(fadeOpacity(layer('eyeCry'), cryAndSqueeze), 1)
  assert.equal(fadeOpacity(layer('eyeSqueeze'), cryAndSqueeze), 0)

  const both = { ...IDENTITY_DRIVER, eyeDizzy: 1, eyeSqueeze: 1 }
  assert.equal(fadeOpacity(layer('eyeDizzy'), both), 1)
  assert.equal(fadeOpacity(layer('eyeSqueeze'), both), 0)
  assert.equal(fadeOpacity(layer('eyeCry'), { ...both, eyeCry: 1 }), 0)
})

test('cry mouth replaces normal speaking and closed artwork without stacking', () => {
  const layer = (fade: 'mouthOpen' | 'mouthClose' | 'mouthCry') =>
    ({ fade, side: null }) as never
  const crying = { ...IDENTITY_DRIVER, eyeCry: 1, mouthOpen: 0.5 }
  assert.equal(fadeOpacity(layer('mouthCry'), crying), 1)
  assert.equal(fadeOpacity(layer('mouthOpen'), crying), 0)
  assert.equal(fadeOpacity(layer('mouthClose'), crying), 0)

  const talking = { ...IDENTITY_DRIVER, mouthOpen: 1 }
  assert.equal(fadeOpacity(layer('mouthCry'), talking), 0)
  assert.equal(fadeOpacity(layer('mouthOpen'), talking), 1)
  assert.equal(fadeOpacity(layer('mouthClose'), talking), 0)
})
