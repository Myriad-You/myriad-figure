import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { shoulderContactWeights } from './shoulderContact'

test('pins adjoining skin but leaves detached or fabric sleeves unchanged', () => {
  const arm = { x: 0, y: 0, w: 100, h: 200, side: 'L' as const }
  const torso = { x: 98, y: 0, w: 200, h: 200, side: null }
  const raster = (r: number, g: number, b: number) => ({width: 200, height: 200,
    pixels: new Uint8ClampedArray(Array.from({length: 40000}, () => [r,g,b,255]).flat())})
  const skin = raster(245, 200, 185)
  const rest = new Float32Array([99,50, 0,190])
  const weights = shoulderContactWeights(arm, skin, torso, skin, rest)
  assert.ok(weights)
  assert.equal(weights[0], 1)
  assert.equal(weights[1], 0)
  assert.equal(shoulderContactWeights(arm, skin, {...torso, x: 150}, skin, rest), null)
  assert.equal(shoulderContactWeights(arm, raster(70,70,110), torso, skin, rest), null)
  assert.equal(shoulderContactWeights(arm, null, torso, skin, rest), null)
})

test('real atlas exposes both shoulder contacts', {skip: !process.env.MEROPE_SHOULDER_ASSET}, async () => {
  const sharp = (await import('sharp')).default
  const root = process.env.MEROPE_SHOULDER_ASSET!
  const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'))
  const layers = manifest.anime25dPlayback.layers
  const atlas = `${root}/atlas.png`
  const meta = await sharp(atlas).metadata()
  const crop = async (layer: any) => {
    const {data, info} = await sharp(atlas).extract({left: Math.round(layer.atlas.x * meta.width!),
      top: Math.round(layer.atlas.y * meta.height!), width: Math.round(layer.atlas.w * meta.width!),
      height: Math.round(layer.atlas.h * meta.height!)}).ensureAlpha().raw().toBuffer({resolveWithObject:true})
    return {pixels: new Uint8ClampedArray(data), width:info.width, height:info.height}
  }
  const torso = layers.find((l: any) => l.role === 'topwear')
  const body = await crop(torso)
  for (const arm of layers.filter((l: any) => l.role === 'handwear')) {
    const rest = new Float32Array(Array.from({length:100}, (_,i) =>
      [arm.x + arm.w * (i % 10) / 9, arm.y + arm.h * Math.floor(i / 10) / 9]).flat())
    const weights = shoulderContactWeights(arm, await crop(arm), torso, body, rest)
    assert.ok(weights, arm.name)
    assert.ok(Math.max(...weights) > 0.99, arm.name)
    assert.ok(Math.min(...weights) < 0.01, arm.name)
  }
})
