import type { CompanionRigManifest } from './types'
import assert from 'node:assert/strict'
import test from 'node:test'
import { RIG_IR_VERSION } from './contract'
import { isRigManifest } from './types'

const manifest: CompanionRigManifest = {
  schemaVersion: 1,
  quality: 'layered-2d',
  canvas: { width: 1, height: 1 },
  textures: [{ id: 'atlas', url: '/atlas.png', width: 512, height: 512 }],
  bones: [
    { id: 'handwear', parent: 'root', pivot: { x: 0.8, y: 0.5 } },
    { id: 'root', parent: null, pivot: { x: 0.5, y: 0.8 } },
  ],
  parts: [
    {
      id: 'handwear',
      textureId: 'atlas',
      zIndex: 1,
      opacity: 1,
      vertices: [
        {
          position: { x: 0, y: 0 },
          uv: { x: 0, y: 0 },
          joints: [0, 1, 0, 0],
          weights: [0.8, 0.2, 0, 0],
        },
        {
          position: { x: 1, y: 0 },
          uv: { x: 1, y: 0 },
          joints: [0, 1, 0, 0],
          weights: [0.8, 0.2, 0, 0],
        },
        {
          position: { x: 0, y: 1 },
          uv: { x: 0, y: 1 },
          joints: [0, 1, 0, 0],
          weights: [0.8, 0.2, 0, 0],
        },
      ],
      indices: [0, 1, 2],
    },
  ],
  clips: [
    {
      id: 'idle',
      duration: 1,
      looping: true,
      tracks: [
        {
          boneId: 'root',
          keyframes: [
            {
              time: 0,
              transform: {
                translation: { x: 0, y: 0 },
                rotation: 0,
                scale: { x: 1, y: 1 },
              },
            },
          ],
        },
      ],
    },
  ],
  defaultClip: 'idle',
}

test('accepts bounded manifests with parent-after-child bones', () => {
  assert.equal(isRigManifest(manifest), true)
})

test('validates portrait generation provenance when present', () => {
  const generated = structuredClone(manifest)
  generated.sourceGenerationFingerprint = 'a'.repeat(64)
  assert.equal(isRigManifest(generated), true)
  generated.sourceGenerationFingerprint = 'not-a-sha256'
  assert.equal(isRigManifest(generated), false)
})

test('requires known presentation variants and a stable slot fallback', () => {
  const variant = structuredClone(manifest)
  variant.rigIrVersion = RIG_IR_VERSION
  variant.semantics = {
    bones: { root: 'root' },
    chains: {},
    secondaryBoneIds: [],
  }
  variant.spatialProfile = { collisionVolumes: [] }
  variant.parts[0].slot = 'mouth'
  variant.parts[0].variant = 'closed'
  assert.equal(isRigManifest(variant), true)
  variant.parts[0].variant = 'open'
  assert.equal(isRigManifest(variant), false)
  variant.parts.push({
    ...structuredClone(variant.parts[0]),
    id: 'mouth-closed',
    variant: 'closed',
  })
  assert.equal(isRigManifest(variant), true)
  variant.parts[0].variant = 'invented'
  assert.equal(isRigManifest(variant), false)
  variant.parts[0].slot = 'invented-slot'
  assert.equal(isRigManifest(variant), false)
})

test('keeps supported IR v2 custom slots readable for non-destructive migration', () => {
  const legacy = structuredClone(manifest)
  legacy.rigIrVersion = 2
  legacy.semantics = {
    bones: { root: 'root' },
    chains: {},
    secondaryBoneIds: [],
  }
  legacy.spatialProfile = { collisionVolumes: [] }
  legacy.parts[0].slot = 'custom-emblem'
  legacy.parts[0].variant = 'lit'
  assert.equal(isRigManifest(legacy), true)
  legacy.rigIrVersion = RIG_IR_VERSION
  assert.equal(isRigManifest(legacy), false)
})

test('validates versioned semantic IR and connected custom chains', () => {
  const semantic = structuredClone(manifest)
  semantic.bones.push(
    { id: 'body', parent: 'root', pivot: { x: 0.5, y: 0.55 } },
    { id: 'head', parent: 'body', pivot: { x: 0.5, y: 0.25 } },
  )
  semantic.rigIrVersion = RIG_IR_VERSION
  semantic.semantics = {
    bones: {
      root: 'root',
      torso: 'body',
      head: 'head',
      handwear: 'handwear',
    },
    chains: { torso: ['root', 'body', 'head'] },
    secondaryBoneIds: [],
  }
  semantic.spatialProfile = {
    collisionVolumes: [
      {
        id: 'torso',
        boneId: 'root',
        offset: { x: 0, y: 0 },
        radius: { x: 0.2, y: 0.3 },
        padding: 0.01,
      },
    ],
  }
  assert.equal(isRigManifest(semantic), true)
  semantic.semantics.chains.torso = ['head', 'body', 'root']
  assert.equal(isRigManifest(semantic), true)
  semantic.semantics.bones.root = 'missing'
  assert.equal(isRigManifest(semantic), false)
  semantic.semantics.bones.root = 'root'
  semantic.rigIrVersion = RIG_IR_VERSION + 1
  assert.equal(isRigManifest(semantic), false)
})

test('rejects invalid character collision volumes', () => {
  const spatial = structuredClone(manifest)
  spatial.rigIrVersion = RIG_IR_VERSION
  spatial.semantics = {
    bones: { root: 'root' },
    chains: {},
    secondaryBoneIds: [],
  }
  spatial.spatialProfile = {
    collisionVolumes: [
      {
        id: 'torso',
        boneId: 'root',
        offset: { x: 0, y: 0 },
        radius: { x: 0, y: 0.3 },
        padding: 0.01,
      },
    ],
  }
  assert.equal(isRigManifest(spatial), false)
})

test('accepts a positive standard action library version and rejects zero', () => {
  const versioned = structuredClone(manifest)
  versioned.standardClipLibraryVersion = 2
  assert.equal(isRigManifest(versioned), true)
  versioned.standardClipLibraryVersion = 0
  assert.equal(isRigManifest(versioned), false)
})

test('validates clip-owned expression presentation intent', () => {
  const presented = structuredClone(manifest)
  presented.clips[0].presentation = {
    expression: 'happy',
    keyframes: [
      { progress: 0, expression: 'neutral' },
      { progress: 0.25, expression: 'happy' },
      { progress: 1, expression: 'neutral' },
    ],
  }
  assert.equal(isRigManifest(presented), true)
  presented.clips[0].presentation.keyframes![1].progress = 0
  assert.equal(isRigManifest(presented), false)
  presented.clips[0].presentation.keyframes![1].progress = 0.25
  presented.clips[0].presentation.keyframes![1] = { progress: 0.25 }
  assert.equal(isRigManifest(presented), false)
  presented.clips[0].presentation = {}
  assert.equal(isRigManifest(presented), false)
  presented.clips[0].presentation = {
    expression: 'invented' as 'happy',
  }
  assert.equal(isRigManifest(presented), false)
})

test('validates ordered normalized clip events', () => {
  const eventful = structuredClone(manifest)
  eventful.clips[0].events = [
    { progress: 0.25, kind: 'contact-left', intensity: 0.6 },
    { progress: 0.75, kind: 'contact-right', intensity: 0.7 },
  ]
  assert.equal(isRigManifest(eventful), true)
  eventful.clips[0].events.reverse()
  assert.equal(isRigManifest(eventful), false)
  eventful.clips[0].events = [
    { progress: 0.5, kind: 'Contact Unsafe', intensity: 0.6 },
  ]
  assert.equal(isRigManifest(eventful), false)
})

test('validates clip-owned generated amplitude safety', () => {
  const generated = structuredClone(manifest)
  generated.clips[0].generation = { maxAmplitudeScale: 1.02 }
  assert.equal(isRigManifest(generated), true)
  generated.clips[0].generation.maxAmplitudeScale = 1.4
  assert.equal(isRigManifest(generated), false)
})

test('rejects cyclic bone hierarchies', () => {
  const invalid = structuredClone(manifest)
  invalid.bones[1].parent = 'hand'
  assert.equal(isRigManifest(invalid), false)
})

test('rejects non-normalized skin weights', () => {
  const invalid = structuredClone(manifest)
  invalid.parts[0].vertices[0].weights = [0.2, 0.2, 0.2, 0]
  assert.equal(isRigManifest(invalid), false)
})

test('accepts a bounded optional procedural motion profile', () => {
  const profiled = structuredClone(manifest)
  profiled.motionProfile = {
    seed: 42,
    breath: { minFrequencyHz: 0.16, maxFrequencyHz: 0.28, amplitude: 0.004 },
    blink: {
      minIntervalSeconds: 2.5,
      maxIntervalSeconds: 7,
      durationSeconds: 0.24,
      doubleChance: 0.15,
    },
    secondary: {
      enabled: true,
      frequencyHz: 2.1,
      dampingRatio: 0.5,
      response: 0.6,
    },
  }
  assert.equal(isRigManifest(profiled), true)
})

test('rejects unstable or unbounded motion profiles', () => {
  const invalid = structuredClone(manifest)
  invalid.motionProfile = {
    seed: 42,
    breath: { minFrequencyHz: 0.16, maxFrequencyHz: 0.28, amplitude: 0.4 },
    blink: {
      minIntervalSeconds: 2.5,
      maxIntervalSeconds: 7,
      durationSeconds: 0.24,
      doubleChance: 0.15,
    },
    secondary: {
      enabled: true,
      frequencyHz: 2.1,
      dampingRatio: -0.5,
      response: 0.6,
    },
  }
  assert.equal(isRigManifest(invalid), false)
})

test('accepts bounded outfit safety and character-local semantic anchors', () => {
  const outfitted = structuredClone(manifest)
  outfitted.outfitProfile = {
    topologies: ['wide-sleeve', 'long-skirt'],
    secondaryPartIds: ['handwear'],
    torsoTwistScale: 0.9,
    secondaryMotionScale: 0.78,
  }
  outfitted.semanticAnchors = {
    forehead: { boneId: 'root', offset: { x: 0, y: -0.2 } },
  }
  assert.equal(isRigManifest(outfitted), true)
  outfitted.outfitProfile.topologies = ['armor', 'armor']
  assert.equal(isRigManifest(outfitted), false)
  outfitted.outfitProfile.topologies = ['armor']
  outfitted.outfitProfile.secondaryPartIds = ['handwear', 'handwear']
  assert.equal(isRigManifest(outfitted), false)
  outfitted.outfitProfile.secondaryPartIds = ['handwear']
  outfitted.outfitProfile.torsoTwistScale = 0.1
  assert.equal(isRigManifest(outfitted), false)
  outfitted.outfitProfile.torsoTwistScale = 0.9
  outfitted.outfitProfile.secondaryMotionScale = 1.2
  assert.equal(isRigManifest(outfitted), false)
})
