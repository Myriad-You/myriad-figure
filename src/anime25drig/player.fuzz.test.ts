import assert from 'node:assert/strict'
import test from 'node:test'
import { isLiveMeropeManifest } from '@myriad-you/figure-player/contract'
import { legalManifest, mulberry32, mutate, mutateNumbers } from '../rig/rigFuzz.fixture'
import { playManifest } from './playerHarness.fixture'

/**
 * The other half of manifestValidation.fuzz: what validation lets through, the
 * player builds, plays and swaps in without a throw, and never gives the GPU a
 * number that is not one. Validation is where a manifest is refused; a case
 * that fails here is one it should have refused.
 *
 * One whose damage nothing reads plays as the undamaged manifest does, and
 * shows nothing: enough of them have to draw otherwise.
 */
const SEEDS = 240
const DRAW_OTHERWISE = 36
/** A gesture arm's bake is most of a run's time: one seed in this many has one. */
const ARMED_EVERY = 10
/** Swapping a package in builds it all a second time: one seed in this many does. */
const SWAPPED_EVERY = 5

const manifests = [await legalManifest('bust'), await legalManifest('fullBody')]
const unarmed = manifests.map((manifest) => {
  const copy = structuredClone(manifest)
  copy.anime25dPlayback!.layers = copy.anime25dPlayback!.layers.filter((layer) => !layer.armVariant)
  return copy
})

test('the same manifest draws the same, every time', async () => {
  for (const manifest of [manifests[1], unarmed[0]]) {
    const [once, again] = [await playManifest(manifest), await playManifest(manifest)]
    assert.equal(once.nonFinite, null)
    assert.deepEqual(again, once)
  }
})

test(`a damaged manifest that validation lets through plays (${SEEDS} seeds)`, async () => {
  // What each draws undamaged, swapped in and not.
  const plain = new Map<unknown, { drawn: number; swapped: number }>()
  for (const manifest of [...manifests, ...unarmed]) {
    const [once, swapped] = [await playManifest(manifest, 4, false), await playManifest(manifest)]
    assert.equal(swapped.nonFinite, null)
    plain.set(manifest, { drawn: once.drawn, swapped: swapped.drawn })
  }
  let otherwise = 0
  for (let seed = 0; seed < SEEDS; seed += 1) {
    const random = mulberry32(0x91A7_0000 + seed)
    // All of a case is its seed's, so one that fails is played again by its number alone.
    const armed = seed % ARMED_EVERY === 0
    const swap = seed % SWAPPED_EVERY === 1
    const base = (armed ? manifests : unarmed)[(seed >> 1) % 2]
    const manifest = structuredClone(base)
    const playback = manifest.anime25dPlayback!
    // An armed run is for the arm: the changes are made in its model.
    const damaged = armed ? playback.layers.find((layer) => layer.armVariant)!.armVariant!.model : playback
    // Numbers for numbers, mostly; now and then whatever else may be done to a field.
    const mutations = seed % 4 ? mutateNumbers(damaged, random) : mutate(damaged, random)
    if (!isLiveMeropeManifest(manifest)) continue
    const where = `seed ${seed}: ${mutations.map(({ path, what }) => `${path.join('.').slice(0, 120)} ${what.slice(0, 80)}`).join('; ')}`
    const run = await playManifest(manifest, 4, swap).catch((error: unknown) => {
      throw new Error(`${where}\n${String(error)}`, { cause: error })
    })
    assert.equal(run.nonFinite, null, where)
    if (run.drawn !== plain.get(base)![swap ? 'swapped' : 'drawn']) otherwise += 1
  }
  assert.ok(otherwise >= DRAW_OTHERWISE, `${otherwise} of ${SEEDS} draw otherwise`)
})

test('an eye and a mouth one pixel thick, as their art may be, play', async () => {
  const manifest = structuredClone(unarmed[0])
  const { eyeL, eyeR, mouth } = manifest.anime25dPlayback!.anchors
  for (const box of [eyeL!, eyeR!, mouth]) box.y1 = box.y0
  assert.equal(isLiveMeropeManifest(manifest), true)
  assert.equal((await playManifest(manifest)).nonFinite, null)
})
