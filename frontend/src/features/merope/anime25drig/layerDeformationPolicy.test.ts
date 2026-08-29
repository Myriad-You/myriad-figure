import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveAnime25DLayerDeformationPolicy } from './layerDeformationPolicy'

const base = {
  fade: null,
  hairPhysics: false,
  hasBangWeights: false,
  hasFrontHairParallax: false,
  hasCollarContact: false,
} as const

test('keeps nonlinear face, clothing, hair and collar layers on the CPU path', () => {
  for (const policy of [
    resolveAnime25DLayerDeformationPolicy({ ...base, baseRole: 'face' }),
    resolveAnime25DLayerDeformationPolicy({ ...base, baseRole: 'topwear' }),
    resolveAnime25DLayerDeformationPolicy({
      ...base,
      baseRole: 'back_hair',
      hairPhysics: true,
    }),
    resolveAnime25DLayerDeformationPolicy({
      ...base,
      baseRole: 'collar_front',
      hasCollarContact: true,
    }),
  ]) {
    assert.equal(policy.localDynamic, true)
  }
})

test('allows global-only decorations and held shadows to skip uploads', () => {
  for (const policy of [
    resolveAnime25DLayerDeformationPolicy({ ...base, baseRole: 'accessory' }),
    resolveAnime25DLayerDeformationPolicy({
      ...base,
      baseRole: 'maniac_eye_shadow',
      fade: 'maniacEyeShadow',
    }),
  ]) {
    assert.deepEqual(policy, {
      shaderGlobalTransform: true,
      localDynamic: false,
      deformationExtensions: [],
    })
  }
})

test('moves global eye motion to the shader without skipping local eye work', () => {
  assert.deepEqual(
    resolveAnime25DLayerDeformationPolicy({
      ...base,
      baseRole: 'irides',
      fade: 'eyeOpen',
    }),
    {
      shaderGlobalTransform: true,
      localDynamic: true,
      deformationExtensions: [],
    },
  )
})

test('names every intentional geometry replacement at the policy boundary', () => {
  assert.deepEqual(
    resolveAnime25DLayerDeformationPolicy({
      ...base,
      baseRole: 'mouth_maniac',
      fade: 'mouthManiac',
    }).deformationExtensions,
    ['continuous-mouth-geometry', 'jaw-face-coupling'],
  )
  assert.deepEqual(
    resolveAnime25DLayerDeformationPolicy({
      ...base,
      baseRole: 'mouth_cry',
      fade: 'mouthCry',
    }).deformationExtensions,
    ['cry-mouth-geometry', 'jaw-face-coupling'],
  )
  assert.deepEqual(
    resolveAnime25DLayerDeformationPolicy({
      ...base,
      baseRole: 'front hair',
      hairPhysics: true,
      hasFrontHairParallax: true,
    }).deformationExtensions,
    ['length-scaled-hair-physics', 'front-hair-depth-release'],
  )
  assert.deepEqual(
    resolveAnime25DLayerDeformationPolicy({
      ...base,
      baseRole: 'collar_front',
      hasCollarContact: true,
    }).deformationExtensions,
    ['collar-contact', 'neck-collar-continuity'],
  )
})
