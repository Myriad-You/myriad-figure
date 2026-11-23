import type { PoseFigure } from './poseFrame'
import assert from 'node:assert/strict'
import test from 'node:test'
import { figureKey } from './poseFrame'

function figure(...sources: object[]): PoseFigure {
  return {
    layers: sources.map(source => ({ source })),
    collarClip: null,
    armVariants: { modelledArms: () => [] },
    mouth: null,
  } as unknown as PoseFigure
}

test('a package written out again is the same figure: keys in another order, numbers one last place off', () => {
  const layer = { name: 'face', x: 1234.565, y: 0.1 + 0.2, atlas: { x: 0.25, y: 0.5 }, side: undefined, armVariant: { gesture: 'wave', model: { radius: [1, 2.005] } } }
  const again = { armVariant: { model: { radius: [1, 2.005 * (1 + Number.EPSILON)] }, gesture: 'wave' }, atlas: { y: 0.5, x: 0.25 }, y: 0.3, x: 1234.565 * (1 - Number.EPSILON), name: 'face' }
  assert.equal(figureKey(figure(again)), figureKey(figure(layer)))
})

test('another layer, another place of one or another arm on it is another figure', () => {
  const layer = { name: 'face', x: 10, armVariant: { gesture: 'wave', model: { radius: [1, 2] } } }
  const key = figureKey(figure(layer))
  for (const other of [
    figure({ ...layer, name: 'nose' }),
    figure({ ...layer, x: 10.001 }),
    figure({ ...layer, armVariant: { gesture: 'wave', model: { radius: [1, 2.001] } } }),
    figure(layer, layer),
    { ...figure(layer), mouth: {} } as PoseFigure,
  ]) assert.notEqual(figureKey(other), key)
})
