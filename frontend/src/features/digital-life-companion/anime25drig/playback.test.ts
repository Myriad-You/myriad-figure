import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { blinkClosure } from './player'
import { buildAnime25DPlayback } from './playback'
import { isAnime25DPlayback } from './types'

describe('Anime2.5DRig playback', () => {
  it('matches upstream blink close/hold/open phases', () => {
    assert.equal(blinkClosure(0), 0)
    assert.ok(blinkClosure(0.04) > 0.4)
    assert.equal(blinkClosure(0.2), 1)
    assert.ok(blinkClosure(0.5) < 0.6)
    assert.equal(blinkClosure(0.7), 0)
  })

  it('builds a credited playback document from face-rig layers', () => {
    const playback = buildAnime25DPlayback({
      frameWidth: 768,
      frameHeight: 1024,
      faceCenter: { x: 0.5, y: 0.32 },
      layers: [
        {
          id: 'face',
          role: 'face',
          side: null,
          bounds: { x: 0.3, y: 0.12, width: 0.4, height: 0.36 },
          textureBounds: { x: 0, y: 0, width: 0.2, height: 0.2 },
          strands: [],
        },
        {
          id: 'front-hair',
          role: 'front-hair',
          side: null,
          bounds: { x: 0.28, y: 0.08, width: 0.44, height: 0.3 },
          textureBounds: { x: 0.2, y: 0, width: 0.2, height: 0.2 },
          strands: [{ x: 0.4, rootY: 0.1, tipY: 0.28 }],
        },
      ],
    })
    assert.equal(isAnime25DPlayback(playback), true)
    assert.equal(playback.engine, 'Anime2.5DRig')
    assert.equal(playback.engineUrl, 'https://github.com/852wa/Anime2.5DRig')
    assert.equal(playback.license, 'MIT')
    assert.equal(playback.layers[1]?.phys, 'hair')
    assert.ok(playback.anchors.faceScale > 0)
  })
})
