import type { Anime25DPlayback, MeropeRigManifest } from '@myriad/figure-player'
import type { Mutation } from './rigFuzz.fixture'
import assert from 'node:assert/strict'
import test from 'node:test'
import { isAnime25DPlayback } from '@myriad/figure-player'
import { buildAnime25DLayerBinding, CHARACTER_ASSET_PROFILES, isAnime25DTurnKeyforms, MAX_RIG_BONES, MAX_RIG_PARTS, resolveAnime25DLayerSemantics } from '@myriad/figure-player/internals'
import { MAX_RIG_COLLISION_VOLUMES, MAX_RIG_TEXTURES, MAX_RIG_TOTAL_VERTICES, MAX_RIG_VERTICES_PER_PART, MIN_SUPPORTED_RIG_IR_VERSION, RIG_IR_VERSION } from './contract'
import { isLiveMeropeManifest, isRigManifest, sameLiveFaceRuntime } from './manifestValidation'
import { BAD_URLS, BAD_VALUES, legalManifest, mulberry32, mutate } from './rigFuzz.fixture'
import { isDocumentTurnKeyforms, placeBodyTurnKeyforms, placeTurnKeyforms } from './turnKeyformImport'

/**
 * A manifest reaches the runtime from the site's server, and through it from
 * an archive someone uploaded. Whatever arrives, validation answers: no, or a
 * manifest the runtime can build from. It never throws and never stalls, and
 * what it lets through is inside the limits, finite, and loads only the site's
 * own picture. Each case is made from its seed alone.
 */
const SEEDS = 3000
/** Far more than any check takes; one that stalls is a seed to look at, not a test to wait out. */
const SLOWEST_MS = 2000

const bust = await legalManifest('bust')
const fullBody = await legalManifest('fullBody')
/** As they arrive: a fresh copy read from text costs a third of a structuredClone. */
const wire = [bust, fullBody].map((manifest) => JSON.stringify(manifest))
const wirePackage = [bust, fullBody].map((manifest) => JSON.stringify(manifest.anime25dPlayback))

test('the manifests the cases start from are legal', () => {
  for (const manifest of [bust, fullBody]) {
    assert.equal(isLiveMeropeManifest(manifest), true)
    assertPlayable(manifest, manifest.anime25dPlayback!.layers.keys())
  }
})

test(`a damaged manifest is refused or safe to play (${SEEDS} seeds)`, () => {
  let passed = 0
  for (let seed = 0; seed < SEEDS; seed += 1) {
    const manifest = JSON.parse(wire[seed % 2]) as MeropeRigManifest
    const mutations = mutate(manifest, mulberry32(seed))
    replayable(seed, mutations, () => {
      if (!answers(() => isLiveMeropeManifest(manifest))) return
      passed += 1
      assert.equal(isRigManifest(manifest), true)
      assert.equal(isAnime25DPlayback(manifest.anime25dPlayback), true)
      assert.equal(sameLiveFaceRuntime(manifest, manifest), true)
      const layers = mutations.flatMap(({ path }) => (path[1] === 'layers' && typeof path[2] === 'number' ? [path[2]] : []))
      assertPlayable(manifest, layers)
    })
  }
  // Both ways are exercised: a check that refuses everything would pass the rest.
  assert.ok(passed > SEEDS * 0.05 && passed < SEEDS * 0.95, `${passed} of ${SEEDS} let through`)
})

test('a damaged package is refused or safe on its own, without a manifest around it', () => {
  for (let seed = 0; seed < SEEDS / 4; seed += 1) {
    const playback = JSON.parse(wirePackage[seed % 2]) as Anime25DPlayback
    const mutations = mutate(playback, mulberry32(0x5EED0000 + seed))
    replayable(seed, mutations, () => {
      if (answers(() => isAnime25DPlayback(playback))) assertPlayablePackage(playback, [])
    })
  }
})

test('damaged turn keys from an archive are refused or finite where they are placed', () => {
  const { turnKeyforms, bodyTurnKeyforms, pixelCanvas } = fullBody.anime25dPlayback!
  for (let seed = 0; seed < SEEDS / 4; seed += 1) {
    const keys = structuredClone({ canvas: [pixelCanvas.width, pixelCanvas.height], keyforms: turnKeyforms, bodyKeyforms: bodyTurnKeyforms })
    const mutations = mutate(keys, mulberry32(0xA7C41000 + seed))
    replayable(seed, mutations, () => {
      if (!answers(() => isDocumentTurnKeyforms(keys))) return
      assert.ok(isDocumentTurnKeyforms(keys))
      const document = { width: keys.canvas[0], height: keys.canvas[1] }
      const placed = [placeTurnKeyforms(keys, document, { x: -4, y: 3 }), placeBodyTurnKeyforms(keys, document, { x: -4, y: 3 })]
      for (const families of placed) {
        if (!families) continue
        assert.equal(isAnime25DTurnKeyforms(families), true)
        assertNumbers(families, 'keys')
      }
    })
  }
})

// The standing figure carries every block the bust does.
test('every field takes every bad value without a throw', () => {
  for (const path of distinctPaths(fullBody)) {
    for (const [index, value] of BAD_VALUES.entries()) {
      const damaged = withValue(fullBody, path, value)
      try {
        // A field of the package is the package's own check to make; the manifest's goes over every mesh besides.
        if (path[0] === 'anime25dPlayback' && path.length > 1) answers(() => isAnime25DPlayback(damaged.anime25dPlayback))
        else answers(() => isLiveMeropeManifest(damaged))
      } catch (error) {
        assert.fail(`${path.join('.')} as BAD_VALUES[${index}]: ${String(error)}`)
      }
    }
  }
})

test('a texture is the site\'s own picture or the page\'s own blob, however the address is spelled', () => {
  const withUrl = (url: unknown) => isRigManifest(withValue(bust, ['textures', 0, 'url'], url))
  for (const url of [`/api/merope/rig/assets/${'a'.repeat(64)}`, '/atlas.png', '/media/assets/a.b/c..d.png?v=2#x', 'preview://rig-atlas', 'blob:https://site.example/0f0e']) {
    assert.equal(withUrl(url), true, url)
  }
  for (const url of [...BAD_URLS, 'preview://rig-atlas/..', 'preview://x.example', '', ' ', null, 7, {}]) assert.equal(withUrl(url), false, JSON.stringify(url)?.slice(0, 80))
  // Put together at random, an address let through is still on the site, with nothing to resolve in its path.
  const pieces = ['/', '//', '\\', '..', '.', '%2e', '%2E%2e', '%2f', '%5c', '%', 'api', 'a.png', ':', '@', '?', '#', '\t', '\n', ' ', 'https:', 'blob:', 'x.example', '\u0000', '\u202E', '／']
  for (let seed = 0; seed < SEEDS; seed += 1) {
    const random = mulberry32(0x0421_0000 + seed)
    const url = `${random() < 0.7 ? '/' : ''}${Array.from({ length: 1 + Math.floor(random() * 7) }, () => pieces[Math.floor(random() * pieces.length)]).join('')}`
    if (withUrl(url)) assertOwnUrl(url, `seed ${seed}: ${JSON.stringify(url)}`)
  }
})

/** A guard's answer, in time. */
function answers(guard: () => boolean): boolean {
  const started = performance.now()
  const answer = guard()
  const took = performance.now() - started
  assert.ok(took < SLOWEST_MS, `took ${took.toFixed(0)} ms`)
  return answer
}

/** Names the seed and what it did: enough to replay it, or to see it without. */
function replayable(seed: number, mutations: readonly Mutation[], run: () => void): void {
  try {
    run()
  } catch (error) {
    const changes = mutations.map(({ path, what }) => `  ${path.join('.').slice(0, 120)} ${what.slice(0, 120)}`).join('\n')
    throw new Error(`seed ${seed}: ${String(error instanceof Error ? error.message : error)}\n${changes}`, { cause: error })
  }
}

/** What the runtime takes for granted of a manifest, said again without the validation's own code. */
function assertPlayable(manifest: MeropeRigManifest, changedLayers: Iterable<number>): void {
  assert.ok(manifest.rigIrVersion === undefined || (manifest.rigIrVersion >= MIN_SUPPORTED_RIG_IR_VERSION && manifest.rigIrVersion <= RIG_IR_VERSION))
  assert.ok(manifest.characterAssetContractVersion === undefined
    || manifest.characterAssetContractVersion === CHARACTER_ASSET_PROFILES[manifest.profile ?? 'bust'].contractVersion)
  assert.ok(manifest.textures.length <= MAX_RIG_TEXTURES && manifest.bones.length <= MAX_RIG_BONES && manifest.parts.length <= MAX_RIG_PARTS)
  assert.ok((manifest.spatialProfile?.collisionVolumes.length ?? 0) <= MAX_RIG_COLLISION_VOLUMES)
  for (const texture of manifest.textures) {
    assertOwnUrl(texture.url, texture.url)
    assert.ok(texture.width <= 16_384 && texture.height <= 16_384)
  }
  const textures = new Set(manifest.textures.map((texture) => texture.id))
  const bones = new Map(manifest.bones.map((bone) => [bone.id, bone.parent]))
  for (const id of bones.keys()) {
    let at: string | null | undefined = id
    for (let steps = 0; at !== null; steps += 1) {
      assert.ok(at !== undefined && steps <= bones.size, `bone ${id} has no root`)
      at = bones.get(at)
    }
  }
  let vertices = 0
  for (const part of manifest.parts) {
    assert.ok(textures.has(part.textureId))
    vertices += part.vertices.length
    assert.ok(part.vertices.length <= MAX_RIG_VERTICES_PER_PART)
    assert.ok(part.indices.every((index) => Number.isInteger(index) && index >= 0 && index < part.vertices.length))
    for (const vertex of part.vertices) assert.ok(vertex.joints.every((joint) => Number.isInteger(joint) && joint >= 0 && joint < manifest.bones.length))
  }
  assert.ok(vertices <= MAX_RIG_TOTAL_VERTICES)
  const { anime25dPlayback, ...rest } = manifest
  assertNumbers(READ_OF_MANIFEST.map((key) => rest[key]), 'manifest')
  assertSizes(READ_OF_MANIFEST.map((key) => rest[key]), 'manifest')
  if (anime25dPlayback) assertPlayablePackage(anime25dPlayback, changedLayers)
}

function assertPlayablePackage(playback: Anime25DPlayback, changedLayers: Iterable<number>): void {
  const read = READ_OF_PACKAGE.map((key) => playback[key])
  assertNumbers(read, 'package')
  assertSizes(read, 'package')
  const { width, height } = playback.pixelCanvas
  assert.ok(width > 0 && height > 0 && width <= 16_384 && height <= 16_384)
  assert.ok(playback.layers.length > 0 && playback.layers.length <= MAX_RIG_PARTS)
  for (const { name, role, atlas, w, h } of playback.layers) {
    assert.ok(typeof name === 'string' && typeof role === 'string')
    assert.ok(w > 0 && h > 0)
    assert.ok(atlas.x >= 0 && atlas.y >= 0 && atlas.w > 0 && atlas.h > 0 && atlas.x + atlas.w < 1.001 && atlas.y + atlas.h < 1.001)
  }
  for (const index of new Set(changedLayers)) {
    const source = playback.layers[index]
    if (!source) continue
    // As the player builds it: by the role its name gives it and the group its role does.
    const mesh = buildAnime25DLayerBinding({
      source: resolveAnime25DLayerSemantics(source),
      canvasWidth: width,
      face: playback.anchors.face,
      layerZ: index,
      faceShell: playback.shellProfile,
      figure: playback.anchors.groundY !== undefined,
    })
    const vertices = mesh.rest.length / 2
    assert.ok(vertices <= 65_535, `${vertices} vertices`)
    assert.equal(mesh.indices.length, mesh.cols * mesh.rows * 6)
    assert.ok(mesh.indices.length > 0 && mesh.indices.every((vertex) => vertex < vertices))
    for (const numbers of [mesh.rest, mesh.atlasUvs, mesh.strandWeights, mesh.alongStrand, mesh.bangWeights, mesh.frontHairParallaxScale]) {
      assert.ok(numbers?.every(Number.isFinite) ?? true, 'mesh numbers')
    }
  }
}

/** The fields the runtime reads; one it does not know may hold anything. */
const READ_OF_MANIFEST = ['canvas', 'textures', 'bones', 'parts', 'motionProfile', 'outfitProfile', 'semanticAnchors', 'semantics', 'spatialProfile'] as const
const READ_OF_PACKAGE = ['pixelCanvas', 'layers', 'anchors', 'mouthProfile', 'chestProfile', 'shellProfile', 'turnKeyforms', 'bodyTurnKeyforms', 'partProfile', 'enhancement', 'figureStance'] as const

/** Keys added beside the known ones: nothing reads them. */
const UNREAD = new Set(['__proto__', 'constructor', 'toString', 'extra'])

/** Every number is one, and still is in a Float32Array (the motion seed is an integer of 32 bits). */
function assertNumbers(value: unknown, at: string): void {
  if (typeof value === 'number') assert.ok(Number.isFinite(value) && Math.abs(value) <= 4_294_967_295, `${at} = ${value}`)
  if (value === null || typeof value !== 'object') return
  for (const [key, held] of Object.entries(value)) {
    if (!UNREAD.has(key) && key.length < 1000) assertNumbers(held, `${at}.${key}`)
  }
}

/** Nothing is so long that going over it once a frame, or once a load, is work to speak of. */
function assertSizes(value: unknown, at: string): void {
  if (typeof value === 'string') assert.ok(value.length <= 2048, `${at}: ${value.length} characters`)
  if (Array.isArray(value)) assert.ok(value.length <= MAX_RIG_VERTICES_PER_PART * 6, `${at}: ${value.length} items`)
  if (value === null || typeof value !== 'object') return
  for (const [key, held] of Object.entries(value)) {
    if (!UNREAD.has(key) && key.length < 1000) assertSizes(held, `${at}.${key}`)
  }
}

/** As a browser resolves it on the site's page. */
function assertOwnUrl(url: string, message: string): void {
  const page = 'https://site.example/figure/page'
  const resolved = new URL(url, page)
  if (resolved.protocol === 'blob:') return
  assert.equal(resolved.origin, 'https://site.example', message)
  assert.ok(resolved.pathname.startsWith('/') && !resolved.pathname.startsWith('//'), message)
  const typed = url.split(/[?#]/u)[0]
  assert.equal(decodeURIComponent(resolved.pathname).split('/').includes('..'), false, message)
  assert.equal(decodeURIComponent(typed).split(/[/\\]/u).includes('..'), false, message)
}

type Path = Array<string | number>

/** One path to each kind of field: a list's first item stands for the rest, but for layers, one of each kind. */
function distinctPaths(root: unknown): Path[] {
  const found: Path[] = []
  const walk = (value: unknown, path: Path) => {
    if (path.length > 0) found.push(path)
    if (value === null || typeof value !== 'object') return
    if (!Array.isArray(value)) {
      for (const [key, held] of Object.entries(value)) walk(held, [...path, key])
      return
    }
    const shapes = new Set<string>()
    for (const [index, held] of value.entries()) {
      const shape = held !== null && typeof held === 'object' ? Object.entries(held).map(([key, v]) => `${key}:${v === null ? 'null' : typeof v}`).join() : typeof held
      if (shapes.has(shape)) continue
      shapes.add(shape)
      walk(held, [...path, index])
    }
  }
  walk(root, [])
  return found
}

/** A copy with one field changed, sharing the rest. */
function withValue<T>(root: T, path: Path, value: unknown): T {
  if (path.length === 0) return value as T
  const [key, ...rest] = path
  const copy = (Array.isArray(root) ? [...root] : { ...root }) as Record<string | number, unknown>
  Object.defineProperty(copy, key, { value: withValue(copy[key], rest, value), configurable: true, enumerable: true, writable: true })
  return copy as T
}
