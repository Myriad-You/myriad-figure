import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// The figure's half of the site's live-face tests
// (Myriad: frontend/src/features/merope/presence/facePresence.test.ts and liveFacePlayback.test.ts).
const player = readFileSync(new URL('./player.ts', import.meta.url), 'utf8')

test('an outfit change swaps the package on the live player', () => {
  assert.match(player, /async replaceLivePackage/)
  assert.match(player, /await loadImage\(atlasUrl/)
  assert.match(player, /this\.atlasTexture = prepared\.texture/)
})

test('a disposed or superseded atlas load never lands', () => {
  assert.match(player, /loadImage\(atlasUrl, atlasAbort\.signal\)/)
  assert.match(
    player,
    /if \(this\.disposed \|\| atlasAbort\.signal\.aborted\) return/,
  )
})
