import assert from 'node:assert/strict'
import test from 'node:test'
import { PERFORMANCE_CUE_DEFINITIONS } from '../anime25drig/performanceCueDefinitions'
import {
  legacyChannelsForResources,
  resourceInGroup,
  resourcesConflict,
  resourcesForLegacyChannels,
} from './behaviorResources'

test('resource hierarchy permits independent limbs but conflicts with parents', () => {
  assert.equal(resourcesConflict('body.arm.left', 'body.arm.right'), false)
  assert.equal(resourcesConflict('body.arm', 'body.arm.left'), true)
  assert.equal(resourceInGroup('body.hand.left', 'body'), true)
  assert.equal(resourceInGroup('face.gaze', 'body'), false)
})

test('coarse channel names remain a loss-aware compatibility projection', () => {
  assert.deepEqual(
    legacyChannelsForResources(['face.expression', 'body.arm.left']),
    ['expression', 'headBody'],
  )
  assert.deepEqual(resourcesForLegacyChannels(['gaze', 'headBody']), [
    'face.gaze',
    'body.head',
    'body.torso',
    'body.arm.left',
    'body.arm.right',
  ])
})

test('every cue keeps its compatibility channel map aligned with resources', () => {
  for (const [intent, definition] of Object.entries(
    PERFORMANCE_CUE_DEFINITIONS,
  )) {
    assert.deepEqual(
      legacyChannelsForResources(definition.resources),
      definition.channels,
      intent,
    )
  }
})
