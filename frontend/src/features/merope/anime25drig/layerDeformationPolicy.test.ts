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
    },
  )
})
