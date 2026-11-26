import assert from 'node:assert/strict'
import test from 'node:test'
import { IDENTITY_DRIVER } from '@myriad-you/figure-player'
import {
  activityExpressionDriverPatch,
  CRY_EXPRESSION_PRESET,
  DIZZY_EXPRESSION_PRESET,
  LOVESTRUCK_EXPRESSION_PRESET,
  MANIAC_EXPRESSION_PRESET,
  SQUEEZE_EXPRESSION_PRESET,
  THINKING_ACTIVITY_EXPRESSION,
  THINKING_EXPRESSION_PRESET,
  ThinkingExpressionOwnership,
} from './expressionPresets'

test('thinking activity owns face and gaze without taking speech channels', () => {
  const thinking = activityExpressionDriverPatch(true)
  assert.equal(thinking, THINKING_ACTIVITY_EXPRESSION)
  assert.ok(thinking.lidL >= 0.7 && thinking.lidL < 0.85)
  assert.ok(thinking.lidR > thinking.lidL && thinking.lidR < 1)
  assert.ok(thinking.irisScale >= 0.9 && thinking.irisScale < 1)
  assert.ok(thinking.browTiltL - thinking.browTiltR > 0.5)
  assert.ok(Math.abs(thinking.gazeX) > 0.5)
  assert.ok(thinking.gazeY < -0.35)
  assert.ok(Math.abs(thinking.headRoll) > 0.15)
  assert.ok(thinking.browLift > 0.15)
  assert.equal(Object.hasOwn(thinking, 'jaw'), false)
  assert.equal(Object.hasOwn(thinking, 'lipCurve'), false)
  assert.equal(Object.hasOwn(thinking, 'talking'), false)
})

test('leaving thinking resets every activity-owned expression channel', () => {
  const neutral = activityExpressionDriverPatch(false)
  assert.deepEqual(
    Object.keys(neutral).toSorted(),
    Object.keys(THINKING_ACTIVITY_EXPRESSION).toSorted(),
  )
  assert.equal(neutral.lidL, 1)
  assert.equal(neutral.lidR, 1)
  assert.equal(neutral.eyeDizzy, 0)
  assert.equal(neutral.eyeSqueeze, 0)
  assert.equal(neutral.eyeCry, 0)
  assert.equal(neutral.maniac, 0)
  assert.equal(neutral.lovestruck, 0)
  assert.equal(neutral.irisScale, 1)
  for (const key of [
    'headYaw',
    'headPitch',
    'headRoll',
    'gazeX',
    'gazeY',
    'browLift',
    'browTiltL',
    'browTiltR',
    'browTilt',
  ] as const) {
    assert.equal(neutral[key], 0)
  }
})

test('dizzy preview owns only the dedicated artwork replacement channel', () => {
  assert.deepEqual(DIZZY_EXPRESSION_PRESET, { eyeDizzy: 1 })
})

test('squeeze preview owns only the inward chevron artwork channel', () => {
  assert.deepEqual(SQUEEZE_EXPRESSION_PRESET, { eyeSqueeze: 1 })
})

test('cry preview combines its own artwork with sad symmetric brows', () => {
  assert.equal(CRY_EXPRESSION_PRESET.eyeCry, 1)
  assert.ok((CRY_EXPRESSION_PRESET.browLift || 0) > 0.2)
  assert.ok((CRY_EXPRESSION_PRESET.browTilt || 0) < -0.3)
  assert.equal(CRY_EXPRESSION_PRESET.eyeSqueeze, undefined)
})

test('maniac preview selects its dedicated mouth while retaining source eyes', () => {
  assert.equal(MANIAC_EXPRESSION_PRESET.maniac, 1)
  assert.equal(MANIAC_EXPRESSION_PRESET.eyeDizzy, undefined)
  assert.equal(MANIAC_EXPRESSION_PRESET.eyeCry, undefined)
})

test('lovestruck preview selects the additive face expression', () => {
  assert.equal(LOVESTRUCK_EXPRESSION_PRESET.lovestruck, 1)
  assert.equal(LOVESTRUCK_EXPRESSION_PRESET.silly, 0)
  assert.equal(LOVESTRUCK_EXPRESSION_PRESET.lidL, 1)
  assert.equal(LOVESTRUCK_EXPRESSION_PRESET.lidR, 1)
})

test('thinking preview enables the dedicated motion loop', () => {
  assert.equal(THINKING_EXPRESSION_PRESET.thinking, true)
})

test('speech releases authored thinking face without erasing newer emotion or articulation', () => {
  for (const preset of [THINKING_ACTIVITY_EXPRESSION, THINKING_EXPRESSION_PRESET]) {
    const owner = new ThinkingExpressionOwnership()
    const target = { ...IDENTITY_DRIVER, talking: false }
    owner.apply(target, { ...preset, thinking: true }, false)
    owner.apply(target, { anger: 0.8, jaw: 0.7, talking: true, browLift: -0.4 }, true)
    assert.equal(target.thinking, false)
    assert.equal(target.gazeX, 0)
    assert.equal(target.gazeY, 0)
    assert.equal(target.lidL, 1)
    assert.equal(target.browTiltL, 0)
    assert.equal(target.anger, 0.8)
    assert.equal(target.browLift, -0.4)
    assert.equal(target.jaw, 0.7)
    assert.equal(target.talking, true)
    const released = { ...target }
    owner.release(target)
    assert.deepEqual(target, released)
  }
})

test('a same-valued newer face survives thought release in the same write or a later speech event', () => {
  for (const together of [false, true]) {
    const owner = new ThinkingExpressionOwnership()
    const target = { ...IDENTITY_DRIVER, talking: false }
    owner.apply(target, THINKING_EXPRESSION_PRESET, false)
    owner.apply(target, { browLift: 0.24, gazeX: 0.68, ...(together ? { talking: true } : {}) }, together)
    if (!together) owner.release(target)
    assert.equal(target.browLift, 0.24)
    assert.equal(target.gazeX, 0.68)
    assert.equal(target.gazeY, 0)
    assert.equal(target.thinking, false)
  }
})

test('repeated thinking updates restore the prior face and explicit exit does not overwrite the next pose', () => {
  const owner = new ThinkingExpressionOwnership()
  const target = { ...IDENTITY_DRIVER, talking: false, anger: 0.6, browLift: -0.2 }
  owner.apply(target, THINKING_EXPRESSION_PRESET, false)
  owner.apply(target, THINKING_EXPRESSION_PRESET, false)
  owner.apply(target, { thinking: false, gazeX: 0.3 }, false)
  assert.equal(target.anger, 0.6)
  assert.equal(target.browLift, -0.2)
  assert.equal(target.gazeX, 0.3)
  assert.equal(target.gazeY, 0)
})

test('a boolean-only thought never owns an unrelated face, and replacement discards old ownership', () => {
  const owner = new ThinkingExpressionOwnership()
  const target = { ...IDENTITY_DRIVER, talking: false, browLift: 0.24 }
  owner.apply(target, { thinking: true }, false)
  owner.release(target)
  assert.equal(target.browLift, 0.24)
  owner.apply(target, THINKING_EXPRESSION_PRESET, false)
  owner.clear()
  Object.assign(target, { ...IDENTITY_DRIVER, talking: false, browLift: 0.7 })
  owner.release(target)
  assert.equal(target.browLift, 0.7)
})

test('activity thinking does not acquire independent mood mouth writes', () => {
  const owner = new ThinkingExpressionOwnership()
  const target = { ...IDENTITY_DRIVER }
  owner.apply(target, { talking: false, lipCurve: 0.2 }, false)
  owner.apply(target, { ...THINKING_ACTIVITY_EXPRESSION, thinking: true }, false)
  assert.equal(target.thinking, true, 'initial idle speech release precedes the thought')
  owner.apply(target, { lipCurve: 0.4 }, false)
  owner.release(target)
  assert.equal(target.lipCurve, 0.4)
})

test('explicit workbench replacement can retain authored flags without live speech arbitration', () => {
  const owner = new ThinkingExpressionOwnership()
  const target = { ...IDENTITY_DRIVER }
  owner.apply(target, { ...THINKING_EXPRESSION_PRESET, talking: true }, false)
  assert.equal(target.thinking, true)
  assert.equal(target.talking, true)
  assert.equal(target.gazeX, THINKING_EXPRESSION_PRESET.gazeX)
})
