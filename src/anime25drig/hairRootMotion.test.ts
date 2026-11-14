import type { Anime25DSecondaryDeformationFrame } from './secondaryDeformation'
import type { Anime25DPlaybackLayer, Anime25DShellProfile } from './types'
import assert from 'node:assert/strict'
import test from 'node:test'
import { IDENTITY_DRIVER } from './driver'
import { FIGURE_PITCH_FORWARD, FigurePitch, figurePitchRest } from './figurePitch'
import { createFigurePose, figureRest } from './figureSkeleton'
import { bindHairRootMotion, writeHairRootMotion } from './hairRootMotion'
import { createAnime25DSecondaryDeformationBinding } from './secondaryDeformation'

function fixture(firstRootY = 20, figure: Pick<Parameters<typeof createAnime25DSecondaryDeformationBinding>[0], 'figureSkin' | 'figurePitch'> = {}) {
  const source = { group: 'head', role: 'back-hair', depth: 1, x: 0, y: 0, w: 200, h: 300,
    strands: [{ x: 60, rootY: firstRootY, tipY: 250 }, { x: 140, rootY: 130, tipY: 280 }] } as Anime25DPlaybackLayer
  const springs = source.strands.map(() => ({ supportX: 0, supportY: 0, stiff: { x: 0, v: 0, dx: 0 }, soft: { x: 0, v: 0, dx: 0 }, vertical: { x: 0, v: 0, dx: 0 }, phase: 0, stiffnessScale: 1, dampingScale: 1 }))
  const deformation = createAnime25DSecondaryDeformationBinding({
    source, baseRole: 'back_hair', shaderGlobalTransform: false, collarContact: false,
    frontHair: false, frontHairParallaxScale: null, chestWeights: null, bangWeights: null,
    strandWeights: null, alongStrand: null, springs, ...figure,
  })
  const profile = { enabled: false } as Anime25DShellProfile
  const roots = bindHairRootMotion(source, deformation,
    new Float32Array([0, 0, 200, 0, 200, 300, 0, 300]), new Uint16Array([0, 1, 2, 0, 2, 3]))!
  const frame = { expression: IDENTITY_DRIVER, faceScale: 1, headAngleY: 0,
    headRotationCosine: 1, headRotationSine: 0, neckPivotX: 100, neckPivotY: 200,
    faceCenterY: 100, headBreathOffset: 0, specialHeadOffset: 0, shellProfile: profile, torsoNeckOffsetX: 0,
  } as Anime25DSecondaryDeformationFrame
  return { roots, frame, springs }
}

test('each root follows its own roll lever and both parent transforms exactly once', () => {
  const { roots, frame, springs } = fixture()
  const angle = 0.2
  frame.headRotationCosine = Math.cos(angle)
  frame.headRotationSine = Math.sin(angle)
  frame.torsoNeckOffsetX = 17
  const body = -0.1
  writeHairRootMotion(roots, frame, 100, 400, Math.cos(body), Math.sin(body))
  for (let i = 0; i < springs.length; i++) {
    const { x, y } = roots.samples[i]
    const hx = 100 + (x - 100) * Math.cos(angle) - (y - 200) * Math.sin(angle) + 17
    const hy = 200 + (x - 100) * Math.sin(angle) + (y - 200) * Math.cos(angle)
    const expected = 100 + (hx - 100) * Math.cos(body) - (hy - 400) * Math.sin(body) - x
    assert.ok(Math.abs(springs[i].supportX - expected) < 0.00002)
    const expectedY = 400 + (hx - 100) * Math.sin(body) + (hy - 400) * Math.cos(body) - y
    assert.ok(Math.abs(springs[i].supportY - expectedY) < 0.00002)
  }
  assert.ok(Math.abs(springs[0].supportX - springs[1].supportX) > 5)
})

test('neutral support is exact and hair lag cannot feed back into root input', () => {
  const { roots, frame, springs } = fixture()
  writeHairRootMotion(roots, frame, 100, 400, 1, 0)
  assert.deepEqual(springs.map(s => s.supportX), [0, 0])
  frame.torsoNeckOffsetX = 23
  writeHairRootMotion(roots, frame, 100, 400, 1, 0)
  assert.deepEqual(springs.map(s => s.supportX), [23, 23])
  for (const spring of springs) {
    spring.stiff.x = 1000; spring.soft.dx = -500
  }
  writeHairRootMotion(roots, frame, 100, 400, 1, 0)
  assert.deepEqual(springs.map(s => s.supportX), [23, 23])
})

test('a root above a cropped lock retains the boundary triangle motion', () => {
  const { roots, frame, springs } = fixture(-40)
  const sample = roots.samples[0]
  assert.equal(sample.y, -40)
  assert.ok(sample.weights.some(w => w < 0))
  frame.headRotationCosine = Math.cos(0.2)
  frame.headRotationSine = Math.sin(0.2)
  writeHairRootMotion(roots, frame, 100, 400, 1, 0)
  const expected = (sample.x - 100) * (Math.cos(0.2) - 1) - (sample.y - 200) * Math.sin(0.2)
  assert.ok(Math.abs(springs[0].supportX - expected) < 0.00002)
})

test('a leaning figure\'s hair is thrown by how far its head travels: every root alike, not apart as the head shows larger', () => {
  const anchors = {
    face: { x0: 50, y0: 40, x1: 150, y1: 160, cx: 100, cy: 100 }, neckPivot: { x: 100, y: 180 }, neckTop: 160, neckBottom: 210,
    bodyPivot: { x: 100, y: 540 }, groundY: 1340, mouth: { x0: 80, y0: 130, x1: 120, y1: 145, cx: 100, cy: 138 }, faceScale: 1,
  } as Parameters<typeof figureRest>[0]
  const rest = figureRest(anchors)!
  const torso = { enabled: true, blend: 1, centerX: 100, radiusX: 120, radiusZ: 90, neckDepth: 0.25 } as Parameters<typeof figurePitchRest>[1]
  const pitch = new FigurePitch(figurePitchRest(rest, torso, anchors.face, 300, [{ icy: 105 }], [{ y: 240 }]))
  const lean = (angle: number, binding: Parameters<typeof fixture>[1]) => {
    const { roots, frame, springs } = fixture(20, binding)
    frame.figure = { rest, pose: createFigurePose(), pitch }
    pitch.step(angle, 0.3, Math.sqrt(1 - 0.09), { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 })
    writeHairRootMotion(roots, frame, 100, 540, 1, 0)
    return springs.map((spring) => [spring.supportX, spring.supportY])
  }
  const head = { figureSkin: { kind: 'chest' }, figurePitch: { kind: 'head' } } as const
  const [first, second] = lean(FIGURE_PITCH_FORWARD, head)
  assert.ok(Math.hypot(first![0]!, first![1]!) > 10, 'the head travelled')
  assert.ok(Math.abs(first![0]! - second![0]!) < 1e-3 && Math.abs(first![1]! - second![1]!) < 1e-3, `${first} ${second}`)
  // ...which is where its chin went.
  const chin = { x: 100, y: 160 }
  pitch.carryPoint(chin, { kind: 'head' }, 100, 160)
  assert.ok(Math.abs(first![0]! - (chin.x - 100)) < 1e-3 && Math.abs(first![1]! - (chin.y - 160)) < 1e-3)
  // A lock drawn on the body goes with the cloth it is on, each root its own way.
  const [low, lower] = lean(FIGURE_PITCH_FORWARD, { figureSkin: { kind: 'torso' }, figurePitch: { kind: 'trunk' } })
  assert.ok(Math.hypot(low![0]! - lower![0]!, low![1]! - lower![1]!) > 1)
  // Upright, nothing.
  assert.deepEqual(lean(0, head), [[0, 0], [0, 0]])
})
