import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildChestWeightField,
  chestDeformationWeight,
  chestFollowMix,
  chestMotionTarget,
  chestProfileUsesGeometryWeights,
  chestResponseMix,
  createChestSpringState,
  resolveChestDeformationRegion,
  resolveChestDynamics,
  resolveChestMotionScale,
  sampleChestWeight,
  stepChestSpring,
  topwearMotionAtChest,
} from './chestPhysics'

test('repairs a cleavage-sized AI region into a paired volume envelope', () => {
  const region = resolveChestDeformationRegion(
    {
      source: 'ai-vision',
      centerX: 542,
      centerY: 1014,
      radiusX: 102,
      radiusY: 84,
      visibleScale: 0.55,
    },
    {
      faceWidth: 335,
      faceHeight: 451,
      neckBottom: 799,
      fallbackCenterX: 546,
      fallbackCenterY: 1069,
      fallbackRadiusX: 201,
      fallbackRadiusY: 203,
    },
  )
  assert.ok(region.centerY > 1046)
  assert.ok(region.radiusX > 206)
  assert.ok(region.radiusY > 151)
})

test('AI deformation peaks on the paired lobes instead of the sternum', () => {
  const center = chestDeformationWeight('ai-vision', 0, 0, 1)
  const left = chestDeformationWeight('ai-vision', -0.58, 0, 1)
  const right = chestDeformationWeight('ai-vision', 0.58, 0, 1)
  assert.ok(center < left)
  assert.equal(left, right)
  assert.equal(left, 1)
})

test('uses one authoritative chest region instead of intersecting AI with geometry', () => {
  assert.equal(
    chestProfileUsesGeometryWeights({ enabled: true, source: 'ai-vision' }),
    false,
  )
  assert.equal(
    chestProfileUsesGeometryWeights({
      enabled: true,
      source: 'geometry-fallback',
    }),
    true,
  )
  assert.equal(
    chestProfileUsesGeometryWeights({
      enabled: false,
      source: 'gender-policy',
    }),
    false,
  )
  assert.equal(chestProfileUsesGeometryWeights(undefined), true)
})

test('restrains small AI profiles with a smooth size cap', () => {
  const resolve = (visibleScale: number, motionScale = 1.14) =>
    resolveChestMotionScale({
      enabled: true,
      source: 'ai-vision',
      visibleScale,
      motionScale,
    })

  assert.ok(Math.abs(resolve(0.35, 0.958) - 0.4585) < 0.001)
  assert.ok(resolve(0.2) < resolve(0.35))
  assert.ok(resolve(0.35) < resolve(0.5))
  assert.ok(resolve(0.5) < resolve(0.8))
  assert.equal(resolve(0.35, 0.3), 0.3)
  assert.equal(
    resolveChestMotionScale({
      enabled: true,
      source: 'geometry-fallback',
      visibleScale: 0.35,
      motionScale: 1,
    }),
    1,
  )
  assert.equal(
    resolveChestMotionScale({
      enabled: false,
      source: 'gender-policy',
      visibleScale: 0,
      motionScale: 0,
    }),
    0,
  )
})

test('combines apparent size with garment support without losing bounded control', () => {
  const freelyVisible = resolveChestDynamics({
    enabled: true,
    source: 'ai-vision',
    visibleScale: 0.8,
    motionScale: 1.14,
    frequencyScale: 0.94,
    supportScale: 0.15,
    garmentMotionScale: 0.95,
  })
  const structured = resolveChestDynamics({
    enabled: true,
    source: 'ai-vision',
    visibleScale: 0.8,
    motionScale: 1.14,
    frequencyScale: 0.94,
    supportScale: 0.9,
    garmentMotionScale: 0.2,
  })
  const small = resolveChestDynamics({
    enabled: true,
    source: 'ai-vision',
    visibleScale: 0.3,
    motionScale: 0.36,
    frequencyScale: 1.06,
    supportScale: 0.15,
    garmentMotionScale: 0.95,
  })

  assert.ok(freelyVisible.responseScale > structured.responseScale)
  assert.ok(freelyVisible.followScale > structured.followScale)
  assert.ok(small.followScale < freelyVisible.followScale * 0.35)
  assert.ok(small.responseScale < freelyVisible.responseScale * 0.15)
  assert.ok(freelyVisible.followScale >= freelyVisible.responseScale)
  assert.ok(freelyVisible.frequencyScale < structured.frequencyScale)
  assert.ok(freelyVisible.dampingScale < structured.dampingScale)
  assert.ok(chestResponseMix(2.5, freelyVisible.responseScale) <= 0.94)
  assert.ok(chestFollowMix(2.5, freelyVisible.followScale) <= 1)
  assert.ok(chestResponseMix(2.5, 0.5) > 0.5)
  assert.ok(chestFollowMix(2.5, 0.5) > 0.5)
  assert.equal(chestResponseMix(0, freelyVisible.responseScale), 0)
})

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
  const parentHorizontal = topwearMotionAtChest(
    { angleX: 1, angleY: 0, angleZ: 0, body: 0 },
    {
      faceScale: 2,
      faceCenterY: 0,
      neckX: 0,
      neckY: 0,
      centerX: 0,
      centerY: 0,
      depth: 1,
    },
  )
  const wholeBodyRotation = chestMotionTarget(
    { angleX: 0, angleY: 0, angleZ: 0, body: 1 },
    2,
  )
  assert.equal(horizontal.x, 11)
  assert.equal(Math.abs(horizontal.y), 0)
  assert.equal(horizontal, reusableTarget)
  assert.equal(vertical.x, 0)
  assert.equal(vertical.y, -9)
  assert.equal(parentHorizontal.x, 4.48)
  assert.deepEqual(wholeBodyRotation, { x: 0, y: 0 })
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

test('two-axis chest response moves with its base before the relative lag', () => {
  const state = createChestSpringState()
  stepChestSpring(state, 0, 0, 1 / 60)
  stepChestSpring(state, 6, -4, 1 / 60)
  assert.ok(state.offsetX < 0)
  assert.ok(state.offsetY > 0)
  const responseMix = 0.8
  assert.ok(6 + state.offsetX * responseMix > 0)
  assert.ok(-4 + state.offsetY * responseMix < 0)

  for (let frame = 0; frame < 240; frame += 1) {
    stepChestSpring(state, 6, -4, 1 / 60)
  }
  assert.ok(Math.abs(state.offsetX) < 1e-5)
  assert.ok(Math.abs(state.offsetY) < 1e-5)
})

test('chest spring reverses only after following a moving base', () => {
  const state = createChestSpringState()
  stepChestSpring(state, 0, 0, 1 / 60)

  let firstVisible = 0
  for (let frame = 0; frame < 20; frame += 1) {
    stepChestSpring(state, 6, 0, 1 / 60)
    const visible = 6 + state.offsetX * 0.8
    if (frame === 0) firstVisible = visible
  }
  assert.ok(firstVisible > 0)

  let forwardAfterStop = 0
  let reverseAfterStop = 0
  for (let frame = 0; frame < 120; frame += 1) {
    stepChestSpring(state, 0, 0, 1 / 60)
    const visible = state.offsetX * 0.8
    forwardAfterStop = Math.max(forwardAfterStop, visible)
    reverseAfterStop = Math.min(reverseAfterStop, visible)
  }

  assert.ok(forwardAfterStop > 0)
  assert.ok(reverseAfterStop < 0)
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

test('adaptive frequency changes timing while keeping the spring stable', () => {
  const simulate = (frequencyScale: number) => {
    const state = createChestSpringState()
    stepChestSpring(state, 0, 0, 1 / 60, frequencyScale)
    for (let frame = 0; frame < 6; frame += 1) {
      stepChestSpring(state, 6, 0, 1 / 60, frequencyScale)
    }
    return state.offsetX
  }

  const slower = simulate(0.8)
  const faster = simulate(1.2)
  assert.ok(Math.abs(slower) > Math.abs(faster))
  assert.ok(Number.isFinite(slower))
  assert.ok(Number.isFinite(faster))
})
