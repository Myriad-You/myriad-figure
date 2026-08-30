import type {
  PerformanceCue,
  PerformanceDirective,
  PerformancePhase,
} from '../../../services/agent/types'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyPerformanceExpressionOffset,
  baselineExpressionOffset,
  expressionCueOffset,
  mixBoundedExpressionChannel,
  mixEyeOpen,
  PerformanceDirectiveGate,
  PerformanceExpressionController,
  performancePhaseRank,
} from './performanceExpression'

const steadyBaseline = {
  expression: 'steady' as const,
  posture: 'neutral' as const,
  motionEnergy: 1,
  attention: 1,
}

function cue(
  intent: PerformanceCue['intent'],
  interrupt: PerformanceCue['interrupt'] = 'replace',
  atMs = 0,
): PerformanceCue {
  return {
    intent,
    atMs,
    intensity: 1,
    tempo: 1,
    fadeInMs: 100,
    fadeOutMs: 200,
    interrupt,
  }
}

function directive(
  phase: PerformancePhase,
  moodRevision: number,
  expression: 'withdrawn' | 'subdued' | 'steady' | 'warm' = 'steady',
  cues: PerformanceCue[] = [],
): PerformanceDirective {
  return {
    phase,
    moodRevision,
    plan: {
      baseline: { ...steadyBaseline, expression },
      cues,
    },
  }
}

test('maps semantic baselines and cues to conservative expression offsets', () => {
  const warm = baselineExpressionOffset({
    ...steadyBaseline,
    expression: 'warm',
  })
  const withdrawn = baselineExpressionOffset({
    ...steadyBaseline,
    expression: 'withdrawn',
  })
  const delight = expressionCueOffset({
    ...cue('delight'),
    intensity: 1.4,
  })
  const dizzy = expressionCueOffset({
    ...cue('dizzy'),
    intensity: 1.4,
  })
  const think = expressionCueOffset({
    ...cue('think'),
    intensity: 1.4,
  })
  const cry = expressionCueOffset({
    ...cue('cry'),
    intensity: 1.2,
  })
  const angry = expressionCueOffset(cue('angry'))
  const speechless = expressionCueOffset(cue('speechless'))
  const maniac = expressionCueOffset(cue('maniac'))
  const silly = expressionCueOffset(cue('silly'))
  const lovestruck = expressionCueOffset(cue('lovestruck'))

  assert.ok(warm.mouthForm > 0 && warm.mouthForm <= 0.12)
  assert.ok(withdrawn.eyeOpen < 0 && withdrawn.eyeOpen >= -0.08)
  assert.ok(Math.abs(delight.mouthForm) <= 0.26)
  assert.ok(Math.abs(delight.angleY) <= 0.05)
  assert.ok(delight.eyeSqueeze > 1.1 && delight.eyeSqueeze < 1.2)
  assert.equal(dizzy.eyeDizzy, 1)
  assert.equal(dizzy.eyeOpen, 0)
  assert.equal(dizzy.irisScale, 0)
  assert.equal(dizzy.angleZ, 0)
  assert.equal(dizzy.mouthForm, 0)
  assert.equal(think.eyeOpen, 0)
  assert.ok(think.eyeX > 0.4)
  assert.ok(think.eyeY < -0.3)
  assert.ok(think.angleZ < 0)
  assert.ok(think.brow > 0)
  assert.equal(cry.eyeCry, 1)
  assert.ok(cry.browAngSym < -0.3)
  assert.ok(cry.mouthForm < 0)
  assert.equal(angry.anger, 1)
  assert.equal(speechless.speechless, 1)
  assert.equal(maniac.maniac, 1)
  assert.equal(silly.silly, 1)
  assert.equal(silly.eyeX, 0)
  assert.equal(silly.eyeY, 0)
  assert.equal(lovestruck.lovestruck, 1)
  assert.deepEqual(Object.keys(warm).sort(), [
    'anger',
    'angleY',
    'angleZ',
    'armPos',
    'armY',
    'body',
    'brow',
    'browAngSym',
    'eyeCry',
    'eyeDizzy',
    'eyeOpen',
    'eyeSqueeze',
    'eyeX',
    'eyeY',
    'irisScale',
    'lovestruck',
    'maniac',
    'mouthForm',
    'silly',
    'speechless',
  ])
})

test('adds to manual channels without flattening left-right eye differences', () => {
  const target = {
    brow: 0.3,
    browAngSym: 0.1,
    eyeOpenL: 0.72,
    eyeOpenR: 0.91,
    eyeDizzy: 0,
    eyeSqueeze: 0,
    eyeCry: 0,
    mouthForm: -0.2,
    irisScale: 1.1,
    angleX: 0.6,
    angleY: 0.25,
    angleZ: -0.3,
    body: -0.4,
    eyeX: 0.35,
    eyeY: -0.25,
  }
  applyPerformanceExpressionOffset(target, {
    brow: 0.05,
    browAngSym: -0.04,
    eyeOpen: -0.04,
    eyeDizzy: 0,
    eyeSqueeze: 0,
    eyeCry: 0,
    eyeX: 0,
    eyeY: 0,
    mouthForm: 0.12,
    irisScale: 0.01,
    angleY: -0.03,
    angleZ: 0.02,
    body: 0,
    armY: 0,
    armPos: 0,
  })

  assert.ok(Math.abs(target.eyeOpenL - 0.68) < 1e-12)
  assert.ok(Math.abs(target.eyeOpenR - 0.87) < 1e-12)
  assert.ok(Math.abs(target.eyeOpenR - target.eyeOpenL - 0.19) < 1e-12)
  assert.ok(Math.abs(target.mouthForm - -0.08) < 1e-12)
  assert.ok(Math.abs(target.angleY - 0.22) < 1e-12)
  assert.equal(target.angleX, 0.6)
  assert.equal(target.body, -0.4)
  assert.equal(target.eyeX, 0.35)
  assert.equal(target.eyeY, -0.25)
  assert.ok(Math.abs(target.browAngSym - 0.06) < 1e-12)
})

test('never reopens an authored closed eye or closed-eye smile', () => {
  const wink = {
    brow: 0.2,
    browAngSym: 0,
    eyeOpenL: 0,
    eyeOpenR: 1,
    eyeDizzy: 0,
    eyeSqueeze: 0,
    eyeCry: 0,
    eyeX: 0,
    eyeY: 0,
    mouthForm: 0.7,
    irisScale: 1,
    angleY: 0,
    angleZ: 0,
  }
  applyPerformanceExpressionOffset(wink, {
    brow: 0.1,
    browAngSym: 0,
    eyeOpen: 0.04,
    eyeDizzy: 0,
    eyeSqueeze: 0,
    eyeCry: 0,
    eyeX: 0,
    eyeY: 0,
    mouthForm: 0.1,
    irisScale: 0,
    angleY: 0,
    angleZ: 0,
    body: 0,
    armY: 0,
    armPos: 0,
  })

  assert.equal(wink.eyeOpenL, 0)
  assert.equal(wink.eyeOpenR, 1)
  assert.equal(mixEyeOpen(0, 0.05), 0)
  assert.equal(mixEyeOpen(0, -0.05), 0)
  assert.ok(Math.abs(mixEyeOpen(0.04, -0.03) - 0.01) < 1e-12)
})

test('soft-limits additive expression near manual channel extremes', () => {
  const positive = mixBoundedExpressionChannel(0.95, 0.1, -1, 1, 0)
  const negative = mixBoundedExpressionChannel(-0.95, -0.1, -1, 1, 0)
  const combinedWarmDelight = mixBoundedExpressionChannel(
    0.75,
    0.12 + 0.18 * 1.4,
    -1,
    1,
    0,
  )
  assert.ok(positive > 0.95 && positive < 1)
  assert.ok(negative < -0.95 && negative > -1)
  assert.ok(combinedWarmDelight > 0.8 && combinedWarmDelight < 0.98)
  assert.equal(mixBoundedExpressionChannel(0.5, 0.1, -1, 1, 0), 0.6)
  assert.equal(mixBoundedExpressionChannel(1, -0.1, -1, 1, 0), 0.9)
  assert.equal(mixBoundedExpressionChannel(1, 0.1, -1, 1, 0), 1)
  assert.equal(mixBoundedExpressionChannel(-1, -0.1, -1, 1, 0), -1)
  for (let step = -99; step <= 99; step += 1) {
    const base = step / 100
    assert.ok(mixBoundedExpressionChannel(base, 0.4, -1, 1, 0) < 1)
    assert.ok(mixBoundedExpressionChannel(base, -0.4, -1, 1, 0) > -1)
  }
})

test('eases baseline changes without a first-frame jump or frame allocation', () => {
  const expression = new PerformanceExpressionController()
  assert.equal(expression.play(directive('delivery', 1, 'warm'), 0), true)
  const first = expression.sample(0)
  assert.deepEqual(
    { ...first },
    {
      brow: 0,
      browAngSym: 0,
      eyeOpen: 0,
      eyeDizzy: 0,
      eyeSqueeze: 0,
      eyeCry: 0,
      eyeX: 0,
      eyeY: 0,
      mouthForm: 0,
      irisScale: 0,
      angleY: 0,
      angleZ: 0,
      body: 0,
      armY: 0,
      armPos: 0,
      anger: 0,
      speechless: 0,
      maniac: 0,
      silly: 0,
      lovestruck: 0,
    },
  )
  const next = expression.sample(1 / 60)
  assert.equal(first, next)
  assert.ok(next.mouthForm > 0 && next.mouthForm < 0.12)
})

test('produces equivalent baseline easing at 30 and 60 FPS', () => {
  const thirty = new PerformanceExpressionController()
  const sixty = new PerformanceExpressionController()
  thirty.play(directive('delivery', 1, 'withdrawn'), 0)
  sixty.play(directive('delivery', 1, 'withdrawn'), 0)
  for (let frame = 1; frame <= 30; frame += 1) thirty.sample(frame / 30)
  for (let frame = 1; frame <= 60; frame += 1) sixty.sample(frame / 60)

  const atThirty = { ...thirty.sample(1) }
  const atSixty = { ...sixty.sample(1) }
  for (const key of Object.keys(atThirty) as Array<keyof typeof atThirty>) {
    assert.ok(Math.abs(atThirty[key] - atSixty[key]) < 1e-9)
  }
  assert.ok(
    Math.abs(thirty.getAmbientMotionScale() - sixty.getAmbientMotionScale()) <
      1e-9,
  )
})

test('uses attention only to symmetrically restrain ambient wandering', () => {
  const focused = new PerformanceExpressionController()
  const unfocused = new PerformanceExpressionController()
  focused.play(
    {
      ...directive('delivery', 1),
      plan: {
        baseline: { ...steadyBaseline, attention: 1 },
        cues: [],
      },
    },
    0,
  )
  unfocused.play(
    {
      ...directive('delivery', 1),
      plan: {
        baseline: { ...steadyBaseline, attention: 0 },
        cues: [],
      },
    },
    0,
  )
  for (let frame = 1; frame <= 60; frame += 1) {
    focused.sample(frame / 60)
    unfocused.sample(frame / 60)
  }

  assert.ok(focused.getAmbientMotionScale() < 0.71)
  assert.equal(unfocused.getAmbientMotionScale(), 1)
})

test('fades a semantic cue in and out back to its baseline', () => {
  const expression = new PerformanceExpressionController()
  expression.play(directive('delivery', 1, 'steady', [cue('question')]), 0)

  assert.equal(expression.sample(0).brow, 0)
  assert.ok(expression.sample(0.05).brow > 0)
  assert.equal(expression.sample(0.2).brow, 0.08)
  assert.ok(Math.abs(expression.sample(1.03).brow) < 1e-9)
})

test('does not replay an expired cue after a long rendering gap', () => {
  const expression = new PerformanceExpressionController()
  expression.play(directive('delivery', 1, 'steady', [cue('question')]), 10)
  assert.equal(expression.sample(10).brow, 0)
  assert.equal(expression.sample(18).brow, 0)

  const restoredPlayer = new PerformanceExpressionController()
  restoredPlayer.play(
    directive('delivery', 1, 'steady', [cue('question')]),
    18,
    10,
  )
  assert.equal(restoredPlayer.sample(18).brow, 0)
})

test('prunes expired expression cues during long-lived proactive playback', () => {
  const controller = new PerformanceExpressionController()
  for (let index = 0; index < 80; index += 1) {
    controller.play(
      directive('proactive', 12, 'steady', [
        {
          ...cue('notify'),
          intensity: 0.8 + index / 1_000,
        },
      ]),
      index * 2,
    )
    controller.sample(index * 2 + 1.9)
  }
  assert.ok(controller.getScheduledCueCount() <= 1)
})

test('bounds duplicate history during a long-lived mood revision', () => {
  const gate = new PerformanceDirectiveGate()
  const first = directive('proactive', 7, 'steady', [cue('listen')])
  assert.equal(gate.accept(first), 'supersede')
  for (let index = 1; index <= 32; index += 1) {
    assert.equal(
      gate.accept(
        directive('proactive', 7, 'steady', [cue('listen', 'replace', index)]),
      ),
      'accept',
    )
  }
  assert.equal(gate.accept(first), 'accept')
  assert.equal(gate.accept(first), 'reject')
})

test('queues cues after the active envelope instead of stacking them', () => {
  const expression = new PerformanceExpressionController()
  expression.play(
    directive('delivery', 1, 'steady', [
      cue('question'),
      cue('notify', 'queue'),
    ]),
    0,
  )

  assert.ok(expression.sample(0.5).angleZ > 0)
  assert.ok(expression.sample(1.07).angleZ < 0)
})

test('applies if-lower only when its priority exceeds the active cue', () => {
  const keepsHigher = new PerformanceExpressionController()
  keepsHigher.play(
    directive('delivery', 1, 'steady', [
      cue('delight'),
      cue('respond', 'if-lower'),
    ]),
    0,
  )
  assert.ok(keepsHigher.sample(0.2).mouthForm > 0)

  const replacesLower = new PerformanceExpressionController()
  replacesLower.play(
    directive('delivery', 1, 'steady', [
      cue('respond'),
      cue('notify', 'if-lower'),
    ]),
    0,
  )
  assert.ok(replacesLower.sample(0.2).angleZ < 0)
})

test('does not resume an older cue after a replacement finishes', () => {
  const expression = new PerformanceExpressionController()
  const longRespond = {
    ...cue('respond'),
    tempo: 0.5,
  }
  expression.play(
    directive('delivery', 1, 'steady', [
      longRespond,
      cue('notify', 'replace', 200),
    ]),
    0,
  )

  assert.ok(expression.sample(0.4).angleZ < 0)
  assert.deepEqual(
    { ...expression.sample(1.5) },
    {
      brow: 0,
      browAngSym: 0,
      eyeOpen: 0,
      eyeDizzy: 0,
      eyeSqueeze: 0,
      eyeCry: 0,
      eyeX: 0,
      eyeY: 0,
      mouthForm: 0,
      irisScale: 0,
      angleY: 0,
      angleZ: 0,
      body: 0,
      armY: 0,
      armPos: 0,
      anger: 0,
      speechless: 0,
      maniac: 0,
      silly: 0,
      lovestruck: 0,
    },
  )
})

test('cancels pending lower-phase cues when the same turn advances', () => {
  const expression = new PerformanceExpressionController()
  expression.play(
    directive('reaction', 2, 'steady', [cue('question', 'replace', 900)]),
    0,
  )
  expression.play(directive('delivery', 2, 'warm'), 0.2)

  assert.equal(expression.sample(1).angleZ, 0)
  assert.ok(expression.sample(1).mouthForm > 0)
})

test('rejects stale phases and duplicate plans but accepts independent proactive plans', () => {
  const expression = new PerformanceExpressionController()
  const reaction = directive('reaction', 4, 'steady', [cue('listen')])
  const delivery = directive('delivery', 4, 'warm', [cue('respond')])
  assert.equal(expression.play(reaction, 0), true)
  assert.equal(expression.play(delivery, 0.1), true)
  assert.equal(expression.play(directive('reaction', 4, 'subdued'), 0.2), false)
  assert.equal(expression.play(directive('delivery', 4, 'warm'), 0.3), true)
  assert.equal(expression.play(directive('proactive', 4, 'warm'), 0.4), true)
  assert.equal(expression.play(delivery, 0.5), false)
  assert.equal(expression.play(directive('outcome', 3), 0.6), false)
  assert.equal(performancePhaseRank('proactive'), null)
  assert.equal(performancePhaseRank('mood'), null)
})

test('replacing a cue crossfades instead of cutting the active face', () => {
  const expression = new PerformanceExpressionController()
  expression.play(
    directive('delivery', 1, 'steady', [
      cue('maniac'),
      cue('silly', 'replace', 200),
    ]),
    0,
  )
  const duringHold = expression.sample(0.19)
  assert.ok((duringHold.maniac ?? 0) > 0.9)
  assert.equal(duringHold.silly ?? 0, 0)
  const crossing = expression.sample(0.35)
  assert.ok((crossing.maniac ?? 0) > 0.3)
  assert.ok((crossing.silly ?? 0) > 0)
  const afterRelease = expression.sample(0.7)
  assert.ok((afterRelease.maniac ?? 0) < 0.05)
  assert.ok((afterRelease.silly ?? 0) > 0.9)
})

test('stopping an active sticker releases it into the resting baseline', () => {
  const expression = new PerformanceExpressionController()
  expression.play(directive('delivery', 1, 'warm', [cue('maniac')]), 0)
  for (let frame = 1; frame <= 12; frame += 1) {
    expression.sample(frame / 60)
  }
  const beforeStop = expression.sample(0.2)
  const beforeManiac = beforeStop.maniac ?? 0
  const beforeMouth = beforeStop.mouthForm
  assert.ok(beforeManiac > 0.9)
  expression.stop(0.2)
  const atStop = expression.sample(0.2)
  assert.equal(atStop.maniac ?? 0, beforeManiac)
  assert.ok(atStop.mouthForm > 0)
  assert.equal(atStop.mouthForm, beforeMouth)
  const midManiac = expression.sample(0.28).maniac ?? 0
  assert.ok(midManiac > 0)
  assert.ok(midManiac < beforeManiac)
  for (let frame = 1; frame <= 60; frame += 1) {
    expression.sample(0.2 + frame / 60)
  }
  const settled = expression.sample(1.2)
  assert.ok((settled.maniac ?? 0) < 0.001)
  assert.ok(settled.mouthForm < 0.001)
})

test('a later phase of the same turn releases the live face instead of dropping it', () => {
  const expression = new PerformanceExpressionController()
  expression.play(directive('reaction', 2, 'steady', [cue('maniac')]), 0)
  const live = expression.sample(0.15)
  assert.ok((live.maniac ?? 0) > 0.9)
  expression.play(directive('delivery', 2, 'warm'), 0.15)
  const handingOff = expression.sample(0.16)
  assert.ok((handingOff.maniac ?? 0) > 0.5)
  for (let frame = 1; frame <= 60; frame += 1) {
    expression.sample(0.15 + frame / 60)
  }
  const landed = expression.sample(1.15)
  assert.ok((landed.maniac ?? 0) < 0.001)
  assert.ok(landed.mouthForm > 0)
})

test('releases the semantic baseline smoothly when stopped', () => {
  const expression = new PerformanceExpressionController()
  expression.play(directive('delivery', 1, 'warm'), 0)
  for (let frame = 1; frame <= 60; frame += 1) {
    expression.sample(frame / 60)
  }
  const beforeStop = expression.sample(1).mouthForm
  expression.stop(1)
  const atStop = expression.sample(1).mouthForm
  for (let frame = 1; frame <= 60; frame += 1) {
    expression.sample(1 + frame / 60)
  }
  const released = expression.sample(2).mouthForm

  assert.equal(atStop, beforeStop)
  assert.ok(released > 0)
  assert.ok(released < 0.001)
})

test('face and body of one cue peak in the same envelope window', () => {
  const expression = new PerformanceExpressionController()
  expression.play(directive('delivery', 1, 'steady', [cue('greet')]), 0)
  const fadeIn = 0.1
  const holdMid = fadeIn + 0.36
  const peak = expression.sample(holdMid)
  assert.ok(peak.brow > 0.01)
  assert.ok(peak.body > 0.04)
  assert.ok(peak.armY > 0.05)
  const after = expression.sample(2.5)
  assert.ok(Math.abs(after.body) < 0.001)
  assert.ok(Math.abs(after.armY) < 0.001)
})

test('replacing a cue releases face and body together', () => {
  const expression = new PerformanceExpressionController()
  expression.play(directive('delivery', 1, 'steady', [cue('greet')]), 0)
  const greetPeak = expression.sample(0.4)
  assert.ok(greetPeak.body > 0.04)
  expression.play(
    directive('delivery', 1, 'steady', [cue('emphasize', 'replace', 0)]),
    0.4,
  )
  const handingOff = expression.sample(0.41)
  assert.ok(handingOff.body > 0)
  for (let frame = 1; frame <= 48; frame += 1) {
    expression.sample(0.4 + frame / 60)
  }
  const landed = expression.sample(1.2)
  assert.ok(landed.body > 0.1)
  assert.ok(Math.abs(landed.armY) < 0.02)
})
