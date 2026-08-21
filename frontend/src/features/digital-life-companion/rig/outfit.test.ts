import type { CompanionRigManifest } from './types'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyOutfitSafetyEnvelopeInto,
  createOutfitProfile,
  inferOutfitProfileFromPartIds,
  OUTFIT_TOPOLOGIES,
} from './outfit'

test('owns a stable canonical topology order', () => {
  assert.deepEqual(OUTFIT_TOPOLOGIES, [
    'fitted',
    'short-skirt',
    'long-skirt',
    'long-coat',
    'wide-sleeve',
    'cape',
    'armor',
  ])
})

test('composes mixed topology safety for torso and secondary layers', () => {
  assert.deepEqual(
    createOutfitProfile(['armor', 'long-skirt', 'wide-sleeve']),
    {
      topologies: ['long-skirt', 'wide-sleeve', 'armor'],
      secondaryPartIds: [],
      torsoTwistScale: 0.62,
      secondaryMotionScale: 0.45,
    },
  )
})

test('infers topology and secondary motion parts from semantic ids', () => {
  assert.deepEqual(
    inferOutfitProfileFromPartIds([
      'body',
      'long-skirt-front',
      'left-wide-sleeve',
      'armor-chest',
    ]),
    {
      topologies: ['long-skirt', 'wide-sleeve', 'armor'],
      secondaryPartIds: ['long-skirt-front', 'left-wide-sleeve'],
      torsoTwistScale: 0.62,
      secondaryMotionScale: 0.45,
    },
  )
})

test('uses fitted defaults and de-duplicates secondary parts', () => {
  assert.deepEqual(createOutfitProfile([], ['front-hair', 'front-hair']), {
    topologies: ['fitted'],
    secondaryPartIds: ['front-hair'],
    torsoTwistScale: 1,
    secondaryMotionScale: 1,
  })
})

test('limits torso motion without deforming whole-layer handwear', () => {
  const manifest = {
    bones: [
      { id: 'root', parent: null, pivot: { x: 0.5, y: 0.8 } },
      { id: 'body', parent: 'root', pivot: { x: 0.5, y: 0.5 } },
      { id: 'head', parent: 'body', pivot: { x: 0.5, y: 0.25 } },
      {
        id: 'a25d-handwear',
        parent: 'body',
        pivot: { x: 0.5, y: 0.68 },
      },
    ],
    outfitProfile: createOutfitProfile(['long-skirt', 'armor']),
  } as CompanionRigManifest
  const pose = manifest.bones.map(() => ({
    translation: { x: 0.1, y: 0.1 },
    rotation: 1,
    scale: { x: 1, y: 1 },
  }))
  assert.equal(
    applyOutfitSafetyEnvelopeInto(
      pose,
      manifest,
      manifest.bones.map(() => true),
    ),
    true,
  )
  assert.equal(pose[0].rotation, 0.62)
  assert.equal(pose[1].rotation, 0.62)
  assert.equal(pose[3].rotation, 1)
  assert.equal(pose[0].translation.x, 0.1)
  assert.equal(pose[1].translation.x, 0.062)
})
