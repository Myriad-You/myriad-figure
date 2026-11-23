import type { Anime25DTurnKeyforms } from '../anime25drig/turnKeyforms'
import type { Anime25DArmModel, Anime25DPartProfile, Anime25DPlayback } from '../anime25drig/types'
import type { CharacterAssetProfile } from './contract'
import type { MeropeRigImportSource, MeropeRigManifest } from './types'
import { prepareAnime25DRigPsd } from './anime25dImporter'
import { syntheticSeeThroughPsd } from './anime25dImporter.fixture'
import { CHARACTER_ASSET_PROFILES, RIG_IR_VERSION, RIG_SCHEMA_VERSION } from './contract'

/** The same numbers for the same seed, so a failing seed is replayed by its number. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/**
 * A manifest as the server hands one back, carrying every optional block the runtime reads: what the importer
 * makes of the synthetic PSD, with the keys, parts and gesture arm a server adds.
 */
export async function legalManifest(profile: CharacterAssetProfile): Promise<MeropeRigManifest> {
  const prepared = await withFakeImportCanvas(() =>
    prepareAnime25DRigPsd(syntheticSeeThroughPsd(), { sourceMasterAssetId: '/api/merope/portrait.png', profile }))
  const { source } = prepared
  const playback = source.anime25dPlayback!
  dressPlayback(playback, profile)
  // As it arrives: parsed from JSON, which drops what the importer left undefined.
  const json = JSON.stringify(manifestOf(source, profile))
  return JSON.parse(json) as MeropeRigManifest
}

function manifestOf(source: MeropeRigImportSource, profile: CharacterAssetProfile): MeropeRigManifest {
  const boneIds = source.bones.map((bone) => bone.id)
  return {
    schemaVersion: RIG_SCHEMA_VERSION,
    rigIrVersion: RIG_IR_VERSION,
    characterAssetContractVersion: CHARACTER_ASSET_PROFILES[profile].contractVersion,
    ...(profile === 'fullBody' ? { profile } : {}),
    sourceMasterAssetId: source.sourceMasterAssetId,
    sourceGenerationFingerprint: '0123456789abcdef'.repeat(4),
    quality: 'layered-2d',
    canvas: source.canvas,
    textures: [{ id: source.atlas.id, url: `/api/merope/rig/assets/${'a'.repeat(64)}`, width: source.atlas.width, height: source.atlas.height }],
    bones: source.bones,
    parts: source.layers.map((layer) => ({
      id: layer.id,
      textureId: layer.textureId,
      zIndex: layer.zIndex,
      opacity: layer.opacity,
      ...(layer.slot && layer.variant ? { slot: layer.slot, variant: layer.variant } : {}),
      vertices: [[0, 0], [1, 0], [0, 1]].map(([u, v]) => ({
        position: { x: layer.contours[0]?.[0]?.x ?? 0.5, y: layer.contours[0]?.[0]?.y ?? 0.5 },
        uv: { x: u, y: v },
        joints: [Math.max(0, boneIds.indexOf(layer.boneHandles[0]?.boneId ?? 'root')), 0, 0, 0] as [number, number, number, number],
        weights: [0.75, 0.25, 0, 0] as [number, number, number, number],
      })),
      indices: [0, 1, 2],
    })),
    motionProfile: source.motionProfile ?? {
      seed: 42,
      breath: { minFrequencyHz: 0.16, maxFrequencyHz: 0.28, amplitude: 0.004 },
      blink: { minIntervalSeconds: 2.5, maxIntervalSeconds: 7, durationSeconds: 0.24, doubleChance: 0.15 },
      secondary: { enabled: true, frequencyHz: 2.1, dampingRatio: 0.5, response: 0.6 },
    },
    outfitProfile: { topologies: ['fitted', 'long-skirt'], secondaryPartIds: [source.layers[0].id], torsoTwistScale: 0.9, secondaryMotionScale: 0.8 },
    semanticAnchors: { forehead: { boneId: 'head', offset: { x: 0, y: -0.2 } }, chest: { boneId: 'body', offset: { x: 0, y: 0.1 } } },
    semantics: { bones: { root: 'root', torso: 'body', head: 'head' }, chains: { torso: ['root', 'body', 'head'] }, secondaryBoneIds: ['head'] },
    spatialProfile: { collisionVolumes: [{ id: 'torso', boneId: 'body', offset: { x: 0, y: 0 }, radius: { x: 0.2, y: 0.3 }, padding: 0.01 }] },
    anime25dPlayback: source.anime25dPlayback,
  }
}

function dressPlayback(playback: Anime25DPlayback, profile: CharacterAssetProfile): void {
  const { width, height } = playback.pixelCanvas
  const { face } = playback.anchors
  const lattice = (box: [number, number, number, number], dx: number, grid: number) => ({
    box, grid, back: Array.from({ length: grid * grid * 2 }, (_, i) => (i % 2 ? 0.5 : dx)),
  })
  const key = (box: [number, number, number, number], grid = 3) => ({
    plus: { ...lattice(box, -4, grid), multiply: [0.98, 0.99, 1] as [number, number, number] },
    minus: { ...lattice(box, 4, grid), multiply: [1.02, 1, 0.99] as [number, number, number] },
    up: lattice(box, 1, grid),
    down: lattice(box, -1, grid),
  })
  const head: [number, number, number, number] = [face.x0, face.y0, face.x1, face.y1]
  const families: Anime25DTurnKeyforms = {}
  for (const family of ['face', 'front-hair', 'back-hair', 'eye:L', 'eye:R', 'mouth', 'neck']) families[family] = key(head)
  playback.turnKeyforms = families
  playback.enhancement = { turn: true, expressions: false, body: profile === 'fullBody', arms: true }
  playback.partProfile = partProfile(playback)
  playback.anchors.skeleton = {
    model: 'dwpose',
    joints: {
      shoulderL: { x: width * 0.3, y: height * 0.5, score: 0.9 },
      elbowL: { x: width * 0.25, y: height * 0.6, score: 0.9 },
      wristL: { x: width * 0.22, y: height * 0.7, score: 0.8 },
      shoulderR: { x: width * 0.7, y: height * 0.5, score: 0.9 },
      ...(profile === 'fullBody'
        ? {
            hipL: { x: width * 0.42, y: height * 0.6, score: 0.8 },
            kneeL: { x: width * 0.42, y: height * 0.78, score: 0.9 },
            ankleL: { x: width * 0.42, y: height * 0.92, score: 0.9 },
            bigToeL: { x: width * 0.42, y: height * 0.97, score: 0.9 },
          }
        : {}),
    },
  }
  playback.shellProfile.poseCorrections = [{
    surface: 'head', at: { angleX: 1, angleY: -1 },
    patches: [{ x: 0, y: 0, radiusX: 0.5, radiusY: 0.5, dx: 0.05, dy: 0.05 }],
  }]
  if (profile === 'fullBody') {
    const body: [number, number, number, number] = [0, height * 0.4, width, height]
    playback.bodyTurnKeyforms = { 'topwear': key(body), 'bottomwear': key(body), 'arm:L': key(body), 'legwear:L': key(body) }
    playback.figureStance = 'float'
  }
  const arm = playback.layers.find((layer) => layer.role === 'handwear')!
  playback.layers.push({
    ...arm,
    name: 'arm-variant-wave-left',
    role: 'arm-variant',
    z: playback.layers.length,
    depth: 1,
    group: 'body',
    phys: null,
    fade: 'armVariant',
    side: 'L',
    strands: [],
    armVariant: { gesture: 'wave', lift: 'whole', model: armModel(arm.w, arm.h, profile === 'fullBody') },
  })
}

function partProfile(playback: Anime25DPlayback): Anime25DPartProfile {
  const host = playback.layers.find((layer) => layer.role === 'front-hair') ?? playback.layers[0]
  const skirt = playback.layers.find((layer) => layer.role === 'bottomwear') ?? host
  const part = (layer: typeof host, bone: string, motion: 'sway' | 'dangle') => ({
    name: `${bone} ribbon`, layer: layer.name, separate: false,
    box: [layer.x, layer.y, layer.x + layer.w / 3, layer.y + layer.h / 3] as [number, number, number, number],
    anchor: [layer.x + layer.w / 6, layer.y] as [number, number],
    bone, motion, material: 'ribbon', stiffness: 0.3, weight: 0.2,
  })
  return { version: 1, source: 'ai-vision', parts: [part(host, 'head', 'dangle'), part(skirt, 'hips', 'sway')] }
}

/** A gesture arm's model on a layer `w` × `h`, with every optional measure. */
function armModel(w: number, h: number, standing: boolean): Anime25DArmModel {
  const ring = (x0: number, y0: number, x1: number, y1: number): Array<[number, number]> => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
  const hand = Array.from({ length: 21 }, (_, i): [number, number] =>
    i === 0 ? [w * 0.5, h * 0.25] : [w * (0.3 + 0.1 * Math.floor((i - 1) / 4)), h * (0.22 - 0.05 * ((i - 1) % 4))])
  const radius = Array.from({ length: 24 }, (_, i) => w * (0.2 - i * 0.002))
  return {
    upper: h * 0.4,
    fore: h * 0.4,
    radius,
    cuff: 0.9,
    bare: w * 0.1,
    bareShift: -1,
    restEnd: 0.49,
    restBand: [0.3, 0.4],
    restReach: radius.map((r, i) => (i % 3 ? [r, r] : null)),
    rest: { shoulder: [w * 0.5, 0, 0], elbow: [w * 0.5, h * 0.4, 0], wrist: [w * 0.5, h * 0.8, 0] },
    raised: { shoulder: [w * 0.5, h * 0.9, 0], elbow: [w * 0.4, h * 0.6, 2], wrist: [w * 0.5, h * 0.25, 4] },
    hand,
    fingers: [4, 4, 4, 4, 4],
    fingerProfile: Array.from({ length: 5 }, () => Array.from({ length: 9 }, () => 4)),
    keyProfile: Array.from({ length: 5 }, (_, i) => (i ? Array.from({ length: 9 }, () => 4) : [])),
    palmOutline: Array.from({ length: 24 }, (_, i): [number, number] => [Math.cos(i / 4) * 0.5 + 0.5, Math.sin(i / 4) * 0.5]),
    hiddenFingers: [0],
    skin: [240, 220, 210],
    shade: [210, 180, 170],
    line: [120, 90, 90],
    handOutline: [ring(w * 0.2, 0, w * 0.8, h * 0.3)],
    armOutline: [ring(w * 0.2, h * 0.2, w * 0.8, h)],
    ground: [ring(0, h * 0.3, w * 0.15, h)],
    ...(standing
      ? { trialPixel: 0.5, restHand: hand.map(([x, y]): [number, number] => [x, y + h * 0.6]), drawnRadius: radius, shortSleeve: 0.4, restFore: h * 0.4, restCuff: 0.95, cuffFrom: 0.8 }
      : {}),
  }
}

/** The importer's 2D canvas, which a Node test has none of. */
async function withFakeImportCanvas<T>(run: () => Promise<T>): Promise<T> {
  const previous = { document: globalThis.document, ImageData: globalThis.ImageData }
  class FakeImageData {
    constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {}
  }
  const canvas = () => ({
    width: 0,
    height: 0,
    getContext: () => ({ putImageData() {}, drawImage() {} }),
    toBlob: (callback: (blob: Blob) => void) => callback(new Blob([new Uint8Array([1])], { type: 'image/png' })),
  })
  Object.assign(globalThis, { ImageData: FakeImageData, document: { createElement: canvas } })
  try {
    return await run()
  } finally {
    Object.assign(globalThis, previous)
  }
}

type Path = Array<string | number>

/** What was done to a manifest, said so a failing seed can be read without replaying it. */
export interface Mutation {
  path: Path
  what: string
}

export const LONG_TEXT = 'x'.repeat(100_000)
/** Values no field means: the wrong kinds, the edges of numbers, text that stands for something elsewhere. */
export const BAD_VALUES: readonly unknown[] = [
  null, undefined, true, false, -1, 0, 1e-320, 0.5, 2.5, 99_999, 1e308, -1e308, Number.NaN, Infinity, -Infinity, -0,
  '', ' ', '0', 'NaN', 'Infinity', LONG_TEXT, '\u0000', 'constructor', '__proto__', 'toString', 'hasOwnProperty',
  [], {}, [null], [[]], { toString: null, valueOf: null }, { length: 1e9 }, { x: 'NaN', y: null },
]
/** Addresses that are not the site's own picture, however they are spelled. */
export const BAD_URLS: readonly string[] = [
  '../atlas.png', '../../etc/passwd', '/api/../../etc/passwd', '/api/%2e%2e/%2E%2e/admin', '/api/..%2f..%2fadmin', '/api/..\\admin', '/a/%5c..%5cb',
  'https://elsewhere.example/a.png', 'http://elsewhere.example/a.png', '//elsewhere.example/a.png', '/\\elsewhere.example/a.png', '\\\\elsewhere.example\\a',
  '/\t/elsewhere.example/a.png', '/\n/elsewhere.example', ' //elsewhere.example', '\u0000//elsewhere.example', 'ht\ntps://elsewhere.example/a.png',
  'javascript:alert(1)', 'java\tscript:alert(1)', 'data:image/svg+xml,<svg onload=alert(1)>', 'data:image/png;base64,AAAA', 'file:///etc/passwd', 'ftp://elsewhere.example/a',
  '/%zz', '/%', '/%c0%ae%c0%ae/admin', 'atlas.png', `/${LONG_TEXT}`,
]

/** One to four changes to a manifest (or a part of one), in place. */
export function mutate(root: unknown, random: () => number): Mutation[] {
  const count = 1 + Math.floor(random() * 4)
  const done: Mutation[] = []
  for (let i = 0; i < count; i += 1) {
    const path = pickPath(root, random)
    if (path.length > 0) done.push({ path, what: mutateAt(root, path, random) })
  }
  return done
}

/** A number or two of a manifest (or a part of one) changed for others a field may be given: its ends, mostly. In place. */
export function mutateNumbers(root: unknown, random: () => number): Mutation[] {
  const count = random() < 0.7 ? 1 : 2
  const done: Mutation[] = []
  while (done.length < count) {
    const path = pickPath(root, random, 0)
    const holder = path.slice(0, -1).reduce<unknown>((at, step) => (at as Record<string | number, unknown>)[step], root) as Record<string | number, unknown>
    const key = path[path.length - 1]
    const held = holder[key]
    // A version is one number or the package is refused: nothing to play.
    if (typeof held !== 'number' || key === 'version') continue
    const others = [0, 0, 1e-3, 1, -1, 255, 8192, 16_384, -16_384, 1e308, -held, held * 0.01, held * 0.5, held * 2, held * 20, held + 1, held + (random() - 0.5) * 400]
    const value = others[Math.floor(random() * others.length)]
    if (value === held) continue
    holder[key] = value
    done.push({ path, what: `${held} → ${value}` })
  }
  return done
}

/**
 * Walks down from the root, stopping sooner or later: every block of a manifest is reached about as often as any
 * other, however many numbers another one holds.
 */
function pickPath(root: unknown, random: () => number, stop = 0.12): Path {
  const path: Path = []
  let at = root
  while (at !== null && typeof at === 'object') {
    const keys = Array.isArray(at) ? Array.from(at.keys()) : Object.keys(at)
    if (keys.length === 0) break
    const key = keys[Math.floor(random() * keys.length)]
    path.push(key)
    at = (at as Record<string | number, unknown>)[key]
    if (random() < stop) break
  }
  return path
}

function mutateAt(root: unknown, path: Path, random: () => number): string {
  const key = path[path.length - 1]
  const holder = path.slice(0, -1).reduce<unknown>((at, step) => (at as Record<string | number, unknown>)[step], root) as Record<string | number, unknown>
  const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)]
  // Own, whatever its name: `__proto__` assigned would be taken for the prototype, as JSON.parse does not.
  const set = (name: string | number, value: unknown) =>
    Object.defineProperty(holder, name, { value, configurable: true, enumerable: true, writable: true })
  const held = holder[key]
  const roll = random()
  if (roll < 0.15) {
    // A list's item goes, or only leaves its place empty.
    if (Array.isArray(holder) && random() < 0.5) holder.splice(Number(key), 1)
    else delete holder[key]
    return 'removed'
  }
  if (roll < 0.25 && Array.isArray(held)) {
    const copies = pick([2, 8, 200, 70_000])
    const item: unknown = held.length > 0 ? pick(held) : 0
    for (let i = 0; i < copies; i += 1) held.push(item)
    return `grown by ${copies}`
  }
  if (roll < 0.35 && typeof held === 'number') {
    const factor = pick([-1, 0, 1e-9, 1e3, 1e9, 1e300])
    set(key, held * factor)
    return `× ${factor}`
  }
  if (roll < 0.5 && typeof held === 'string') {
    const url = pick(BAD_URLS)
    set(key, url)
    return `address ${JSON.stringify(url.slice(0, 60))}`
  }
  if (roll < 0.58) {
    const name = pick(['__proto__', 'constructor', 'toString', 'extra', LONG_TEXT.slice(0, 2000)])
    if (!Array.isArray(holder)) {
      set(name, held)
      return `copied to key ${name.slice(0, 20)}`
    }
  }
  if (roll < 0.66) {
    // Another field's value in its place: the right kind of thing, the wrong one.
    const from = pickPath(root, random)
    const other = from.reduce<unknown>((at, step) => (at as Record<string | number, unknown>)[step], root)
    if (JSON.stringify(other)?.length < 20_000) {
      set(key, structuredClone(other))
      return `taken from ${from.join('.')}`
    }
  }
  const value = pick(BAD_VALUES)
  set(key, structuredClone(value))
  return `= ${typeof value === 'string' ? JSON.stringify(value.slice(0, 40)) : typeof value === 'object' ? JSON.stringify(value) : String(value)}`
}
