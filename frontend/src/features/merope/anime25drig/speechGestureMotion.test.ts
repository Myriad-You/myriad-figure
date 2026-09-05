import assert from 'node:assert/strict'
import test from 'node:test'
import { HumanPerformanceRuntime } from '../motion/humanPerformanceRuntime'
import { compileSpeechBehaviorPlan } from '../motion/speechBehaviorPlan'
import { predictTextProsody } from '../speech/textProsody'
import { meropeSpeechEventDetail } from '../speechEvents'
import { Anime25DBehaviorMotionController } from './behaviorMotion'
import { realizeAnime25DBehaviorPlan } from './behaviorRealizer'
import { behaviorMotionScale } from './poseArbitration'
import { CoSpeechExpressionController } from './speechExpression'

function pipeline(text: string) {
  const prosody = predictTextProsody({
    text,
    utteranceId: 'gesture',
    startedAtMs: 0,
  })
  const detail = meropeSpeechEventDetail({
    source: 'reply',
    messageId: 'message',
    utteranceId: 'gesture',
    phase: 'prosody',
    prosody,
  })
  assert.equal(detail?.phase, 'prosody')
  if (detail?.phase !== 'prosody') throw new Error('missing prosody')
  const plan = compileSpeechBehaviorPlan(detail.prosody)
  const runtime = new HumanPerformanceRuntime()
  const frame = runtime.frame([plan], 0)
  const realized = realizeAnime25DBehaviorPlan(frame.plan!, 0)
  assert.equal(realized.units.length, plan.behaviors.length)
  const motion = new Anime25DBehaviorMotionController()
  motion.replace(realized.units, 0, 0)
  return { motion, units: realized.units, plan }
}

test('question, contrast and laughter reach distinct physical poses through the full behavior path', () => {
  const results = ['你确定吗？', '不过我有个想法。', '哈哈哈！'].map((text) => {
    const { motion, units } = pipeline(text)
    const gesture = units.find((unit) =>
      ['question', 'contrast', 'laugh'].includes(unit.form),
    )!
    assert.ok(gesture)
    const expression = new CoSpeechExpressionController()
    let output = expression.sample(0, true, null, 0, 0, 0)
    for (let at = 0; at <= gesture.timing.strokePeakMs + 180; at += 1000 / 60) {
      const sample = motion.sample(at / 1_000)
      output = expression.sample(
        at / 1_000,
        true,
        null,
        0,
        0,
        0,
        sample.coSpeechQuality,
        sample.coSpeechGesture,
      )
    }
    return { ...output }
  })
  assert.ok(results[0]!.angleZ > 0.08)
  assert.ok(results[0]!.brow > results[1]!.brow)
  assert.ok(results[1]!.angleZ < -0.05)
  assert.ok(results[1]!.body < -0.08)
  assert.ok(results[2]!.eyeOpen < -0.06)
  assert.ok(Math.abs(results[2]!.angleY) > 0.01)
})

test('a restated laugh retains its phase and cancellation releases the whole gesture', () => {
  const { motion, units } = pipeline('哈哈哈！')
  const peak = units.find((unit) => unit.form === 'laugh')!.timing.strokePeakMs
  const now = peak + 130
  const before = { ...motion.sample(now / 1_000).coSpeechGesture }
  motion.replace(units, now, now / 1_000)
  assert.deepEqual(motion.sample(now / 1_000).coSpeechGesture, before)
  motion.clear(now / 1_000)
  const later = motion.sample(now / 1_000 + 1)
  assert.equal(later.coSpeech, 0)
  assert.deepEqual(later.coSpeechGesture, {
    question: 0,
    contrast: 0,
    laugh: 0,
    laughPulse: 0,
  })
})

test('semantic recovery leaves no residual pose when the empty-plan gate returns to fallback', () => {
  const { motion, units } = pipeline('哈哈哈！')
  const peak = units.find((unit) => unit.form === 'laugh')!.timing.strokePeakMs
  const expression = new CoSpeechExpressionController()
  let last = 0
  let largestStep = 0
  let final = 0
  for (let frame = 0; frame <= 120; frame++) {
    const now = peak + (frame * 1000) / 60
    if (frame === 12) motion.clear(now / 1000)
    const sample = motion.sample(now / 1000)
    const pose = expression.sample(
      now / 1000,
      true,
      null,
      0,
      0,
      0,
      sample.coSpeechQuality,
      sample.coSpeechGesture,
    )
    final =
      pose.body * behaviorMotionScale(sample.coSpeech, sample.coSpeechPower)
    if (frame) largestStep = Math.max(largestStep, Math.abs(final - last))
    last = final
  }
  assert.ok(largestStep < 0.075, `largest body step: ${largestStep}`)
  assert.equal(final, 0)
})

test('overlapping phrase gestures blend within one budget rather than add full-strength poses', () => {
  const { motion, units } = pipeline('你确定吗？')
  const question = units.find((unit) => unit.form === 'question')!
  motion.replace(
    [
      ...units,
      { ...question, behaviorId: 'contrast-overlap', form: 'contrast' },
    ],
    0,
    0,
  )
  const mix = motion.sample(question.timing.strokePeakMs / 1000).coSpeechGesture
  assert.ok(mix.question > 0 && mix.contrast > 0)
  assert.ok(mix.question + mix.contrast + mix.laugh <= 1)
})
