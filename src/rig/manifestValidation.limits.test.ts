import type { Anime25DArmModel, Anime25DPlayback, Anime25DPlaybackLayer } from '../anime25drig/types'
import type { MeropeRigManifest } from './types'
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAnime25DLayerBinding } from '../anime25drig/layerBinding'
import { isLiveMeropeManifest, isRigManifest } from './manifestValidation'
import { legalManifest } from './rigFuzz.fixture'
import { isDocumentTurnKeyforms } from './turnKeyformImport'

/**
 * Each limit by name, with the one input it is there for: the fuzz cases next door wander over all of them, but a
 * seed need not land on the one that was dropped.
 */
const figure = await legalManifest('fullBody')

const layerOf = (playback: Anime25DPlayback, role: string): Anime25DPlaybackLayer => playback.layers.find((layer) => layer.role === role)!
const armOf = (playback: Anime25DPlayback): Anime25DArmModel => playback.layers.find((layer) => layer.armVariant?.model)!.armVariant!.model!
/** A layer beside the figure's own. */
function added(playback: Anime25DPlayback, changes: Partial<Anime25DPlaybackLayer>): void {
  playback.layers.push({ ...structuredClone(layerOf(playback, 'face')), name: 'added', strands: [], ...changes })
}
const strands = (xs: readonly number[]) => xs.map((x) => ({ x, rootY: 10, tipY: 90 }))
const ringOf = (x0: number, y0: number, x1: number, y1: number): Array<[number, number]> => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
/** A head drawing's size, to be meshed in this many cells across and down: each is 3% of the face's width. */
function cells({ anchors: { face } }: Anime25DPlayback, across: number, down = across): { w: number; h: number } {
  const edge = Math.max(4, (face.x1 - face.x0) * 0.03)
  return { w: across * edge, h: down * edge }
}
/** Hair over the whole of a frame as large as any, and something that hangs in it. */
function hairPiece(p: Anime25DPlayback, box: [number, number, number, number]): void {
  p.pixelCanvas = { width: 8192, height: 8192 }
  added(p, { role: 'back-hair', phys: 'hair', name: 'hair', x: 0, y: 0, w: 8192, h: 8192 })
  Object.assign(p.partProfile!.parts[0], { layer: 'hair', bone: 'head', motion: 'dangle', separate: false, box, anchor: [(box[0] + box[2]) / 2, box[1]] })
}
/** As an untyped source may write it. */
function put(holder: unknown, key: string | number, value: unknown): void {
  Object.assign(holder as object, { [key]: value })
}

const REFUSED_PACKAGES: ReadonlyArray<readonly [string, (playback: Anime25DPlayback) => void]> = [
  ['a mesh too fine, by the group its role puts it in', (p) => added(p, { role: 'irides', group: 'body', w: 2000, h: 2000 })],
  ['a mesh too fine, by the role its name gives it', (p) => added(p, { role: 'unknown', name: 'eyes', group: 'head', w: 500, h: 500 })],
  ['a mesh too fine, by both', (p) => added(p, { role: 'unknown', name: 'eyelash', group: 'body', w: 3000, h: 3000 })],
  ['a mesh past what its indices reach', (p) => added(p, { role: 'nose', ...cells(p, 256) })],
  ['meshes past the most together', (p) => {
    for (let i = 0; i < 9; i += 1) added(p, { role: 'nose', ...cells(p, 250), atlas: { x: 0, y: 0, w: 0.1, h: 0.1 } })
  }],
  ['a piece that may be meshed past what its indices reach, cut from hair that is not', (p) => hairPiece(p, [3000, 3000, 4400, 4400])],
  ['layers with a place left empty', (p) => { delete p.layers[1] }],
  ['strands with a place left empty', (p) => {
    put(p.layers[0], 'strands', strands([10, 20]))
    delete p.layers[0].strands[0]
  }],
  ['parts with a place left empty', (p) => { delete p.partProfile!.parts[0] }],
  ['an arm\'s widths with a place left empty', (p) => { delete armOf(p).radius[3] }],
  ['an outline with a place left empty', (p) => { delete armOf(p).handOutline[0][1] }],
  ['a key with a place left empty', (p) => { delete p.turnKeyforms!.face.plus.back[2] }],
  ['a key\'s box with a place left empty', (p) => { delete (p.turnKeyforms!.face.minus.box as number[])[1] }],
  ['a correction with a place left empty', (p) => { delete p.shellProfile.poseCorrections![0] }],
  ['a top meshed past what its indices reach, by the face of the figure that stands in it', (p) => {
    p.pixelCanvas = { width: 8192, height: 8192 }
    added(p, { role: 'topwear', group: 'body', w: 8192, h: 8192 })
  }],
  ['a lock drawn finer than any picture', (p) => added(p, { role: 'front-hair', phys: 'hair', w: 0.5, h: 0.5, atlas: { x: 0, y: 0, w: 1, h: 1 } })],
  ['locks too far apart to put together', (p) => {
    for (const at of [-4000, 4000]) added(p, { role: 'front-hair', phys: 'hair', x: at, y: at })
  }],
  ['locks past what is read of them', (p) => {
    for (let i = 0; i < 40; i += 1) added(p, { role: 'front-hair', phys: 'hair', x: 50 * i, y: 50 * i, w: 2000, h: 2000, atlas: { x: 0, y: 0, w: 0.1, h: 0.1 } })
  }],
  ['a layer wider than a frame', (p) => put(p.layers[0], 'w', 8193)],
  ['a layer too thin to mesh', (p) => put(p.layers[0], 'h', 0.1)],
  ['a layer off every frame', (p) => put(p.layers[0], 'x', 1e308)],
  ['a depth past any', (p) => put(p.layers[0], 'depth', 5)],
  ['a fade nobody draws', (p) => put(p.layers[0], 'fade', 'constructor')],
  ['a side nobody has', (p) => put(p.layers[0], 'side', 'left')],
  ['a group that is none', (p) => put(p.layers[0], 'group', 'arm')],
  ['a name of no text', (p) => put(p.layers[0], 'name', null)],
  ['an atlas cut past its edge', (p) => put(p.layers[0], 'atlas', { x: 0.5, y: 0, w: 0.6, h: 1 })],
  ['the whole atlas cut out over and over', (p) => {
    for (let i = 0; i < 5; i += 1) added(p, { role: 'objects', group: 'body', w: 20, h: 20, atlas: { x: 0, y: 0, w: 1, h: 1 } })
  }],
  ['layers past the most', (p) => {
    for (let i = p.layers.length; i <= 128; i += 1) added(p, { role: 'objects', group: 'body', w: 20, h: 20, atlas: { x: 0, y: 0, w: 0.01, h: 0.01 } })
  }],
  ['strands in one place', (p) => put(p.layers[0], 'strands', strands([10, 10]))],
  ['strands right to left', (p) => put(p.layers[0], 'strands', strands([20, 10]))],
  ['strands past the most', (p) => put(p.layers[0], 'strands', strands(Array.from({ length: 33 }, (_, i) => i)))],
  ['a frame past the most', (p) => put(p.pixelCanvas, 'width', 8193)],
  ['a face with no width', (p) => put(p.anchors.face, 'x1', p.anchors.face.x0)],
  ['a face with no height', (p) => put(p.anchors.face, 'y1', p.anchors.face.y0)],
  ['a mouth inside out', (p) => put(p.anchors.mouth, 'x1', p.anchors.mouth.x0 - 1)],
  ['an eye inside out', (p) => put(p.anchors.eyeL, 'y1', p.anchors.eyeL!.y0 - 1)],
  ['an eye with no lid line', (p) => put(p.anchors.eyeL, 'closeY', undefined)],
  ['a face scale of nothing', (p) => put(p.anchors, 'faceScale', 0)],
  ['a neck nowhere', (p) => put(p.anchors, 'neckPivot', { x: 1 })],
  ['a neck with no top', (p) => put(p.anchors, 'neckTop', null)],
  ['a neck with no bottom', (p) => put(p.anchors, 'neckBottom', null)],
  ['a body that turns nowhere', (p) => put(p.anchors, 'bodyPivot', {})],
  ['a face with no middle', (p) => put(p.anchors.face, 'cx', null)],
  ['a mouth with no middle', (p) => put(p.anchors.mouth, 'cy', null)],
  ['an eye with no iris', (p) => put(p.anchors.eyeL, 'icx', null)],
  ['physics of another kind', (p) => put(p.layers[0], 'phys', 'cloth')],
  ['a layer made or not by neither', (p) => put(p.layers[0], 'synthetic', 1)],
  ['a forearm of no length', (p) => put(armOf(p), 'fore', 0)],
  ['a hanging forearm of no length', (p) => put(armOf(p), 'restFore', 0)],
  ['a hanging elbow nowhere', (p) => put(armOf(p).rest, 'elbow', [1, 2, 1e308])],
  ['a hand of four fingers', (p) => put(armOf(p), 'fingers', [1, 1, 1, 1])],
  ['a finger of no width at all', (p) => put(armOf(p).fingerProfile, 0, [-1])],
  ['a palm past any hand', (p) => put(armOf(p), 'palmOutline', [[0, 0], [1, 0], [0, 1e308]])],
  ['a part\'s box of three numbers', (p) => put(p.partProfile!.parts[0], 'box', [0, 0, 1])],
  ['a part stiffer than stiff', (p) => put(p.partProfile!.parts[0], 'stiffness', 2)],
  ['a family\'s name without end', (p) => put(p.turnKeyforms, 'x'.repeat(65), p.turnKeyforms!.face)],
  ['a ground of no number', (p) => put(p.anchors, 'groundY', '9')],
  ['a joint of no name', (p) => put(p.anchors.skeleton!.joints, 'toString', { x: 1, y: 1, score: 1 })],
  ['a joint nowhere', (p) => put(p.anchors.skeleton!.joints.kneeL, 'y', null)],
  ['a joint surer than sure', (p) => put(p.anchors.skeleton!.joints.kneeL, 'score', 1e9)],
  ['a torso deeper than itself', (p) => put(p.shellProfile.torso, 'neckDepth', 2)],
  ['an engine\'s address of no text', (p) => put(p, 'engineUrl', {})],
  ['an engine\'s address without end', (p) => put(p, 'engineUrl', 'x'.repeat(513))],
  ['a licence without end', (p) => put(p, 'license', 'x'.repeat(513))],
  ['a copyright without end', (p) => put(p, 'copyright', 'x'.repeat(513))],
  ['a stance nobody stands', (p) => put(p, 'figureStance', 'sit')],
  ['an enhancement that is not yes or no', (p) => put(p.enhancement, 'turn', 'yes')],
  ['a part that moves no way', (p) => put(p.partProfile!.parts[0], 'motion', 'valueOf')],
  ['parts past the most', (p) => put(p.partProfile, 'parts', Array.from({ length: 65 }, () => p.partProfile!.parts[0]))],
  ['a gesture arm lifted no way', (p) => put(p.layers.find((layer) => layer.armVariant)!.armVariant, 'lift', 'all')],
  ['an arm of no width', (p) => put(armOf(p).radius, 3, 0)],
  ['an arm of no length', (p) => put(armOf(p), 'upper', 0)],
  ['a bare forearm of no width', (p) => put(armOf(p), 'bare', 0)],
  ['a drawn arm measured in fewer places', (p) => put(armOf(p), 'drawnRadius', [1, 2])],
  ['a reach measured in fewer places', (p) => put(armOf(p), 'restReach', [null])],
  ['a cuff at the elbow', (p) => { put(armOf(p), 'restCuff', 0); put(armOf(p), 'cuffFrom', 0) }],
  ['a pixel of no size', (p) => put(armOf(p), 'trialPixel', 0)],
  ['a hand all in one place', (p) => put(armOf(p), 'hand', Array.from({ length: 21 }, () => [10, 10]))],
  ['a hanging hand all in one place', (p) => put(armOf(p), 'restHand', Array.from({ length: 21 }, () => [10, 10]))],
  ['a hand short of points', (p) => put(armOf(p), 'hand', armOf(p).hand.slice(1))],
  ['an arm joint of two numbers', (p) => put(armOf(p).raised, 'wrist', [1, 2])],
  ['a finger no hand has', (p) => put(armOf(p), 'hiddenFingers', [5])],
  ['a colour past white', (p) => put(armOf(p), 'skin', [256, 0, 0])],
  ['an outline far off its layer', (p) => put(armOf(p), 'armOutline', [ringOf(0, 0, 1e6, 10)])],
  ['outlines past the most', (p) => put(armOf(p), 'armOutline', Array.from({ length: 257 }, () => []))],
  ['an outline of points without end', (p) => put(armOf(p), 'handOutline', [Array.from({ length: 16_385 }, () => [0, 0])])],
  ['a ground larger than a frame', (p) => {
    const layer = p.layers.find((each) => each.armVariant?.model)!
    layer.w = 2000
    layer.h = 2000
    put(armOf(p), 'ground', [ringOf(-2000, -2000, 4000, 4000)])
  }],
  ['a key with no room', (p) => put(p.turnKeyforms!.face.plus, 'box', [10, 10, 10, 20])],
  ['a key off every frame', (p) => put(p.turnKeyforms!.face.plus.box, 2, 1e308)],
  ['a key moved off every frame', (p) => put(p.bodyTurnKeyforms!.topwear.minus.back, 0, -1e308)],
  ['a key that multiplies by two numbers', (p) => put(p.turnKeyforms!.face.plus, 'multiply', [1, 1])],
  ['a key that multiplies without end', (p) => put(p.turnKeyforms!.face.plus, 'multiply', [1, 1, 1e308])],
  ['families past the most', (p) => {
    for (let i = 0; i < 129; i += 1) put(p.turnKeyforms, `family-${i}`, p.turnKeyforms!.face)
  }],
]

const REFUSED_MANIFESTS: ReadonlyArray<readonly [string, (manifest: MeropeRigManifest) => void]> = [
  ['a slot every object has', (m) => { put(m.parts[0], 'slot', 'constructor'); put(m.parts[0], 'variant', 'name') }],
  ['a texture named by a number', (m) => { put(m.textures[0], 'id', '7'); for (const part of m.parts) put(part, 'textureId', 7) }],
  ['a texture named by what has no name', (m) => put(m.parts[0], 'textureId', { toString: null, valueOf: null })],
  ['a preview of something else', (m) => put(m.textures[0], 'url', 'preview://rig-atlas/..')],
  ['a slot\'s name without end', (m) => put(m.parts[0], 'slot', 'x'.repeat(65))],
  ['a name for an anchor without end', (m) => put(m, 'semanticAnchors', { ['x'.repeat(65)]: m.semanticAnchors!.chest })],
  ['a portrait\'s name without end', (m) => put(m, 'sourceMasterAssetId', 'x'.repeat(513))],
  ['a texture without end', (m) => put(m.textures[0], 'width', 16_385)],
  ['a canvas without end', (m) => put(m.canvas, 'height', 1e308)],
  ['an id without end', (m) => { put(m.textures[0], 'id', 'x'.repeat(513)); for (const part of m.parts) put(part, 'textureId', m.textures[0].id) }],
  ['a vertex off every canvas', (m) => put(m.parts[0].vertices[0].position, 'x', 1e308)],
  ['a vertex left out', (m) => { delete m.parts[0].vertices[1] }],
  ['a corner left out', (m) => { delete m.parts[0].indices[1] }],
  ['a collision volume left out', (m) => { delete m.spatialProfile!.collisionVolumes[0] }],
  ['a depth off every stack', (m) => put(m.parts[0], 'zIndex', 1e308)],
  ['triangles without end', (m) => put(m.parts[0], 'indices', Array.from({ length: 16_384 * 6 + 3 }, () => 0))],
  ['anchors without end', (m) => {
    put(m, 'semanticAnchors', Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`a${i}`, m.semanticAnchors!.chest])))
  }],
]

test('the manifest the cases start from is live', () => {
  assert.equal(isLiveMeropeManifest(figure), true)
})

for (const [name, damage] of REFUSED_PACKAGES) {
  test(`refused: ${name}`, () => {
    const manifest = structuredClone(figure)
    damage(manifest.anime25dPlayback!)
    assert.equal(isLiveMeropeManifest(manifest), false)
  })
}

for (const [name, damage] of REFUSED_MANIFESTS) {
  test(`refused: ${name}`, () => {
    const manifest = structuredClone(figure)
    damage(manifest)
    assert.equal(isRigManifest(manifest), false)
  })
}

test('an archive\'s keys on a document no texture holds are refused', () => {
  const { turnKeyforms: keyforms } = figure.anime25dPlayback!
  assert.equal(isDocumentTurnKeyforms({ canvas: [4096, 4096], keyforms }), true)
  assert.equal(isDocumentTurnKeyforms({ canvas: [16_385, 4096], keyforms }), false)
  assert.equal(isDocumentTurnKeyforms({ canvas: [4096, Infinity], keyforms }), false)
})

test('what the importer and the server may well make is let through', () => {
  const accepted = (change: (manifest: MeropeRigManifest) => void) => {
    const manifest = structuredClone(figure)
    change(manifest)
    return isLiveMeropeManifest(manifest)
  }
  // An import is compiled once as a preview, before its atlas has an address.
  assert.equal(accepted((m) => put(m.textures[0], 'url', 'preview://rig-atlas')), true)
  // Eye or mouth art one pixel thick: its bounds are its first and last rows.
  assert.equal(accepted(({ anime25dPlayback: p }) => put(p!.anchors.eyeL, 'y1', p!.anchors.eyeL!.y0)), true)
  assert.equal(accepted(({ anime25dPlayback: p }) => put(p!.anchors.mouth, 'y1', p!.anchors.mouth.y0)), true)
  assert.equal(accepted(({ anime25dPlayback: p }) => put(armOf(p!), 'ground', undefined)), true)
  // A veil, or both tails' ribbons in one layer: 3 × 5 and 4.4 × 6.4 of the face's width, 16,968 and 31,458 vertices.
  for (const [across, down, vertices] of [[100, 167, 16_968], [146, 213, 31_458]] as const) {
    const veil = structuredClone(figure)
    const playback = veil.anime25dPlayback!
    added(playback, { role: 'headwear', name: 'headwear', ...cells(playback, across, down) })
    assert.equal(isLiveMeropeManifest(veil), true, `${across} × ${down} cells`)
    const mesh = buildAnime25DLayerBinding({ source: playback.layers.at(-1)!, canvasWidth: playback.pixelCanvas.width, face: playback.anchors.face, layerZ: 0, figure: true })
    assert.equal(mesh.rest.length / 2, vertices)
    assert.equal(mesh.indices.reduce((most, index) => Math.max(most, index)), vertices - 1)
  }
  // Eight of them, as no figure wears.
  assert.equal(accepted(({ anime25dPlayback: p }) => {
    for (let i = 0; i < 8; i += 1) added(p!, { role: 'headwear', ...cells(p!, 146, 213), atlas: { x: 0, y: 0, w: 0.1, h: 0.1 } })
  }), true)
  // Locks cut from hair as long as a figure, on an atlas drawn twice as fine.
  assert.equal(accepted((m) => {
    m.textures[0].width *= 2
    m.textures[0].height *= 2
    for (let i = 0; i < 8; i += 1) added(m.anime25dPlayback!, { role: 'front-hair', phys: 'hair', x: 100 * i, y: 0, w: 400, h: 2000, atlas: { x: 0, y: 0, w: 0.1, h: 0.1 } })
  }), true)
  // What hangs in hair over the whole of a frame is looked for around its own box only.
  assert.equal(accepted(({ anime25dPlayback: p }) => hairPiece(p!, [3000, 3000, 3200, 3400])), true)
  // Credited otherwise, as a package made before or after this one may be.
  assert.equal(accepted(({ anime25dPlayback: p }) => {
    put(p, 'engineUrl', 'https://github.com/someone/Anime2.5DRig')
    put(p, 'license', 'Apache-2.0')
    put(p, 'copyright', undefined)
  }), true)
})
