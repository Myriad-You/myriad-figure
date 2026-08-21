import assert from 'node:assert/strict'
import test from 'node:test'
import {
  companionPerformanceEventDetail,
  planCompanionPerformanceEvent,
} from './performanceEvents'

const state = {
  energy: 62,
  mood: 70,
  boredom: 24,
  curiosity: 68,
  social: 54,
  affection: 46,
}

test('bounds production performance events and defaults their source', () => {
  assert.deepEqual(
    companionPerformanceEventDetail({
      text: '  太好了！  ',
      source: 'unknown',
    }),
    { text: '太好了！', source: 'reply' },
  )
  assert.equal(companionPerformanceEventDetail({ text: '   ' }), null)
  assert.equal(companionPerformanceEventDetail(null), null)
})

test('uses a validated server plan before the deterministic text fallback', () => {
  const supplied = planCompanionPerformanceEvent(
    {
      text: '普通回复',
      source: 'reply',
      motionPlan: { performanceId: 'celebration' },
    },
    state,
  )
  assert.equal(supplied.performanceId, 'celebration')

  const fallback = planCompanionPerformanceEvent(
    { text: '太好了，谢谢！', source: 'reply' },
    state,
  )
  assert.equal(fallback.performanceId, 'celebration')
  assert.ok(fallback.cues.length > 0)
})
