import assert from 'node:assert/strict'
import test from 'node:test'
import { isAnime25DPlayback } from '@myriad/figure-player'
import { writePsd } from 'ag-psd'
import { decode, encode } from 'fast-png'
import { FigureError } from '../../errors'
import { syntheticSeeThroughPsd } from '../anime25dImporter.fixture'
import { compileRigPsdInNode, MAX_ARM_VARIANT_PICTURES, MAX_EXPRESSION_PICTURES, MAX_PICTURE_EDGE } from './index'

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

/** The code and params a failed import gave. */
async function failure(promise: Promise<unknown>): Promise<{ code: string; params: Record<string, unknown> }> {
  try {
    await promise
  } catch (error) {
    assert.ok(error instanceof FigureError, `a FigureError, not ${String(error)}`)
    return { code: error.code, params: error.params }
  }
  return assert.fail('imported')
}

test('the Node import refuses what the page refuses, with the same codes', async () => {
  const master = portrait(192, 256)
  assert.equal((await failure(compileRigPsdInNode(psd(), { sourceMasterAssetId: '', sourceMaster: master }))).code, 'psdNeedAsset')
  assert.equal((await failure(compileRigPsdInNode(new Uint8Array(0), { sourceMasterAssetId: 'portrait', sourceMaster: master }))).code, 'psdTooLarge')
  assert.equal((await failure(compileRigPsdInNode(new Uint8Array(4096), { sourceMasterAssetId: 'portrait', sourceMaster: master }))).code, 'psdSpecInvalid')
})

test('a portrait that cannot be read is a psdPreviewFailed, as the page gives one it cannot fetch', async () => {
  // A PNG whose header is sound and whose pixels are not.
  const broken = portrait(192, 256)
  broken.fill(0x55, 60, broken.length - 12)
  assert.deepEqual(
    await failure(compileRigPsdInNode(psd(), { sourceMasterAssetId: 'portrait', sourceMaster: broken })),
    { code: 'psdPreviewFailed', params: { reason: 'unreadable' } },
  )
  assert.deepEqual(
    await failure(compileRigPsdInNode(psd(), { sourceMasterAssetId: 'portrait', sourceMaster: new TextEncoder().encode('GIF89a') })),
    { code: 'psdPreviewFailed', params: { reason: 'unsupported', picture: 'sourceMaster' } },
  )
})

test('more redraws or gesture arms than there are kinds of them are refused before anything is read', async () => {
  const master = portrait(192, 256)
  const picture = portrait(8, 8)
  const expressions = Array.from({ length: MAX_EXPRESSION_PICTURES + 1 }, () => ({ kind: 'cry' as const, picture }))
  assert.deepEqual(
    await failure(compileRigPsdInNode(psd(), { sourceMasterAssetId: 'portrait', sourceMaster: master, expressions })),
    { code: 'psdPreviewFailed', params: { picture: 'expressions', reason: 'tooMany' } },
  )
  const armVariants = Array.from({ length: MAX_ARM_VARIANT_PICTURES + 1 }, () => ({ gesture: 'wave' as const, side: 'left' as const, picture }))
  assert.deepEqual(
    await failure(compileRigPsdInNode(psd(), { sourceMasterAssetId: 'portrait', sourceMaster: master, armVariants })),
    { code: 'psdPreviewFailed', params: { picture: 'armVariants', reason: 'tooMany' } },
  )
  // A redraw too large is named; it is not decoded, and neither is anything after it.
  const huge = portrait(8, 8)
  new DataView(huge.buffer).setUint32(16, MAX_PICTURE_EDGE + 1)
  assert.deepEqual(
    await failure(compileRigPsdInNode(psd(), { sourceMasterAssetId: 'portrait', sourceMaster: master, expressions: [{ kind: 'cry', picture: huge }] })),
    { code: 'psdPreviewFailed', params: { reason: 'tooLarge', picture: 'expressions.0' } },
  )
})

test('a portrait too thin to cover a pixel of the PSD draws nothing, and the import still ends', async () => {
  // Fitted to a 256 × 320 PSD, a 1 × 5000 portrait is less than a pixel wide.
  const document = syntheticSeeThroughPsd()
  document.height = 320
  const bytes = new Uint8Array(writePsd(document, { generateThumbnail: false }))
  const { prepared } = await compileRigPsdInNode(bytes, { sourceMasterAssetId: 'portrait', sourceMaster: portrait(1, 5000) })
  assert.ok(isAnime25DPlayback(prepared.source.anime25dPlayback))
})

test('an aborted import stops at the next step with the signal\'s reason', async () => {
  const controller = new AbortController()
  const reason = new Error('stopped')
  await assert.rejects(
    compileRigPsdInNode(psd(), {
      sourceMasterAssetId: 'portrait',
      sourceMaster: portrait(192, 256),
      signal: controller.signal,
      onStage: (stage) => {
        if (stage === 'validated') controller.abort(reason)
      },
    }),
    (error) => error === reason,
  )
})

test('an unreadable expression redraw only loses its parts, as in the browser', async () => {
  const { prepared } = await compileRigPsdInNode(psd(), {
    sourceMasterAssetId: 'portrait',
    sourceMaster: portrait(192, 256),
    // Its header is sound, its pixels not: it passes the limits and fails to decode.
    expressions: [{ kind: 'cry', picture: portrait(192, 256).fill(0x55, 60, -12) }],
  })
  assert.ok(isAnime25DPlayback(prepared.source.anime25dPlayback))
  assert.equal(prepared.source.anime25dPlayback!.enhancement?.expressions, true)
})
