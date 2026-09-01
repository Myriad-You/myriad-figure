import type { Anime25DMotionUnit } from './behaviorMotion'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  Anime25DBehaviorMotionController,
  completeBehaviorQuality,
} from './behaviorMotion'

function unit(
  family: Anime25DMotionUnit['family'] = 'co-speech',
): Anime25DMotionUnit {
  return {
    behaviorId: `${family}:unit`,
    family,
    form: family === 'music' ? 'groove' : 'accent',
    kind: family === 'music' ? 'rhythmic' : 'oneShot',
    timing: {
      startMs: 1_100,
      readyMs: 1_200,
      strokeStartMs: 1_300,
      strokePeakMs: 1_400,
      strokeEndMs: 1_500,
      relaxMs: 1_600,
      endMs: 1_800,
    },
    intensity: 1,
    quality: completeBehaviorQuality({ extent: 1.2, power: 1.1 }),
  }
}

test('samples seven-stage motion on the player clock and prunes at end', () => {
  const controller = new Anime25DBehaviorMotionController()
  controller.replace([unit()], 1_000, 5)
  assert.equal(controller.sample(5.05).coSpeech, 0)
  const preparing = controller.sample(5.25).coSpeech
  const peak = controller.sample(5.4).coSpeech
  assert.ok(preparing > 0)
  assert.ok(peak > preparing)
  assert.equal(controller.sample(5.8).coSpeech, 0)
  assert.equal(controller.sample(6).coSpeech, 0)
})

test('sustained rhythm remains active until explicitly replaced', () => {
  const controller = new Anime25DBehaviorMotionController()
  const sustained = unit('music')
  sustained.timing.relaxMs = null
  sustained.timing.endMs = null
  controller.replace([sustained], 1_000, 2)
  assert.ok(controller.sample(4).music > 0.7)
  controller.clear()
  assert.equal(controller.sample(4.1).music, 0)
})

test('replacement preserves wall-clock age across different player origins', () => {
  const controller = new Anime25DBehaviorMotionController()
  controller.replace([unit()], 1_350, 9)
  const nearPeak = controller.sample(9.05).coSpeech
  assert.ok(nearPeak > 0.8)
})
