import assert from 'node:assert/strict'
import test from 'node:test'
import { atlasToLocalUv, localToAtlasUv } from './atlasUv'

test('shared-atlas UV conversion preserves every layer-local coordinate', () => {
  const rect = { x: 0.25, y: 0.375, w: 0.125, h: 0.25 }
  for (const local of [
    [0, 0],
    [1, 1],
    [0.35, 0.72],
  ] as const) {
    const atlas = localToAtlasUv(rect, local[0], local[1])
    const roundTrip = atlasToLocalUv(rect, atlas[0], atlas[1])
    assert.ok(Math.abs(roundTrip[0] - local[0]) < 1e-12)
    assert.ok(Math.abs(roundTrip[1] - local[1]) < 1e-12)
  }
})

test('rejects a zero-area atlas rectangle before shader setup', () => {
  assert.throws(() => atlasToLocalUv({ x: 0, y: 0, w: 0, h: 1 }, 0, 0))
})
