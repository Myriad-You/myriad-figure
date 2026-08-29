import type { Anime25DLayerSpringBinding } from './layerBinding'
import type {
  Anime25DSecondaryDeformationBinding,
  Anime25DSecondaryDeformationFrame,
} from './secondaryDeformation'
import type { Anime25DPlaybackLayer } from './types'
import assert from 'node:assert/strict'
import test from 'node:test'
import { chestDeformationWeight } from './chestPhysics'
import {
  BODY_HEAD_FOLLOW,
  FRONT_COLLAR_FLEX_REGION,
  FRONT_COLLAR_HEAD_FOLLOW,
  FRONT_COLLAR_INNER_REGION,
  HIGH_COLLAR_NECK_FOLLOW_POWER,
} from './collarRuntime'
import { IDENTITY_DRIVER } from './driver'
import {
  createAnime25DSecondaryDeformationBinding,
  deformAnime25DHairPoint,
  deformAnime25DSecondaryPoint,
} from './secondaryDeformation'

const VERTEX_COUNT = 48

test('binds stable secondary roles and optional geometry fields once', () => {
  const topwear = secondaryBinding('topwear', 'body', false)
  assert.equal(topwear.topwear, true)
  assert.equal(topwear.head, false)
  assert.equal(topwear.frontCollar, false)

  const collar = secondaryBinding('collar_front', 'body', false, true)
  assert.equal(collar.frontCollar, true)
  assert.equal(collar.collarContact, true)

  const hair = secondaryBinding('front hair', 'head', false, false, true)
  assert.equal(hair.head, true)
  assert.equal(hair.frontHair, true)
  assert.equal(hair.springs?.length, 3)
})

test('secondary and hair stages match the frozen player branches', () => {
  const bindings = secondaryBindings()
  for (let frameIndex = 0; frameIndex < 120; frameIndex += 1) {
    const progress = frameIndex / 119
    const frame = secondaryFrame(progress, frameIndex)
    for (const binding of bindings) {
      for (let row = 0; row <= 5; row += 1) {
        for (let column = 0; column <= 7; column += 1) {
          const vertex = row * 8 + column
          const source = binding.source
          const restX = source.x + (source.w * column) / 7
          const restY = source.y + (source.h * row) / 5
          const initialX = restX + Math.sin(frameIndex * 0.17 + vertex) * 1.3
          const initialY = restY + Math.cos(frameIndex * 0.13 + vertex) * 1.1
          const actual = { x: initialX, y: initialY }
          const expected = { ...actual }
          legacyDeformSecondaryPoint(
            expected,
            restX,
            restY,
            vertex,
            binding,
            frame,
          )
          legacyDeformHairPoint(expected, vertex, binding, frame)
          deformAnime25DSecondaryPoint(
            actual,
            restX,
            restY,
            vertex,
            binding,
            frame,
          )
          deformAnime25DHairPoint(actual, vertex, binding, frame)
          assert.deepEqual(
            actual,
            expected,
            `${binding.baseRole} frame ${frameIndex} vertex ${row}:${column}`,
          )
        }
      }
    }
  }
})

function secondaryBindings(): Anime25DSecondaryDeformationBinding[] {
  return [
    secondaryBinding('face', 'head', false),
    secondaryBinding('body', 'body', false),
    secondaryBinding('neck', 'body', false),
    secondaryBinding('collar_front', 'body', false),
    secondaryBinding('collar_front', 'body', false, true),
    secondaryBinding('topwear', 'body', false),
    secondaryBinding('handwear', 'body', false),
    secondaryBinding('front hair', 'head', false, false, true),
    secondaryBinding('back hair', 'head', false, false, true, false),
    secondaryBinding('accessory', 'head', true),
  ]
}

function secondaryBinding(
  baseRole: string,
  group: Anime25DPlaybackLayer['group'],
  shaderGlobalTransform: boolean,
  collarContact = false,
  hair = false,
  frontHair = true,
): Anime25DSecondaryDeformationBinding {
  const source: Anime25DSecondaryDeformationBinding['source'] = {
    role: baseRole.replaceAll('_', '-').replace('front hair', 'front-hair'),
    group,
    depth: group === 'head' ? 0.78 : 0.91,
    x: 54,
    y: 70,
    w: 126,
    h: 154,
  }
  const alongStrand = hair ? new Float32Array(VERTEX_COUNT) : null
  const frontHairParallaxScale = hair
    ? new Float32Array(VERTEX_COUNT)
    : null
  const bangWeights = hair && frontHair
    ? new Float32Array(VERTEX_COUNT * 3)
    : null
  const strandWeights = hair
    ? new Float32Array(VERTEX_COUNT * 3)
    : null
  for (let vertex = 0; vertex < VERTEX_COUNT; vertex += 1) {
    const progress = vertex / (VERTEX_COUNT - 1)
    if (alongStrand) alongStrand[vertex] = progress
    if (frontHairParallaxScale) {
      frontHairParallaxScale[vertex] = 0.2 + progress * 0.8
    }
    if (bangWeights) {
      bangWeights[vertex * 3] = 1 - progress
      bangWeights[vertex * 3 + 1] = 0.35 + progress * 0.3
      bangWeights[vertex * 3 + 2] = progress
    }
    if (strandWeights) {
      strandWeights[vertex * 3] = 0.42 - progress * 0.1
      strandWeights[vertex * 3 + 1] = 0.37
      strandWeights[vertex * 3 + 2] = 0.21 + progress * 0.1
    }
  }
  return createAnime25DSecondaryDeformationBinding({
    source,
    baseRole,
    shaderGlobalTransform,
    collarContact,
    frontHair: hair && frontHair,
    frontHairParallaxScale,
    chestWeights:
      baseRole === 'topwear'
        ? Float32Array.from(
            { length: VERTEX_COUNT },
            (_, vertex) => 0.25 + (vertex % 9) * 0.08,
          )
        : null,
    bangWeights,
    strandWeights,
    alongStrand,
    springs: hair ? hairSprings() : null,
  })
}

function hairSprings(): Anime25DLayerSpringBinding[] {
  return [
    spring(-2.6, 1.4),
    spring(0.8, -1.1),
    spring(3.2, 1.9),
  ]
}

function spring(stiffDx: number, softDx: number): Anime25DLayerSpringBinding {
  return {
    stiff: { x: 0, v: 0, dx: stiffDx },
    soft: { x: 0, v: 0, dx: softDx },
    phase: 0,
    stiffnessScale: 1,
    dampingScale: 1,
  }
}

function secondaryFrame(
  progress: number,
  frameIndex: number,
): Anime25DSecondaryDeformationFrame {
  const rotation = Math.sin(progress * 4.7) * 0.16
  return {
    expression: {
      ...IDENTITY_DRIVER,
      angleX: Math.sin(progress * 5.1) * 0.85,
      armPos: Math.cos(progress * 4.3) * 0.72,
      armY: Math.sin(progress * 6.2) * 0.66,
      bangL: Math.sin(progress * 3.2) * 0.7,
      bangC: Math.cos(progress * 4.4) * 0.55,
      bangR: Math.sin(progress * 5.6) * -0.64,
      fhAmp: 0.35 + progress * 1.4,
      fhSoft: 0.2 + progress * 0.7,
      phys: frameIndex % 13 !== 0,
      physAmp: 0.45 + progress * 1.7,
      soft: 0.4 + progress * 1.3,
    },
    faceScale: 0.82,
    headAngleY: Math.cos(progress * 5.4) * 0.9,
    headRotationCosine: Math.cos(rotation),
    headRotationSine: Math.sin(rotation),
    neckPivotX: 117,
    neckPivotY: 161,
    neckBottom: 221,
    neckFollowTop: 148,
    neckFollowSpan: 73,
    faceCenterY: 109,
    bodyBreathOffset: 0.4 + Math.sin(progress * 6.8) * 0.9,
    headBreathOffset: 0.5 + Math.cos(progress * 6.1) * 0.75,
    specialHeadOffset: Math.sin(progress * 7.3) * 5.2,
    highCollar: frameIndex % 2 === 0,
    breath: 0.5 + Math.sin(progress * 5.7) * 0.5,
    chestCenterX: 116,
    chestRegionCenterY: 205,
    chestMotionCenterY: 207 + Math.cos(progress * 3.8) * 13,
    chestRadiusY: 62,
    inverseChestRadiusX: 1 / 78,
    inverseChestRadiusY: 1 / 62,
    chestOffsetX: frameIndex % 11 === 0 ? 0 : Math.sin(progress * 7.2) * 5,
    chestOffsetY: frameIndex % 11 === 0 ? 0 : Math.cos(progress * 6.4) * 7,
    chestProfileSource:
      frameIndex % 3 === 0
        ? 'ai-vision'
        : frameIndex % 3 === 1
          ? 'geometry-fallback'
          : undefined,
  }
}

function legacyDeformSecondaryPoint(
  point: { x: number; y: number },
  restX: number,
  restY: number,
  vertex: number,
  binding: Anime25DSecondaryDeformationBinding,
  frame: Anime25DSecondaryDeformationFrame,
): void {
  const { source } = binding
  const baseRole = binding.baseRole
  const isTopwear = baseRole === 'topwear'
  const isFrontCollar = baseRole === 'collar_front'
  const isHead = source.group === 'head'
  if (!binding.shaderGlobalTransform) {
    const neckFollowProgress =
      baseRole === 'neck'
        ? clamp((frame.neckBottom - restY) / frame.neckFollowSpan, 0, 1)
        : 0
    const neckFollowInput = frame.highCollar
      ? neckFollowProgress ** HIGH_COLLAR_NECK_FOLLOW_POWER
      : neckFollowProgress
    const neckHeadBlend =
      baseRole === 'neck' ? smoothstep(neckFollowInput) : 0
    const frontCollarProgress =
      isFrontCollar && !binding.collarContact
        ? clamp(
            1 -
              (restY - source.y) /
                Math.max(1, source.h * FRONT_COLLAR_FLEX_REGION),
            0,
            1,
          )
        : 0
    const frontCollarLocalX =
      isFrontCollar && !binding.collarContact
        ? Math.abs(
            (restX - (source.x + source.w / 2)) /
              Math.max(1, source.w / 2),
          )
        : 1
    const frontCollarInnerWeight =
      isFrontCollar && !binding.collarContact
        ? smoothstep((1 - frontCollarLocalX) / FRONT_COLLAR_INNER_REGION)
        : 0
    const frontCollarHeadBlend =
      smoothstep(frontCollarProgress) *
      frontCollarInnerWeight *
      FRONT_COLLAR_HEAD_FOLLOW
    let headFollow = isHead
      ? 1
      : source.group === 'body'
        ? BODY_HEAD_FOLLOW
        : 0
    if (baseRole === 'neck') {
      headFollow =
        BODY_HEAD_FOLLOW + (1 - BODY_HEAD_FOLLOW) * neckHeadBlend
    } else if (isFrontCollar && !binding.collarContact) {
      headFollow =
        BODY_HEAD_FOLLOW + (1 - BODY_HEAD_FOLLOW) * frontCollarHeadBlend
    }
    if (!binding.collarContact && headFollow > 0) {
      const rotationX = point.x - frame.neckPivotX
      const rotationY = point.y - frame.neckPivotY
      const rotatedX =
        rotationX * frame.headRotationCosine -
        rotationY * frame.headRotationSine
      const rotatedY =
        rotationX * frame.headRotationSine +
        rotationY * frame.headRotationCosine
      point.x += (rotatedX - rotationX) * headFollow
      point.y += (rotatedY - rotationY) * headFollow
      let depthOffset =
        (source.depth - 1) *
        (binding.frontHairParallaxScale?.[vertex] ?? 1)
      if (baseRole === 'neck') depthOffset *= 1 - neckHeadBlend
      else if (isFrontCollar) depthOffset *= 1 - frontCollarHeadBlend
      point.x +=
        headFollow *
        frame.faceScale *
        (frame.expression.angleX * (14 + 40 * depthOffset) +
          frame.expression.angleX * (frame.neckPivotY - point.y) * 0.028)
      point.y +=
        headFollow *
        frame.faceScale *
        (-frame.headAngleY * (9 + 30 * depthOffset) -
          frame.headAngleY *
            depthOffset *
            (point.y - frame.faceCenterY) *
            0.05)
    }
    if (!binding.collarContact && frame.specialHeadOffset !== 0) {
      const specialHeadFollow = isHead
        ? 1
        : baseRole === 'neck'
          ? neckHeadBlend
          : isFrontCollar
            ? frontCollarHeadBlend
            : 0
      point.y += frame.specialHeadOffset * specialHeadFollow
    }
    if (!binding.collarContact) {
      const breathOffset = isHead
        ? frame.headBreathOffset
        : baseRole === 'neck'
          ? frame.bodyBreathOffset +
            (frame.headBreathOffset - frame.bodyBreathOffset) * neckHeadBlend
          : isFrontCollar
            ? frame.bodyBreathOffset +
              (frame.headBreathOffset - frame.bodyBreathOffset) *
                frontCollarHeadBlend
            : frame.bodyBreathOffset
      point.y -= breathOffset * frame.faceScale
    }
  }
  if (isTopwear && point.y < frame.chestRegionCenterY) {
    point.y -=
      frame.breath *
      2.2 *
      frame.faceScale *
      smoothstep(
        (frame.chestRegionCenterY - point.y) / (frame.chestRadiusY * 2),
      )
  }
  if (isTopwear) {
    point.x =
      frame.neckPivotX +
      (point.x - frame.neckPivotX) * (1 + frame.breath * 0.003)
  }
  if (isTopwear && (frame.chestOffsetX !== 0 || frame.chestOffsetY !== 0)) {
    const normalizedX =
      (restX - frame.chestCenterX) * frame.inverseChestRadiusX
    const normalizedY =
      (restY - frame.chestMotionCenterY) * frame.inverseChestRadiusY
    const skinWeight = binding.chestWeights?.[vertex] ?? 1
    const chestWeight = chestDeformationWeight(
      frame.chestProfileSource,
      normalizedX,
      normalizedY,
      skinWeight,
    )
    point.x += frame.chestOffsetX * chestWeight
    point.y += frame.chestOffsetY * chestWeight
  }
  if (baseRole === 'handwear') {
    const sleeveWeight = smoothstep(
      ((point.y - source.y) / source.h) * 1.15,
    )
    point.y -= frame.expression.armY * 30 * frame.faceScale * sleeveWeight
    point.y += frame.expression.armPos * 40 * frame.faceScale
    point.x +=
      frame.expression.armY *
      6 *
      frame.faceScale *
      sleeveWeight *
      (point.x < frame.neckPivotX ? 1 : -1)
  }
}

function legacyDeformHairPoint(
  point: { x: number; y: number },
  vertex: number,
  binding: Anime25DSecondaryDeformationBinding,
  frame: Anime25DSecondaryDeformationFrame,
): void {
  if (binding.bangWeights && binding.alongStrand) {
    const along = binding.alongStrand[vertex]
    const amplitude = along ** 1.4 * 22 * frame.faceScale
    point.x +=
      (frame.expression.bangL * binding.bangWeights[vertex * 3] +
        frame.expression.bangC * binding.bangWeights[vertex * 3 + 1] +
        frame.expression.bangR * binding.bangWeights[vertex * 3 + 2]) *
      amplitude
  }
  const strandCount = binding.springs?.length ?? 0
  if (
    !strandCount ||
    !binding.springs ||
    !binding.strandWeights ||
    !binding.alongStrand ||
    !frame.expression.phys
  ) {
    return
  }
  const along = binding.alongStrand[vertex]
  const easedAlong = binding.frontHair ? Math.min(1, along * 1.6) : along
  const amplitude =
    easedAlong ** (binding.frontHair ? 1.8 : 2.1) *
    (binding.frontHair
      ? frame.expression.fhAmp
      : frame.expression.physAmp)
  const softMix =
    easedAlong ** 1.2 *
    (binding.frontHair ? frame.expression.fhSoft : frame.expression.soft)
  let offsetX = 0
  for (let strand = 0; strand < strandCount; strand += 1) {
    const weight = binding.strandWeights[vertex * strandCount + strand]
    if (weight < 0.001) continue
    const spring = binding.springs[strand]
    offsetX +=
      weight *
      (spring.stiff.dx * (1 - softMix) + spring.soft.dx * softMix)
  }
  const offset = offsetX * amplitude
  point.x += offset
  point.y += Math.abs(offset) * 0.12
}

function smoothstep(value: number): number {
  const bounded = clamp(value, 0, 1)
  return bounded * bounded * (3 - 2 * bounded)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
