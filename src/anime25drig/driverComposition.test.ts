import type { Anime25DDriver } from '@myriad-you/figure-player'
import assert from 'node:assert/strict'
import test from 'node:test'
import { IDENTITY_DRIVER } from '@myriad-you/figure-player'
import { applyAnime25DComposedPose, applyAnime25DStylizedExpression, resolveAnime25DStylizedTargets } from './driverComposition'
import { intentExpressionOffset, mixBoundedExpressionChannel } from './performanceExpression'
import { zeroOccupancyOffset } from './poseCompositor'
import { StylizedExpressionMotionController } from './stylizedExpressionMotion'

test('all shared pose producers land through one channel-weighted composition', () => {
  const target = { ...IDENTITY_DRIVER }
  const full = { gaze: 1, headBody: 1, expression: 1 }
  const none = { gaze: 0, headBody: 0, expression: 0 }
  const performance = intentExpressionOffset('think', 1)
  const stylized = new StylizedExpressionMotionController().sample(
    0,
    0,
    0,
    0,
    0,
    0,
  )
  applyAnime25DComposedPose(
    target,
    {
      ambient: full,
      random: none,
      groove: none,
      thinking: none,
      performance: full,
      stylized: full,
      coSpeech: full,
      speechMouth: 0,
      grooveMouth: 0,
    },
    {
      ambient: { angleX: 0, angleY: 0, angleZ: 0, body: 0, eyeX: 0, eyeY: 0 },
      randomAction: {
        angleX: 0,
        angleY: 0,
        angleZ: 0,
        body: 0,
        eyeX: 0,
        eyeY: 0,
        brow: 0,
        browAngSym: 0,
        eyeOpen: 0,
        irisScale: 0,
        eyeSmile: 0,
        eyeWide: 0,
        wink: 0,
        mouthForm: 0,
        mouthOpen: 0,
        mouthRound: 0,
        armY: 0,
        armPos: 0,
        ambientScale: 1,
      },
      groove: {
        angleX: 0,
        angleY: 0,
        angleZ: 0,
        body: 0,
        armY: 0,
        armPos: 0,
        eyeX: 0,
        brow: 0,
      },
      thinking: {
        angleX: 0,
        angleY: 0,
        angleZ: 0,
        eyeX: 0,
        eyeY: 0,
        brow: 0,
        mouthCY: 0,
        mouthCAng: 0,
        mouthScale: 0,
      },
      idleSway: { angleX: 0.1, angleY: 0, angleZ: 0, body: 0.08 },
      performance,
      stylized,
      coSpeech: {
        brow: 0.1,
        eyeOpen: 0,
        angleY: 0.05,
        angleZ: 0.04,
        body: 0.12,
      },
    },
    zeroOccupancyOffset(),
  )

  assert.ok(target.headYaw > 0.09, 'breath')
  assert.ok(target.bodyLean > 0.07, 'breath body')
  assert.ok(target.gazeX > 0.45, 'directed gaze')
  assert.ok(target.headRoll < -0.15, 'semantic head plus expressive range')
  assert.ok(target.browLift > 0.23, 'semantic and co-speech brow')
})
test('semantic and staged expression extras honor independent ownership', () => {
  const target = { ...IDENTITY_DRIVER }
  const semantic = intentExpressionOffset('dizzy', 1)
  const controller = new StylizedExpressionMotionController()
  let stylized = controller.sample(0, 0, 0, 1, 0, 0)
  for (let frame = 1; frame <= 60; frame += 1) {
    stylized = controller.sample(frame / 60, 0, 0, 1, 0, 0)
  }

  applyAnime25DStylizedExpression(target, semantic, stylized, 1, 0, 0.25)

  assert.equal(target.eyeDizzy, 0)
  assert.equal(target.maniac, 0)
  assert.equal(target.jaw, stylized.mouthOpen * 0.25)
})
test('delight realizes its claimed bust resource through head/body ownership', () => {
  const target = { ...IDENTITY_DRIVER }
  const full = { gaze: 1, headBody: 1, expression: 1 }
  const none = { gaze: 0, headBody: 0, expression: 0 }
  const performance = intentExpressionOffset('delight', 1)
  const stylized = new StylizedExpressionMotionController().sample(
    0,
    0,
    0,
    0,
    0,
    0,
  )

  applyAnime25DComposedPose(
    target,
    {
      ambient: none,
      random: none,
      groove: none,
      thinking: none,
      performance: full,
      stylized: none,
      coSpeech: none,
      speechMouth: 0,
      grooveMouth: 0,
    },
    {
      ambient: { angleX: 0, angleY: 0, angleZ: 0, body: 0, eyeX: 0, eyeY: 0 },
      randomAction: {
        angleX: 0,
        angleY: 0,
        angleZ: 0,
        body: 0,
        eyeX: 0,
        eyeY: 0,
        brow: 0,
        browAngSym: 0,
        eyeOpen: 0,
        irisScale: 0,
        eyeSmile: 0,
        eyeWide: 0,
        wink: 0,
        mouthForm: 0,
        mouthOpen: 0,
        mouthRound: 0,
        armY: 0,
        armPos: 0,
        ambientScale: 1,
      },
      groove: {
        angleX: 0,
        angleY: 0,
        angleZ: 0,
        body: 0,
        armY: 0,
        armPos: 0,
        eyeX: 0,
        brow: 0,
      },
      thinking: {
        angleX: 0,
        angleY: 0,
        angleZ: 0,
        eyeX: 0,
        eyeY: 0,
        brow: 0,
        mouthCY: 0,
        mouthCAng: 0,
        mouthScale: 0,
      },
      idleSway: { angleX: 0, angleY: 0, angleZ: 0, body: 0 },
      performance,
      stylized,
      coSpeech: { brow: 0, eyeOpen: 0, angleY: 0, angleZ: 0, body: 0 },
    },
    zeroOccupancyOffset(),
  )

  assert.ok(
    Math.abs(target.bust - (IDENTITY_DRIVER.bust + (performance.bust ?? 0))) <
      1e-12,
  )
})
test('the lovestruck mouth yields to a voice by degrees, not in one step', () => {
  const controller = new StylizedExpressionMotionController()
  let stylized = controller.sample(0, 0, 0, 0, 0, 1)
  for (let frame = 1; frame <= 90; frame += 1) {
    stylized = controller.sample(frame / 60, 0, 0, 0, 0, 1)
  }
  assert.ok(stylized.lovestruckMouthOpen > 0, 'expected an open sticker mouth')

  const semantic = intentExpressionOffset('delight', 0)
  const openAt = (vocalRest: number): number => {
    const target = { ...IDENTITY_DRIVER, jaw: 0 }
    applyAnime25DStylizedExpression(target, semantic, stylized, vocalRest, 0, 1)
    return target.jaw
  }

  const free = openAt(1)
  const taken = openAt(0)
  assert.ok(free > taken)
  const half = openAt(0.5)
  assert.ok(
    Math.abs(half - (free + taken) / 2) < 1e-12,
    `half share gave ${half}, between ${taken} and ${free}`,
  )
  for (const rest of [-1, 2]) {
    assert.ok(openAt(rest) >= taken && openAt(rest) <= free)
  }
})
test('an idle mood colours a free mouth but yields it to a voice or a song', () => {
  const none = { gaze: 0, headBody: 0, expression: 0 }
  const random = { gaze: 1, headBody: 1, expression: 1 }
  const stylized = new StylizedExpressionMotionController().sample(0, 0, 0, 0, 0, 0)
  const compose = (speechMouth: number, grooveMouth: number) => {
    const target = { ...IDENTITY_DRIVER }
    applyAnime25DComposedPose(
      target,
      { ambient: none, random, groove: none, thinking: none, performance: none, stylized: none, coSpeech: none, speechMouth, grooveMouth },
      {
        ambient: { angleX: 0, angleY: 0, angleZ: 0, body: 0, eyeX: 0, eyeY: 0 },
        randomAction: {
          angleX: 0, angleY: 0, angleZ: 0, body: 0, eyeX: 0, eyeY: 0, brow: 0, browAngSym: 0,
          eyeOpen: -0.2, irisScale: 0, eyeSmile: 0.3, eyeWide: 0, wink: 0, mouthForm: 0.4, mouthOpen: 0.3, mouthRound: 0.2,
          armY: 0, armPos: 0, ambientScale: 1,
        },
        groove: { angleX: 0, angleY: 0, angleZ: 0, body: 0, armY: 0, armPos: 0, eyeX: 0, brow: 0 },
        thinking: { angleX: 0, angleY: 0, angleZ: 0, eyeX: 0, eyeY: 0, brow: 0, mouthCY: 0, mouthCAng: 0, mouthScale: 0 },
        idleSway: { angleX: 0, angleY: 0, angleZ: 0, body: 0 },
        performance: intentExpressionOffset('think', 0),
        stylized,
        coSpeech: { brow: 0, eyeOpen: 0, angleY: 0, angleZ: 0, body: 0 },
      },
      zeroOccupancyOffset(),
    )
    return target
  }
  const idle = compose(0, 0)
  assert.ok(idle.lipCurve > 0.3 && idle.jaw > 0.2 && idle.mouthRound > 0.1)
  for (const owned of [compose(1, 0), compose(0, 1)]) {
    assert.equal(owned.lipCurve, IDENTITY_DRIVER.lipCurve)
    assert.equal(owned.jaw, IDENTITY_DRIVER.jaw)
    assert.equal(owned.mouthRound, IDENTITY_DRIVER.mouthRound)
    // The eyes still carry the mood while she talks.
    assert.ok(owned.lidL < 1)
  }
})
test('a wink closes one eye and leaves the other open', () => {
  const none = { gaze: 0, headBody: 0, expression: 0 }
  const random = { gaze: 1, headBody: 1, expression: 1 }
  const stylized = new StylizedExpressionMotionController().sample(0, 0, 0, 0, 0, 0)
  const target = { ...IDENTITY_DRIVER }
  applyAnime25DComposedPose(
    target,
    { ambient: none, random, groove: none, thinking: none, performance: none, stylized: none, coSpeech: none, speechMouth: 0, grooveMouth: 0 },
    {
      ambient: { angleX: 0, angleY: 0, angleZ: 0, body: 0, eyeX: 0, eyeY: 0 },
      randomAction: {
        angleX: 0, angleY: 0, angleZ: 0, body: 0, eyeX: 0, eyeY: 0, brow: 0, browAngSym: 0,
        eyeOpen: 0, irisScale: 0, eyeSmile: 0, eyeWide: 0, wink: 0.95, mouthForm: 0, mouthOpen: 0, mouthRound: 0,
        armY: 0, armPos: 0, ambientScale: 1,
      },
      groove: { angleX: 0, angleY: 0, angleZ: 0, body: 0, armY: 0, armPos: 0, eyeX: 0, brow: 0 },
      thinking: { angleX: 0, angleY: 0, angleZ: 0, eyeX: 0, eyeY: 0, brow: 0, mouthCY: 0, mouthCAng: 0, mouthScale: 0 },
      idleSway: { angleX: 0, angleY: 0, angleZ: 0, body: 0 },
      performance: intentExpressionOffset('think', 0),
      stylized,
      coSpeech: { brow: 0, eyeOpen: 0, angleY: 0, angleZ: 0, body: 0 },
    },
    zeroOccupancyOffset(),
  )
  assert.ok(target.lidL < 0.1, `${target.lidL}`)
  assert.equal(target.lidR, IDENTITY_DRIVER.lidR)
})

test('stylized target resolution reuses output and keeps special-eye blocking', () => {
  const target: Anime25DDriver = {
    ...IDENTITY_DRIVER,
    eyeCry: 0.18,
    eyeDizzy: 0.1,
    anger: 0.44,
    speechless: 0.2,
    maniac: 0.35,
    silly: 0.28,
    lovestruck: 0.16,
  }
  const semantic = {
    brow: 0,
    browAngSym: 0,
    eyeOpen: 0,
    eyeDizzy: 0.12,
    eyeSqueeze: 0.08,
    eyeCry: 0.15,
    eyeX: 0,
    eyeY: 0,
    mouthForm: 0,
    irisScale: 0,
    angleY: 0,
    angleZ: 0,
    anger: 0.21,
    speechless: 0.13,
    maniac: 0.19,
    silly: 0.17,
    lovestruck: 0.11,
  }
  const output = { anger: 0, speechless: 0, maniac: 0, silly: 0, lovestruck: 0 }
  const actual = resolveAnime25DStylizedTargets(output, target, semantic)
  const blocker =
    1 -
    Math.max(
      mixBoundedExpressionChannel(target.eyeDizzy, semantic.eyeDizzy, 0, 1, 0),
      mixBoundedExpressionChannel(
        target.eyeSqueeze,
        semantic.eyeSqueeze,
        0,
        1,
        0,
      ),
      mixBoundedExpressionChannel(target.eyeCry, semantic.eyeCry, 0, 1, 0),
    )

  assert.equal(actual, output)
  assert.deepEqual(actual, {
    anger:
      mixBoundedExpressionChannel(target.anger, semantic.anger, 0, 1, 0) *
      blocker,
    speechless:
      mixBoundedExpressionChannel(
        target.speechless,
        semantic.speechless,
        0,
        1,
        0,
      ) * blocker,
    maniac:
      mixBoundedExpressionChannel(target.maniac, semantic.maniac, 0, 1, 0) *
      blocker,
    silly:
      mixBoundedExpressionChannel(target.silly, semantic.silly, 0, 1, 0) *
      blocker,
    lovestruck:
      mixBoundedExpressionChannel(
        target.lovestruck,
        semantic.lovestruck,
        0,
        1,
        0,
      ) * blocker,
  })
})
