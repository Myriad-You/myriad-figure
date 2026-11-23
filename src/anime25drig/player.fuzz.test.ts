import assert from 'node:assert/strict'
import test from 'node:test'
import { isLiveMeropeManifest } from '../rig/manifestValidation'
import { legalManifest, mulberry32, mutate } from '../rig/rigFuzz.fixture'
import { playManifest } from './playerHarness.fixture'

/**
 * The other half of manifestValidation.fuzz: what validation lets through, the
 * player builds, plays and swaps in without a throw, and never gives the GPU a
 * number that is not one. Validation is where a manifest is refused; a case
 * that fails here is one it should have refused.
 */
const RUNS = 8
/** A gesture arm's bake is most of a run's time: one run in this many has one. */
const ARMED_EVERY = 8

test(`a damaged manifest that validation lets through plays (${RUNS} of them)`, async () => {
  const manifests = [await legalManifest('bust'), await legalManifest('fullBody')]
  for (const manifest of manifests) assert.equal((await playManifest(manifest)).nonFinite, null)
  const unarmed = manifests.map((manifest) => {
    const copy = structuredClone(manifest)
    copy.anime25dPlayback!.layers = copy.anime25dPlayback!.layers.filter((layer) => !layer.armVariant)
    return copy
  })
  let runs = 0
  for (let seed = 0; runs < RUNS; seed += 1) {
    assert.ok(seed < RUNS * 100, 'too few manifests are let through')
    const manifest = structuredClone((runs % ARMED_EVERY ? unarmed : manifests)[seed % 2])
    // Most of what a manifest holds the player reads out of its package: the changes are made there.
    const mutations = mutate(manifest.anime25dPlayback, mulberry32(0x91A7_0000 + seed))
    if (!isLiveMeropeManifest(manifest)) continue
    runs += 1
    const where = `seed ${seed}: ${mutations.map(({ path, what }) => `${path.join('.').slice(0, 120)} ${what.slice(0, 80)}`).join('; ')}`
    const run = await playManifest(manifest).catch((error: unknown) => {
      throw new Error(`${where}\n${String(error)}`, { cause: error })
    })
    assert.equal(run.nonFinite, null, where)
  }
})

test('an eye and a mouth one pixel thick, as their art may be, play', async () => {
  const manifest = await legalManifest('bust')
  const { eyeL, eyeR, mouth } = manifest.anime25dPlayback!.anchors
  for (const box of [eyeL!, eyeR!, mouth]) box.y1 = box.y0
  assert.equal(isLiveMeropeManifest(manifest), true)
  assert.equal((await playManifest(manifest, 3)).nonFinite, null)
})
