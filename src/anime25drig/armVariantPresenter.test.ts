import type { Anime25DGpuLayer } from './layerGpuBinding'
import type { Anime25DPlaybackLayer } from './types'
import assert from 'node:assert/strict'
import test from 'node:test'
import { Anime25DArmVariants, ARM_VARIANT_RISE_SECONDS as RISE } from './armVariantPresenter'
import { IDENTITY_DRIVER } from './driver'

const CANVAS = 1000

function layer(source: Partial<Anime25DPlaybackLayer>, rest: number[]): Anime25DGpuLayer {
  const points = Float32Array.from(rest)
  return {
    source: { name: source.role ?? 'layer', fade: null, side: null, ...source } as Anime25DPlaybackLayer,
    rest: points,
    deformed: points,
    frameOpacity: 1,
    geometryDirty: false,
  } as unknown as Anime25DGpuLayer
}

// The portrait's left arm hangs from a shoulder at (300, 600) to y = 1000.
const arm = () => layer({ role: 'handwear', side: 'L' }, [290, 600, 310, 600, 300, 1000])
const wave = () => layer({ role: 'arm-variant', side: 'L', fade: 'armVariant', armVariant: { gesture: 'wave', lift: 'whole' } }, [250, 300, 350, 300, 300, 800])
const chest = () => layer({ role: 'arm-variant', side: 'L', fade: 'armVariant', armVariant: { gesture: 'chest', lift: 'shoulder' } }, [300, 600, 500, 800])

/** One frame as the player runs it: the face writes opacity, the presenter after it; then the lift. */
function frame(presenter: Anime25DArmVariants, layers: Anime25DGpuLayer[], time: number) {
  for (const each of layers) each.frameOpacity = each.source.fade === 'armVariant' ? 0 : 1
  presenter.applyOpacity(time)
  presenter.applyLift(time)
}

test('raising brings the arm up from below, the portrait arm stays under it until halfway', () => {
  const layers = [arm(), wave()]
  const [base, variant] = layers
  const presenter = new Anime25DArmVariants()
  presenter.bind(layers, CANVAS)
  assert.deepEqual(presenter.gestures(), { L: ['wave'], R: [] })
  assert.notEqual(variant.deformed, variant.rest)
  frame(presenter, layers, 0)
  assert.equal(variant.frameOpacity, 0)
  assert.equal(base.frameOpacity, 1)

  presenter.request('L', 'wave')
  frame(presenter, layers, 1)
  // Opaque at once, a full drop below: 35% of the way from its top (300) to the floor.
  assert.equal(variant.frameOpacity, 1)
  assert.equal(base.frameOpacity, 1)
  assert.equal(variant.deformed[1], 300 + 0.35 * 700)
  assert.equal(variant.geometryDirty, true)
  assert.deepEqual(presenter.raised(), { L: 'wave', R: null })

  frame(presenter, layers, 1 + RISE * 0.4)
  assert.equal(base.frameOpacity, 1)
  frame(presenter, layers, 1 + RISE * 0.75)
  assert.ok(base.frameOpacity > 0.4 && base.frameOpacity < 0.6)
  frame(presenter, layers, 1 + RISE)
  assert.equal(base.frameOpacity, 0)
  assert.equal(variant.deformed[1], 300)
  frame(presenter, layers, 5)
  assert.equal(variant.frameOpacity, 1)
  assert.equal(base.frameOpacity, 0)
})

test('lowering is the rise played backwards and ends hidden at rest', () => {
  const layers = [arm(), wave()]
  const [base, variant] = layers
  const presenter = new Anime25DArmVariants()
  presenter.bind(layers, CANVAS)
  presenter.request('L', 'wave')
  frame(presenter, layers, 0)
  frame(presenter, layers, 1)
  presenter.request('L', null)
  frame(presenter, layers, 2)
  assert.equal(base.frameOpacity, 0)
  assert.equal(variant.frameOpacity, 1)
  assert.deepEqual(presenter.raised(), { L: null, R: null })
  frame(presenter, layers, 2 + RISE * 0.25)
  assert.ok(base.frameOpacity > 0.4 && base.frameOpacity < 0.6)
  // Slow first: a quarter of the way down after half the time.
  frame(presenter, layers, 2 + RISE * 0.5)
  assert.ok(base.frameOpacity > 0.999)
  assert.equal(variant.frameOpacity, 1)
  assert.ok(Math.abs(variant.deformed[1] - (300 + 0.125 * 245)) < 1e-3)
  frame(presenter, layers, 2 + RISE * 1.01)
  assert.equal(variant.frameOpacity, 0)
  assert.equal(base.frameOpacity, 1)
  assert.deepEqual([...variant.deformed], [...variant.rest])
})

test('another gesture on the same side waits for this one to go down; unknown ones put it down', () => {
  const layers = [arm(), wave(), chest()]
  const [, waving, onChest] = layers
  const presenter = new Anime25DArmVariants()
  presenter.bind(layers, CANVAS)
  presenter.request('L', 'wave')
  frame(presenter, layers, 0)
  frame(presenter, layers, 1)
  presenter.request('L', 'chest')
  frame(presenter, layers, 1.01)
  assert.equal(waving.frameOpacity, 1)
  assert.equal(onChest.frameOpacity, 0)
  frame(presenter, layers, 1.01 + RISE)
  frame(presenter, layers, 1.02 + RISE)
  assert.equal(waving.frameOpacity, 0)
  assert.equal(onChest.frameOpacity, 1)
  assert.deepEqual(presenter.raised(), { L: 'chest', R: null })
  presenter.request('L', 'shrug')
  frame(presenter, layers, 3)
  assert.deepEqual(presenter.raised(), { L: null, R: null })
})

test('put down halfway up, the arm goes down from where it is', () => {
  const layers = [arm(), wave()]
  const [, variant] = layers
  const presenter = new Anime25DArmVariants()
  presenter.bind(layers, CANVAS)
  presenter.request('L', 'wave')
  frame(presenter, layers, 0)
  frame(presenter, layers, RISE / 2)
  const before = variant.deformed[1]
  presenter.request('L', null)
  frame(presenter, layers, RISE / 2)
  assert.ok(Math.abs(variant.deformed[1] - before) < 1e-3)
})

test('an arm across the body stays on its shoulder and lifts most at the hand', () => {
  const layers = [arm(), chest()]
  const [, variant] = layers
  const presenter = new Anime25DArmVariants()
  presenter.bind(layers, CANVAS)
  presenter.request('L', 'chest')
  frame(presenter, layers, 0)
  // The vertex at the shoulder does not move; the hand, past 60% of the arm away, takes all of it.
  assert.equal(variant.deformed[1], 600)
  assert.equal(variant.deformed[3], 800 + 0.35 * 400)
})

test('the gesture drivers raise the strongest gesture past half on each side', () => {
  const layers = [arm(), wave(), chest()]
  const [, waving, onChest] = layers
  const presenter = new Anime25DArmVariants()
  presenter.bind(layers, CANVAS)
  presenter.follow({ ...IDENTITY_DRIVER, handWaveL: 0.4, handChestL: 0.45 })
  frame(presenter, layers, 0)
  assert.deepEqual(presenter.raised(), { L: null, R: null })
  presenter.follow({ ...IDENTITY_DRIVER, handWaveL: 0.6, handChestL: 0.9, handWaveR: 1 })
  frame(presenter, layers, 0.1)
  assert.deepEqual(presenter.raised(), { L: 'chest', R: null })
  assert.equal(onChest.frameOpacity, 1)
  assert.equal(waving.frameOpacity, 0)
})
