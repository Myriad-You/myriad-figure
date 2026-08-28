import assert from 'node:assert/strict'
import test from 'node:test'
import {
  anime25DRuntimeKey,
  shouldAnimateAnime25D,
  shouldUseAnime25DRuntime,
} from './runtimePolicy'

test('falls back only for the exact runtime asset that failed', () => {
  const first = anime25DRuntimeKey('asset-a', 13, '/atlas-a.png')
  assert.equal(
    shouldUseAnime25DRuntime({
      hasManifest: true,
      hasPlayback: true,
      atlasUrl: '/atlas-a.png',
      runtimeKey: first,
      failedRuntimeKey: first,
    }),
    false,
  )
  const replacement = anime25DRuntimeKey('asset-b', 13, '/atlas-b.png')
  assert.equal(
    shouldUseAnime25DRuntime({
      hasManifest: true,
      hasPlayback: true,
      atlasUrl: '/atlas-b.png',
      runtimeKey: replacement,
      failedRuntimeKey: first,
    }),
    true,
  )
})

test('runs frames only after the atlas is ready and the canvas is visible', () => {
  const active = {
    atlasReady: true,
    pageVisible: true,
    inViewport: true,
    cancelled: false,
  }
  assert.equal(shouldAnimateAnime25D(active), true)
  for (const key of ['atlasReady', 'pageVisible', 'inViewport'] as const) {
    assert.equal(shouldAnimateAnime25D({ ...active, [key]: false }), false)
  }
  assert.equal(shouldAnimateAnime25D({ ...active, cancelled: true }), false)
})
