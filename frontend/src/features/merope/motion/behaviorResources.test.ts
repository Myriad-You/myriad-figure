import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  PERFORMANCE_CUE_DEFINITIONS,
  performanceCueChannels,
} from '../anime25drig/performanceCueDefinitions'
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

test('coarse channels stay derived, never a second authored list', () => {
  const registry = source('../anime25drig/performanceCueDefinitions.ts')
  assert.doesNotMatch(registry, /^\s*channels: /m)
  for (const [intent, definition] of Object.entries(
    PERFORMANCE_CUE_DEFINITIONS,
  )) {
    assert.deepEqual(
      performanceCueChannels(intent as Parameters<typeof performanceCueChannels>[0]),
      legacyChannelsForResources(definition.resources),
      intent,
    )
  }
})

test('every cue declares the fine-grained resources its pose actually writes', () => {
  for (const [intent, definition] of Object.entries(
    PERFORMANCE_CUE_DEFINITIONS,
  )) {
    const resources = new Set<string>(definition.resources)
    const expression = definition.expression(1, 1)
    const driver = definition.driver(1)

    if (expression.angleY || expression.angleZ) {
      assert.equal(resources.has('body.head'), true, `${intent}: head`)
    }
    if (driver.body) {
      assert.equal(resources.has('body.torso'), true, `${intent}: torso`)
    }
    if (driver.armY || driver.armPos) {
      assert.equal(resources.has('body.arm.left'), true, `${intent}: left arm`)
      assert.equal(
        resources.has('body.arm.right'),
        true,
        `${intent}: right arm`,
      )
    }
    if (driver.bust !== undefined) {
      assert.equal(resources.has('secondary.bust'), true, `${intent}: bust`)
    }
    if (expression.eyeX || expression.eyeY) {
      assert.equal(resources.has('face.gaze'), true, `${intent}: gaze`)
    }
  }
})

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8')
}

test('the resource vocabulary matches the director contract and the rig boundary', () => {
  const local = source('./behaviorResources.ts')
  const summary = source('./rigStateSummary.ts')
  const contract = source('../../../../../crates/myriad-merope/src/rig_state.rs')
  const boundary = source('../rig/README.md')

  const block = /RIG_STATE_BEHAVIOR_RESOURCES: &\[&str\] = &\[([^\]]*)\]/.exec(
    contract,
  )?.[1]
  assert.ok(block, 'director contract has no RIG_STATE_BEHAVIOR_RESOURCES block')
  const declared = [...block.matchAll(/"([a-z.]+)"/g)].map((match) => match[1])
  assert.ok(declared.length > 0, 'director contract listed no resources')
  for (const resource of declared) {
    assert.match(local, new RegExp(`\\| '${resource}'`), resource)
    assert.match(summary, new RegExp(`'${resource}',`), resource)
  }

  // The rig IR has no leg, foot or locomotion role, so no behavior may name one.
  assert.match(boundary, /no shoulder, elbow, wrist, leg, foot/)
  for (const forbidden of ['legs', 'foot', 'feet', 'locomotion']) {
    assert.doesNotMatch(local, new RegExp(`body\\.${forbidden}`), forbidden)
    assert.doesNotMatch(contract, new RegExp(`body\\.${forbidden}`), forbidden)
  }
})
