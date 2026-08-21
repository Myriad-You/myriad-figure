import assert from 'node:assert/strict'
import test from 'node:test'
import { companionPerformanceEventDetail } from './performanceEvents'

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
