import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveGeometryChestProfile } from './chestField'

test('authors a complete deterministic geometry profile before AI refinement', () => {
  const profile = deriveGeometryChestProfile({
    pixelCanvas: { width: 768, height: 1024 },
    anchors: {
      face: { x0: 230, y0: 92, x1: 538, y1: 368, cx: 384, cy: 246 },
      neckPivot: { x: 384, y: 390 },
      neckTop: 368,
      neckBottom: 428,
      bodyPivot: { x: 384, y: 1024 },
      mouth: { x0: 350, y0: 300, x1: 418, y1: 330, cx: 384, cy: 315 },
      faceScale: 308 / 333,
    },
    layers: [
      {
        name: 'topwear',
        role: 'topwear',
        z: 0,
        depth: 0.9,
        group: 'body',
        phys: null,
        fade: null,
        side: null,
        x: 138.24,
        y: 368.64,
        w: 491.52,
        h: 655.36,
        atlas: { x: 0, y: 0, w: 1, h: 1 },
        strands: [],
      },
    ],
  })
  assert.equal(profile.version, 2)
  assert.equal(profile.source, 'geometry-fallback')
  assert.equal(profile.centerX, 384)
  assert.equal(profile.radiusX, 308 * 0.6)
  assert.equal(profile.radiusY, 276 * 0.32)
})
