import type { CollarClipMesh } from './collarRuntime'
import type {
  Anime25DCompiledGpuLayers,
  Anime25DGpuLayer,
} from './layerGpuBinding'
import assert from 'node:assert/strict'
import test from 'node:test'
import { standOnLimb } from './layerGpuAssembly'
import { disposeAnime25DGpuLayers } from './layerGpuBinding'

test('releases owned layer meshes and the collar clip exactly once', () => {
  const deletedBuffers: string[] = []
  const deletedVaos: string[] = []
  const gl = {
    deleteBuffer: (buffer: string) => deletedBuffers.push(buffer),
    deleteVertexArray: (vao: string) => deletedVaos.push(vao),
  } as unknown as WebGL2RenderingContext
  const compiled = {
    layers: [
      {
        vao: 'layer-vao',
        vertexBuffer: 'layer-position',
        uvBuffer: 'layer-uv',
        indexBuffer: 'layer-index',
      } as unknown as Anime25DGpuLayer,
      {
        vao: null,
        vertexBuffer: null,
        uvBuffer: null,
        indexBuffer: null,
      } as unknown as Anime25DGpuLayer,
      {
        vao: null,
        vertexBuffer: 'partial-position',
        uvBuffer: null,
        indexBuffer: null,
      } as unknown as Anime25DGpuLayer,
    ],
    collarClip: {
      vao: 'clip-vao',
      vertexBuffer: 'clip-position',
      uvBuffer: 'clip-uv',
      indexBuffer: 'clip-index',
    } as unknown as CollarClipMesh,
  } satisfies Anime25DCompiledGpuLayers

  disposeAnime25DGpuLayers(gl, compiled)

  assert.deepEqual(deletedBuffers, [
    'layer-position',
    'layer-uv',
    'layer-index',
    'partial-position',
    'clip-position',
    'clip-uv',
    'clip-index',
  ])
  assert.deepEqual(deletedVaos, ['layer-vao', 'clip-vao'])
})

test('a piece drawn on a standing figure\'s shoe lets go of its anchor there and stands as the shoe does; one that swings, or sits on the trunk, keeps it', () => {
  const shoe = { name: 'footwear-L', role: 'footwear', group: 'body', side: 'L', x: 100, y: 800, w: 120, h: 160 }
  const top = { name: 'topwear', role: 'topwear', group: 'body', x: 60, y: 200, w: 300, h: 300 }
  const playback = { layers: [shoe, top], anchors: { bodyPivot: { x: 200, y: 500 }, groundY: 960 } } as never
  const rest = Float32Array.of(120, 820, 200, 820, 120, 940, 200, 940)
  const host = { figureSkin: { kind: 'leg', side: 'L' }, figurePitch: { kind: 'trunk' }, standing: { kind: 'leg', side: 'L', hipX: 160 } }
  const piece = (hostSource: unknown, extra: Record<string, unknown> = {}) => ({
    rest,
    attachment: { hostSource, hostName: (hostSource as { name: string }).name, binding: host },
    secondaryDeformation: { figureSkin: { kind: 'leg', side: 'L' }, figurePitch: { kind: 'trunk' }, standing: { kind: 'leg', side: 'L', hipX: 150 }, figureColumn: null },
    ...extra,
  }) as never as Parameters<typeof standOnLimb>[0]
  const laces = piece(shoe)
  standOnLimb(laces, playback, () => null)
  assert.equal(laces.attachment, null)
  assert.equal(laces.rides, 'footwear-L', 'and is drawn with that leg still')
  assert.equal(laces.secondaryDeformation.standing, host.standing as never, 'by the shoe\'s stance, not its own box\'s')
  assert.equal(laces.secondaryDeformation.figureSkin, host.figureSkin as never)
  const column = laces.secondaryDeformation.figureColumn!
  assert.equal(column.axis.length, 4)
  assert.ok(column.reach![2]! > column.reach![0]!, 'its points lower on the shoe swing further with the toe')
  // What swings from its anchor keeps it; so does a piece on the trunk, and one with no bones of its own to stand by.
  for (const kept of [piece(shoe, { earwearPhysics: {} }), piece(top), { ...piece(shoe), secondaryDeformation: { standing: null, figureSkin: null } } as never as Parameters<typeof standOnLimb>[0]]) {
    standOnLimb(kept, playback, () => null)
    assert.ok(kept.attachment)
    assert.equal(kept.rides, undefined)
  }
})
