import assert from 'node:assert/strict'
import test from 'node:test'
import { isAnime25DPlayback } from '@myriad/figure-player'
import { writePsd } from 'ag-psd'
import { decode, encode } from 'fast-png'
import { FigureError } from '../../errors'
import { syntheticSeeThroughPsd } from '../anime25dImporter.fixture'
import { compileRigPsdInNode } from './index'

function portrait(width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < data.length; i += 4) data.set([0xEF, 0xCD, 0xBC, 255], i)
  return encode({ width, height, data, channels: 4 })
}

const psd = () => new Uint8Array(writePsd(syntheticSeeThroughPsd(), { generateThumbnail: false }))

test('a PSD becomes a playable rig with its atlas and reference picture as PNG files, with no browser', async () => {
  const stages: string[] = []
  const { prepared, laps } = await compileRigPsdInNode(psd(), {
    sourceMasterAssetId: 'portrait',
    sourceMaster: portrait(192, 256),
    onStage: (stage) => stages.push(stage),
    timing: true,
  })
  assert.deepEqual(stages, ['validated', 'packing'])
  assert.ok(laps && laps.length > 0)
  assert.equal(prepared.source.sourceMasterAssetId, 'portrait')
  assert.ok(isAnime25DPlayback(prepared.source.anime25dPlayback))
  assert.deepEqual(prepared.source.anime25dPlayback!.enhancement, { turn: false, expressions: false })
  const atlas = decode(await prepared.atlas.bytes())
  assert.equal(prepared.atlas.type, 'image/png')
  assert.deepEqual([atlas.width, atlas.height], [prepared.source.atlas.width, prepared.source.atlas.height])
  assert.equal(atlas.channels, 4)
  // Every part's place on the atlas holds drawn pixels.
  for (const layer of prepared.source.anime25dPlayback!.layers) {
    const { x, y, w, h } = layer.atlas
    let alpha = 0
    for (let row = Math.floor(y * atlas.height); row < Math.ceil((y + h) * atlas.height); row++) {
      for (let column = Math.floor(x * atlas.width); column < Math.ceil((x + w) * atlas.width); column++) {
        alpha = Math.max(alpha, atlas.data[(row * atlas.width + column) * 4 + 3]!)
      }
    }
    assert.ok(alpha > 0, `${layer.id} is drawn on the atlas`)
  }
  const reference = decode(await prepared.analysisReference.bytes())
  assert.ok(reference.width > 0 && reference.height > 0)
})

test('the Node import refuses what the page refuses, with the same codes', async () => {
  const code = (promise: Promise<unknown>) => promise.then(
    () => assert.fail('imported'),
    (error: unknown) => (error instanceof FigureError ? error.code : String(error)),
  )
  assert.equal(await code(compileRigPsdInNode(psd(), { sourceMasterAssetId: '', sourceMaster: portrait(192, 256) })), 'psdNeedAsset')
  assert.equal(await code(compileRigPsdInNode(new Uint8Array(0), { sourceMasterAssetId: 'portrait', sourceMaster: portrait(192, 256) })), 'psdTooLarge')
  assert.equal(await code(compileRigPsdInNode(new Uint8Array(4096), { sourceMasterAssetId: 'portrait', sourceMaster: portrait(192, 256) })), 'psdSpecInvalid')
  const unreadable = await compileRigPsdInNode(psd(), { sourceMasterAssetId: 'portrait', sourceMaster: new Uint8Array([1, 2, 3]) }).then(
    () => null,
    (error: unknown) => error,
  )
  assert.ok(unreadable instanceof Error)
})

test('an unreadable expression redraw only loses its parts, as in the browser', async () => {
  const { prepared } = await compileRigPsdInNode(psd(), {
    sourceMasterAssetId: 'portrait',
    sourceMaster: portrait(192, 256),
    expressions: [{ kind: 'cry', picture: new Uint8Array([0xFF, 0xD8, 0xFF, 0]) }],
  })
  assert.ok(isAnime25DPlayback(prepared.source.anime25dPlayback))
  assert.equal(prepared.source.anime25dPlayback!.enhancement?.expressions, true)
})
