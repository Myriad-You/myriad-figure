import type { Anime25DPlayback, Anime25DPlaybackLayer } from './types'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  anime25DHairlinePinWeight,
  deformAnime25DShellPoint,
  sampleAnime25DHairlinePinWeights,
  writeAnime25DShellRotation,
} from './shellDeformation'
import {
  deriveAnime25DShellProfile,
  resolveAnime25DShellProfile,
} from './shellProfile'

const faceLayer: Anime25DPlaybackLayer = {
  name: 'face',
  role: 'face',
  z: 1,
  depth: 1,
  group: 'head',
  phys: null,
  fade: null,
  side: null,
  x: 210,
  y: 80,
  w: 348,
  h: 390,
  atlas: { x: 0, y: 0, w: 0.5, h: 0.5 },
  strands: [],
}

const frontHairLayer: Anime25DPlaybackLayer = {
  ...faceLayer,
  name: 'front-hair',
  role: 'front-hair',
  z: 2,
  depth: 1.28,
  phys: 'hair',
  x: 150,
  y: 25,
  w: 468,
  h: 420,
}

const topwearLayer: Anime25DPlaybackLayer = {
  ...faceLayer,
  name: 'topwear',
  role: 'topwear',
  z: 0,
  depth: 0.82,
  group: 'body',
  x: 96,
  y: 392,
  w: 576,
  h: 632,
}

const legacyPlayback = {
  anchors: {
    face: { x0: 230, y0: 92, x1: 538, y1: 405, cx: 384, cy: 248 },
    eyeL: {
      x0: 270,
      y0: 170,
      x1: 330,
      y1: 215,
      icx: 300,
      icy: 194,
      closeY: 201,
    },
    eyeR: {
      x0: 438,
      y0: 170,
      x1: 498,
      y1: 215,
      icx: 468,
      icy: 194,
      closeY: 201,
    },
    mouth: { x0: 347, y0: 310, x1: 421, y1: 344, cx: 384, cy: 327 },
    neckPivot: { x: 384, y: 426 },
    neckTop: 395,
    neckBottom: 482,
    bodyPivot: { x: 384, y: 1024 },
    faceScale: 0.925,
  },
  layers: [faceLayer, frontHairLayer, topwearLayer],
} satisfies Pick<Anime25DPlayback, 'anchors' | 'layers'>

test('hydrates old v6 assets deterministically without mutating them', () => {
  const first = resolveAnime25DShellProfile(legacyPlayback)
  const second = resolveAnime25DShellProfile(legacyPlayback)
  assert.deepEqual(first, second)
  assert.equal('shellProfile' in legacyPlayback, false)
  assert.equal(first.version, 1)
  assert.equal(first.source, 'anchor-derived')
  assert.equal(first.hair.hairlinePin.enabled, true)
  assert.equal(first.hair.hairlinePin.mode, 'strand-roots')
  assert.deepEqual(first.torso, {
    enabled: true,
    blend: 0.5,
    centerX: 384,
    radiusX: 308 * 0.95,
    radiusZ: 308 * 0.55,
  })
})

test('hydrates an early v1 shell profile with torso data without mutating it', () => {
  const fullProfile = deriveAnime25DShellProfile(legacyPlayback)
  const { torso: _torso, ...earlyProfile } = fullProfile
  earlyProfile.source = 'authored'
  earlyProfile.blend = 0.37

  const hydrated = resolveAnime25DShellProfile({
    ...legacyPlayback,
    shellProfile: earlyProfile,
  })

  assert.notEqual(hydrated, earlyProfile)
  assert.equal('torso' in earlyProfile, false)
  assert.equal(hydrated.source, 'authored')
  assert.equal(hydrated.blend, 0.37)
  assert.deepEqual(hydrated.torso, fullProfile.torso)
})

test('keeps an explicitly persisted profile as the source of truth', () => {
  const explicit = deriveAnime25DShellProfile(legacyPlayback)
  explicit.source = 'authored'
  explicit.blend = 0.37
  explicit.hair.hairlinePin.mode = 'rectangle'
  assert.equal(
    resolveAnime25DShellProfile({ ...legacyPlayback, shellProfile: explicit }),
    explicit,
  )
})

test('hydrates legacy automatic pins into strand-root mode without mutation', () => {
  const persisted = deriveAnime25DShellProfile(legacyPlayback)
  const { mode: _mode, ...legacyPin } = persisted.hair.hairlinePin
  persisted.hair.hairlinePin = legacyPin

  const hydrated = resolveAnime25DShellProfile({
    ...legacyPlayback,
    shellProfile: persisted,
  })

  assert.notEqual(hydrated, persisted)
  assert.equal(persisted.hair.hairlinePin.mode, undefined)
  assert.equal(hydrated.hair.hairlinePin.mode, 'strand-roots')
})

test('hydrates legacy authored pins as calibrated rectangles', () => {
  const persisted = deriveAnime25DShellProfile(legacyPlayback)
  persisted.source = 'authored'
  const { mode: _mode, ...legacyPin } = persisted.hair.hairlinePin
  persisted.hair.hairlinePin = legacyPin

  const hydrated = resolveAnime25DShellProfile({
    ...legacyPlayback,
    shellProfile: persisted,
  })

  assert.equal(persisted.hair.hairlinePin.mode, undefined)
  assert.equal(hydrated.hair.hairlinePin.mode, 'rectangle')
})

test('shell projection is an exact neutral identity and finite at bounded turns', () => {
  const profile = deriveAnime25DShellProfile(legacyPlayback)
  const rotation = {
    active: false,
    yawCosine: 1,
    yawSine: 0,
    pitchCosine: 1,
    pitchSine: 0,
  }
  const neutral = { x: 417.25, y: 246.5 }
  writeAnime25DShellRotation(0, 0, rotation)
  deformAnime25DShellPoint(
    neutral,
    neutral.y,
    'head',
    profile,
    rotation,
    1.08,
    0,
  )
  assert.deepEqual(neutral, { x: 417.25, y: 246.5 })

  const turned = { ...neutral }
  writeAnime25DShellRotation(1, -0.8, rotation)
  deformAnime25DShellPoint(turned, turned.y, 'head', profile, rotation, 1.08, 0)
  assert.equal(Number.isFinite(turned.x), true)
  assert.equal(Number.isFinite(turned.y), true)
  assert.notDeepEqual(turned, neutral)
})

test('hairline pin stays full inside its scalp rectangle and fades outside', () => {
  const profile = deriveAnime25DShellProfile(legacyPlayback)
  const pin = profile.hair.hairlinePin
  const centerX = profile.head.centerX + pin.centerX * profile.head.radiusX
  const centerY = profile.head.centerY + pin.centerY * profile.head.radiusY
  assert.equal(anime25DHairlinePinWeight(centerX, centerY, profile), 1)
  assert.equal(
    anime25DHairlinePinWeight(
      centerX + profile.head.radiusX * (pin.halfWidth + pin.feather * 2),
      centerY,
      profile,
    ),
    0,
  )
})

test('automatic hairline attachment releases monotonically across two mesh rows', () => {
  const profile = deriveAnime25DShellProfile(legacyPlayback)
  const source: Anime25DPlaybackLayer = {
    ...frontHairLayer,
    x: 260,
    y: 60,
    w: 80,
    h: 80,
    strands: [{ x: 300, rootY: 100, tipY: 260 }],
  }
  const rest = new Float32Array([300, 60, 300, 100, 300, 140, 300, 180])

  const weights = sampleAnime25DHairlinePinWeights(rest, source, 2, profile)

  assert.ok(weights)
  assert.deepEqual(Array.from(weights), [1, 1, 0.5, 0])
})
