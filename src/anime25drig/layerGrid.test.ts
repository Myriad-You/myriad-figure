import type { Anime25DLayerBindingInput } from './layerGrid'
import type { Anime25DPlaybackLayer } from './types'
import assert from 'node:assert/strict'
import test from 'node:test'
import { ANIME25D_LAYER_DESCRIPTORS } from '../rig/anime25d'
import { anime25DLayerGroup } from '../rig/anime25dLayerSemantics'
import { MAX_CONTACT_LINES } from './collarContact'
import { buildAnime25DLayerBinding } from './layerBinding'
import { layerMeshVertexBound } from './layerGrid'
import { largestPieces, splitHangingParts } from './partSplit'

const face = { x0: 300, y0: 200, x1: 700, y1: 640, cx: 500, cy: 420 }
function layerOf(role: string, w: number, h: number): Anime25DPlaybackLayer {
  return {
  name: role, role, z: 0, depth: 1, group: anime25DLayerGroup(role, 'head'), x: 100, y: 100, w, h,
  atlas: { x: 0, y: 0, w: 1, h: 1 }, strands: [], phys: null, fade: null, side: null,
}
}

test('no layer is meshed past its bound, whatever it is', () => {
  for (const role of [...Object.keys(ANIME25D_LAYER_DESCRIPTORS), 'objects', 'unknown']) {
    for (const [w, h] of [[3, 900], [40, 40], [700, 1100], [2400, 300]]) {
      for (const figure of [false, true]) {
        const input: Anime25DLayerBindingInput = { source: layerOf(role, w, h), canvasWidth: 1200, face, layerZ: 0, figure }
        // As many lines as a front collar's contact may lay, all through it.
        const lines = (origin: number, length: number, count: number) => Array.from({ length: count }, (_, i) => origin + length * (i + 0.37) / count)
        const contact = role === 'collar-front'
          ? { extraGridX: lines(100, w, MAX_CONTACT_LINES.x), extraGridY: lines(100, h, MAX_CONTACT_LINES.y) }
          : {}
        const vertices = buildAnime25DLayerBinding({ ...input, ...contact }).rest.length / 2
        assert.ok(vertices <= layerMeshVertexBound(input), `${role} ${w}×${h}: ${vertices}`)
      }
    }
  }
})

test('a piece cut out of its host is meshed within its bound too', () => {
  const [w, h] = [300, 500]
  // Plain cloth with something of another colour hanging in the middle of it, in the open.
  const pixels = new Uint8ClampedArray(w * h * 4)
  const paint = (x0: number, y0: number, x1: number, y1: number, colour: readonly number[]) => {
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) pixels.set([...colour, 255], (y * w + x) * 4)
    }
  }
  paint(0, 0, w, 200, [40, 40, 60])
  paint(130, 200, 170, 280, [230, 190, 60])
  const host = layerOf('front-hair', w, h)
  const part = {
    name: 'charm', layer: host.name, separate: false, box: [230, 300, 270, 380] as [number, number, number, number], anchor: [250, 300] as [number, number],
    bone: 'head', motion: 'dangle' as const, material: 'metal', stiffness: 0.2, weight: 0.5,
  }
  const profile = { version: 1 as const, source: 'ai-vision' as const, parts: [part] }
  const canvas = { width: 1200, height: 1600 }
  const [cut] = splitHangingParts([host], profile, canvas, () => ({ pixels, width: w, height: h }))
  const [[largest]] = largestPieces([host], profile, canvas)
  assert.ok(cut.source.x >= largest.x && cut.source.x + cut.source.w <= largest.x + largest.w)
  assert.ok(cut.source.y >= largest.y && cut.source.y + cut.source.h <= largest.y + largest.h)
  // Looked for around its own box, not all over its host.
  assert.ok(largest.w < w && largest.h < h)
  const input: Anime25DLayerBindingInput = { source: cut.source, canvasWidth: 1200, face, layerZ: 0 }
  const vertices = buildAnime25DLayerBinding(input).rest.length / 2
  assert.ok(vertices <= layerMeshVertexBound(input, true))
  assert.ok(vertices <= layerMeshVertexBound({ ...input, source: largest }, true))
})
