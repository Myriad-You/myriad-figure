import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildChestWeightField,
  chestMotionTarget,
  createChestSpringState,
  sampleChestWeight,
  stepChestSpring,
} from './chestPhysics'

test('maps resolved horizontal and vertical pose travel to independent chest axes', () => {
  const reusableTarget = { x: 0, y: 0 }
  const horizontal = chestMotionTarget(
    { angleX: 1, angleY: 0, angleZ: 0, body: 0 },
    2,
    reusableTarget,
  )
  const vertical = chestMotionTarget(
    { angleX: 0, angleY: 1, angleZ: 0, body: 0 },
    2,
  )
  assert.equal(horizontal.x, 11)
  assert.equal(Math.abs(horizontal.y), 0)
  assert.equal(horizontal, reusableTarget)
  assert.equal(vertical.x, 0)
  assert.equal(vertical.y, -9)
})

test('extracts and bilinearly samples the authored chest joint weights', () => {
  const vertex = (x: number, y: number, chestWeight: number) => ({
    position: { x, y },
    joints: [0, 1, 0, 0],
    weights: [1 - chestWeight, chestWeight, 0, 0],
  })
  const field = buildChestWeightField({
    bones: [{ id: 'body' }, { id: 'a25d-chest' }],
    parts: [
      {
        id: 'a25d-topwear',
        vertices: [
          vertex(0, 0, 0),
          vertex(1, 0, 0.2),
          vertex(0, 1, 0.8),
          vertex(1, 1, 1),
        ],
      },
    ],
  })

  assert.ok(field)
  assert.ok(Math.abs(sampleChestWeight(field, 0.5, 0.5) - 0.5) < 1e-6)
  assert.equal(sampleChestWeight(field, -1, -1), 0)
  assert.equal(sampleChestWeight(field, 2, 2), 1)
})

test('two-axis chest spring lags moving poses and settles without permanent binding', () => {
  const state = createChestSpringState()
  stepChestSpring(state, 0, 0, 1 / 60)
  stepChestSpring(state, 6, -4, 1 / 60)
  assert.ok(state.offsetX < 0)
  assert.ok(state.offsetY > 0)

  for (let frame = 0; frame < 240; frame += 1) {
    stepChestSpring(state, 6, -4, 1 / 60)
  }
  assert.ok(Math.abs(state.offsetX) < 1e-5)
  assert.ok(Math.abs(state.offsetY) < 1e-5)
})

test('chest spring makes a controlled rebound after the pose stops', () => {
  const state = createChestSpringState()
  stepChestSpring(state, 0, 0, 1 / 60)

  let lag = 0
  let rebound = 0
  for (let frame = 0; frame < 120; frame += 1) {
    stepChestSpring(state, 6, 0, 1 / 60)
    lag = Math.min(lag, state.offsetX)
    rebound = Math.max(rebound, state.offsetX)
  }

  assert.ok(lag < -4)
  assert.ok(rebound > 0.7)
  assert.ok(rebound < Math.abs(lag) * 0.25)
  assert.ok(Math.abs(state.offsetX) < 0.01)
})

test('chest spring response stays stable across common render frame rates', () => {
  const simulate = (fps: number) => {
    const state = createChestSpringState()
    stepChestSpring(state, 0, 0, 1 / fps)
    for (let frame = 0; frame < fps / 2; frame += 1) {
      stepChestSpring(state, 6, -4, 1 / fps)
    }
    return state
  }

  const at30Fps = simulate(30)
  const at60Fps = simulate(60)
  assert.ok(Math.abs(at30Fps.offsetX - at60Fps.offsetX) < 0.02)
  assert.ok(Math.abs(at30Fps.offsetY - at60Fps.offsetY) < 0.02)
})
