import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_RIG_BONES,
  MIN_SUPPORTED_RIG_IR_VERSION,
  RIG_IR_VERSION,
  RIG_MATRIX_CAPACITY,
} from './contract'
import { writeBoneMatrices } from './matrices'
import { VERTEX_SHADER } from './webgl'

test('keeps one explicit legacy IR readable while new imports use current IR', () => {
  assert.equal(MIN_SUPPORTED_RIG_IR_VERSION, 2)
  assert.equal(RIG_IR_VERSION, 4)
})

test('GPU capacity covers every manifest bone accepted by the contract', () => {
  assert.equal(MAX_RIG_BONES, 48)
  assert.ok(RIG_MATRIX_CAPACITY >= MAX_RIG_BONES)
  assert.match(VERTEX_SHADER, /u_bones\[48\]/)
})

test('matrix evaluation writes the final bone at maximum capacity', () => {
  const transforms = Array.from({ length: MAX_RIG_BONES }, () => ({
    translation: { x: 0.001, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
  }))
  const parents = Array.from({ length: MAX_RIG_BONES }, (_, index) =>
    index === 0 ? -1 : index - 1,
  )
  const pivots = Array.from({ length: MAX_RIG_BONES }, () => ({ x: 0, y: 0 }))
  const order = Array.from({ length: MAX_RIG_BONES }, (_, index) => index)
  const output = new Float32Array(RIG_MATRIX_CAPACITY * 9)
  writeBoneMatrices(
    output,
    new Float32Array(output.length),
    new Float32Array(output.length),
    transforms,
    parents,
    pivots,
    order,
  )
  const finalOffset = (MAX_RIG_BONES - 1) * 9
  assert.ok(output[finalOffset] > 0)
  assert.ok(Math.abs(output[finalOffset + 6] - 0.048) < 0.00001)
})
