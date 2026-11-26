import type { Anime25DPlayback, Anime25DPlaybackV7, MeropeRigManifest } from '@myriad-you/figure-player'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readAnime25DPlayback, writeAnime25DPlayback } from '@myriad-you/figure-player'
import { isLiveMeropeManifest } from '../rig/manifestValidation'
import { legalManifest } from '../rig/rigFuzz.fixture'
import { playManifest } from './playerHarness.fixture'

/**
 * A package is read by its version: the same package written in version 7 (as the importer writes it) and in version 8
 * passes the same checks and plays the same, frame for frame, its pose corrections included.
 */
const manifests = [await legalManifest('bust'), await legalManifest('fullBody')]

function inVersion8(manifest: MeropeRigManifest): MeropeRigManifest {
  return { ...manifest, anime25dPlayback: readAnime25DPlayback(manifest.anime25dPlayback!) }
}

test('the importer writes version 7, with its pose-correction axes under the keys of version 7', () => {
  for (const manifest of manifests) {
    const playback = manifest.anime25dPlayback!
    assert.equal(playback.version, 7)
    assert.deepEqual(playback.shellProfile.poseCorrections?.map(c => Object.keys(c.at)), [['angleX', 'angleY']])
    const v8 = inVersion8(manifest).anime25dPlayback as Anime25DPlayback
    assert.deepEqual(v8.shellProfile.poseCorrections?.map(c => Object.keys(c.at)), [['headYaw', 'headPitch']])
    assert.equal(JSON.stringify(writeAnime25DPlayback(v8, 7)), JSON.stringify(playback))
  }
})

/** `value` with every object's keys in sorted order, as the server keeps a stored manifest. */
function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).toSorted().map(key => [key, sortedKeys((value as Record<string, unknown>)[key])]))
}

test('a package stored with sorted keys reads into version 8 and writes back to version 7 as the same value', async () => {
  for (const manifest of manifests) {
    const stored = sortedKeys(manifest.anime25dPlayback) as Anime25DPlaybackV7
    const again = writeAnime25DPlayback(readAnime25DPlayback(stored), 7)
    assert.deepEqual(again, stored)
    assert.equal(JSON.stringify(sortedKeys(again)), JSON.stringify(stored))
    const sortedManifest = { ...manifest, anime25dPlayback: stored }
    assert.deepEqual(await playManifest(inVersion8(sortedManifest)), await playManifest(manifest))
  }
})

test('a package in either version is live and plays the same', async () => {
  for (const manifest of manifests) {
    const v8 = inVersion8(manifest)
    assert.equal(isLiveMeropeManifest(manifest), true)
    assert.equal(isLiveMeropeManifest(v8), true)
    const [v7Run, v8Run] = [await playManifest(manifest), await playManifest(v8)]
    assert.equal(v7Run.nonFinite, null)
    assert.deepEqual(v8Run, v7Run)
    // The corrections are drawn: without them it draws otherwise, so their axes were read in both.
    const bare = structuredClone(manifest)
    delete bare.anime25dPlayback!.shellProfile.poseCorrections
    assert.notDeepEqual(await playManifest(bare), v7Run)
  }
})

test('a package of a version the player does not read is not live, and the player refuses it by its version', async () => {
  const [manifest] = manifests
  const v9 = { ...manifest, anime25dPlayback: { ...manifest.anime25dPlayback!, version: 9 } } as unknown as MeropeRigManifest
  assert.equal(isLiveMeropeManifest(v9), false)
  await assert.rejects(playManifest(v9), { name: 'FigureError', code: 'anime25dPlaybackVersion' })
})
