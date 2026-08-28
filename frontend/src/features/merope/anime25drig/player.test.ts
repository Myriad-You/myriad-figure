import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_FRONT_HAIR_SWAY,
  DEFAULT_REAR_HAIR_SWAY,
  IDENTITY_DRIVER,
  sanitizeDriverPatch,
} from './driver'
import { fadeOpacity, shouldDeformLayer } from './mouthRuntime'

test('uses restrained front and rear hair sway defaults', () => {
  assert.equal(DEFAULT_FRONT_HAIR_SWAY, 1)
  assert.equal(DEFAULT_REAR_HAIR_SWAY, 0.5)
  assert.equal(IDENTITY_DRIVER.fhAmp, 1)
  assert.equal(IDENTITY_DRIVER.physAmp, 0.5)
})

test('skips invisible expression uploads while preserving authored eye-white state', () => {
  assert.equal(shouldDeformLayer({ name: 'eye-dizzy-left' }, 0), false)
  assert.equal(shouldDeformLayer({ name: 'mouth-maniac' }, 0.003), false)
  assert.equal(shouldDeformLayer({ name: 'eye-dizzy-left' }, 0.004), true)
  assert.equal(shouldDeformLayer({ name: 'eyewhite-left' }, 0), true)
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

test('special mouths replace normal speaking and closed artwork without stacking', () => {
  const layer = (
    fade: 'mouthOpen' | 'mouthClose' | 'mouthCry' | 'mouthManiac',
  ) => ({ fade, side: null }) as never
  const crying = { ...IDENTITY_DRIVER, eyeCry: 1, mouthOpen: 0.5 }
  assert.equal(fadeOpacity(layer('mouthCry'), crying), 1)
  assert.equal(fadeOpacity(layer('mouthOpen'), crying), 0)
  assert.equal(fadeOpacity(layer('mouthClose'), crying), 0)

  const talking = { ...IDENTITY_DRIVER, mouthOpen: 1 }
  assert.equal(fadeOpacity(layer('mouthCry'), talking), 0)
  assert.equal(fadeOpacity(layer('mouthOpen'), talking), 1)
  assert.equal(fadeOpacity(layer('mouthClose'), talking), 0)

  const maniac = { ...IDENTITY_DRIVER, maniac: 1 }
  assert.equal(fadeOpacity(layer('mouthManiac'), maniac), 1)
  assert.equal(fadeOpacity(layer('mouthOpen'), maniac), 0)
  assert.equal(fadeOpacity(layer('mouthClose'), maniac), 0)
})

test('vacant-stare artwork owns both eyes and the mouth while it is up', () => {
  const eye = (fade: 'eyeOpen' | 'eyeClose' | 'eyeSilly') =>
    ({ fade, side: 'L' }) as never
  const mouth = (
    fade: 'mouthOpen' | 'mouthClose' | 'mouthSilly' | 'mouthManiac',
  ) => ({ fade, side: null }) as never

  const silly = { ...IDENTITY_DRIVER, silly: 1, mouthOpen: 1 }
  assert.equal(fadeOpacity(eye('eyeSilly'), silly), 1)
  assert.equal(fadeOpacity(eye('eyeOpen'), silly), 0)
  assert.equal(fadeOpacity(eye('eyeClose'), silly), 0)
  assert.equal(fadeOpacity(mouth('mouthSilly'), silly), 1)
  assert.equal(fadeOpacity(mouth('mouthOpen'), silly), 0)
  assert.equal(fadeOpacity(mouth('mouthClose'), silly), 0)

  const half = { ...IDENTITY_DRIVER, silly: 0.5 }
  assert.ok(Math.abs(fadeOpacity(eye('eyeSilly'), half) - 0.5) < 1e-12)
  assert.ok(Math.abs(fadeOpacity(eye('eyeOpen'), half) - 0.5) < 1e-12)

  // A cue landing mid-reply keeps the stare but gives the mouth back.
  assert.equal(fadeOpacity(mouth('mouthSilly'), silly, undefined, 0), 0)
  assert.equal(fadeOpacity(mouth('mouthOpen'), silly, undefined, 0), 1)
  assert.equal(fadeOpacity(eye('eyeSilly'), silly, undefined, 0), 1)

  const crying = { ...IDENTITY_DRIVER, silly: 1, eyeCry: 1 }
  assert.equal(fadeOpacity(eye('eyeSilly'), crying), 0)

  const laughing = { ...IDENTITY_DRIVER, silly: 1, maniac: 1 }
  assert.equal(fadeOpacity(eye('eyeSilly'), laughing), 0)
  assert.equal(fadeOpacity(mouth('mouthSilly'), laughing), 0)
  assert.equal(fadeOpacity(mouth('mouthManiac'), laughing), 1)
})

test('lovestruck accents preserve authored eyes and yield to replacement eyes', () => {
  const layer = (
    fade: 'eyeOpen' | 'lovestruckHeart' | 'lovestruckFace' | 'lovestruckDrool',
  ) => ({ fade, side: 'L' }) as never
  const lovestruck = { ...IDENTITY_DRIVER, lovestruck: 1 }
  assert.equal(fadeOpacity(layer('eyeOpen'), lovestruck), 1)
  assert.equal(fadeOpacity(layer('lovestruckHeart'), lovestruck), 1)
  assert.equal(fadeOpacity(layer('lovestruckFace'), lovestruck), 1)
  assert.equal(fadeOpacity(layer('lovestruckDrool'), lovestruck), 1)

  const blinking = { ...lovestruck, eyeOpenL: 0 }
  assert.equal(fadeOpacity(layer('lovestruckHeart'), blinking), 0)
  assert.equal(fadeOpacity(layer('lovestruckFace'), blinking), 1)

  const crying = { ...lovestruck, eyeCry: 1 }
  assert.equal(fadeOpacity(layer('lovestruckHeart'), crying), 0)
  assert.equal(fadeOpacity(layer('lovestruckFace'), crying), 0)
})

test('shows semantic accents only when replacement-eye expressions are clear', () => {
  const layer = (fade: 'angerMark' | 'speechlessSweat') =>
    ({ fade, side: null }) as never
  assert.equal(
    fadeOpacity(layer('angerMark'), { ...IDENTITY_DRIVER, anger: 1 }),
    1,
  )
  assert.equal(
    fadeOpacity(layer('speechlessSweat'), {
      ...IDENTITY_DRIVER,
      speechless: 1,
    }),
    1,
  )
  assert.equal(
    fadeOpacity(layer('speechlessSweat'), {
      ...IDENTITY_DRIVER,
      anger: 1,
      speechless: 1,
    }),
    0,
  )
  assert.equal(
    fadeOpacity(layer('angerMark'), {
      ...IDENTITY_DRIVER,
      anger: 1,
      eyeCry: 1,
    }),
    0,
  )
  assert.equal(
    fadeOpacity(layer('angerMark'), {
      ...IDENTITY_DRIVER,
      anger: 1,
      maniac: 1,
    }),
    0,
  )
})
