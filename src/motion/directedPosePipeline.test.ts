import type { PerformanceDirective } from '@myriad-you/figure-player/contract'
import type { RigMotionPort } from '../rig/motionPort'
import assert from 'node:assert/strict'
import test from 'node:test'
import { Anime25DClosedEyePresentation, Anime25DIrisRebound, IDENTITY_DRIVER } from '@myriad-you/figure-player'
import { deriveAnime25DMotionEnvelopeProfile } from '@myriad-you/figure-player/internals'
import { realizeAnime25DBehaviorPlan } from '../anime25drig/behaviorRealizer'
import { Anime25DMotionComposer } from '../anime25drig/motionComposer'
import { bearingDriverPatch } from '../anime25drig/performanceExpression'
import { FigureChannel } from '../channel'
import { dispatchMeropePerformance } from '../events/performanceEvents'
import { dispatchMeropeSpeech } from '../speech/speechEvents'
import { applyMotionFrame, createMotionApplyState } from './applyFrame'
import { RigMotionCoordinator } from './coordinator'
import { IDLE_MOTION_POLICY } from './policy'
import { MotionRuntime } from './runtime'

test('model pose → channel → lifecycle → bearing → production writer → composer; cancellation releases it', () => {
  const figureChannel = new FigureChannel()
  const runtime = new MotionRuntime(new RigMotionCoordinator(), null, figureChannel)
  const release = runtime.retain()
  const current = { ...IDENTITY_DRIVER }
  const target = { ...IDENTITY_DRIVER, talking: false, autoBlink: false, idleSway: false }
  const composer = new Anime25DMotionComposer(current, new Anime25DClosedEyePresentation(), new Anime25DIrisRebound())
  composer.directedPose.setCapabilities(['head-body', 'torso-volume', 'left-arm', 'right-arm'])
  let time = 0
  let policy = IDLE_MOTION_POLICY
  let writes = 0
  const port: RigMotionPort = {
    setMotionPolicy: value => { policy = value },
    setBearing: value => {
      writes++
      Object.assign(target, bearingDriverPatch(value))
      composer.directedPose.set(value?.pose, time)
    },
    setMood: () => {}, setSpeechActive: () => {}, setAutoSpeech: () => {},
    setSpeechEnergy: () => {}, setSpeechArticulation: () => {}, setSpeechProsody: () => {}, enqueueSpeechText: () => {},
    setSinging: value => { target.singing = value }, setSingingTrack: () => {}, setMusicSignal: () => {},
    playBehaviorPlan: (plan) => {
      const nowMs = globalThis.performance.now()
      const realized = realizeAnime25DBehaviorPlan(plan, nowMs)
      composer.behaviorMotion.replace(realized.units, nowMs, time)
      composer.performanceExpression.playBehaviorUnits(realized.units, time, nowMs)
      return realized.reports
    },
    stopBehaviorPlan: () => { composer.behaviorMotion.clear(time); composer.performanceExpression.stopBehaviors(time) },
  }
  // As a page delivers a reply's performance: each delivery is a new motion intent.
  const deliver = (performance: PerformanceDirective) => dispatchMeropePerformance(figureChannel, {
    text: '', source: 'reply', messageId: 'directed-reply', performance, motionIntentId: figureChannel.newIntentId(),
  })
  const performance: PerformanceDirective = {
    phase: 'delivery', moodRevision: 999, motionStyle: 'open',
    plan: { baseline: { expression: 'steady', posture: 'neutral', attention: 1, motionEnergy: 1.3,
      pose: { targets: { headTurn: -0.85, torsoTurn: 0.8, torsoRise: 0.7, leftArmRaise: 0.9, rightArmRaise: 0 }, transitionMs: 250, holdMs: 0 } }, cues: [] },
  }
  const state = createMotionApplyState()
  const envelope = deriveAnime25DMotionEnvelopeProfile({ layers: [{ role: 'handwear' }] })
  const advance = (seconds: number) => {
    for (let i = 0; i < seconds * 120; i++) {
      time += 1 / 120
      applyMotionFrame(port, runtime.frame(), state)
      composer.step(1 / 120, { time, target, policy, mouse: { x: 0, y: 0, inside: false },
        speechActive: false, musicSignal: null, motionEnvelopeProfile: envelope })
    }
  }
  try {
    deliver(performance)
    assert.deepEqual(runtime.frame().bearing?.pose, performance.plan.baseline!.pose)
    advance(1)
    assert.equal(writes, 1, 'a stable bearing must not restart the pose every render frame')
    assert.ok(current.headYaw < -0.84 && current.torsoTurn > 0.79 && current.bodyLift > 0.69)
    assert.ok(current.armRaiseL > 0.89 && Math.abs(current.armRaiseR) < 0.0001)
    deliver({ ...performance, plan: { baseline: {
      ...performance.plan.baseline!, pose: { targets: { torsoRise: -0.7, headTurn: 0.8 }, transitionMs: 250, holdMs: 0 },
    }, cues: [] } })
    const before = current.headYaw
    advance(1 / 120)
    assert.ok(Math.abs(current.headYaw - before) < 0.05, 'revision starts at the actual ongoing pose')
    advance(1)
    assert.ok(current.headYaw > 0.79 && current.bodyLift < -0.69)
    dispatchMeropeSpeech(figureChannel, { phase: 'cancel', messageId: 'directed-reply', source: 'reply' })
    advance(1)
    assert.ok(Math.abs(current.torsoTurn) < 0.001 && Math.abs(current.bodyLift) < 0.001)
  } finally { release() }
})
