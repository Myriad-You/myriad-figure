import type { BenchRequest, BenchResult } from './fixture/importBench'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { expect, test } from '@playwright/test'
import sharp from 'sharp'

// Where a real import's time goes, and whether it still makes the same thing.
// No artwork is kept in this repository: the test runs where FIGURE_IMPORT_BENCH
// names a JSON file of cases, and is skipped elsewhere:
//
//   { "cases": [{ "name": "bust", "psd": "/…/baked.psd", "portrait": "/…/master.png",
//       "profile": "bust" | "fullBody", "skeleton": "/…/pose.json",
//       "variants": [{ "gesture": "wave", "side": "left", "picture": "/…/wave.png", "points": "/…/wave.json" }] }] }
//
// `skeleton` is the pose model's answer on the portrait ({ model, width, height, keypoints }) and `points` a gesture
// arm's ({ hand, keypoints }, in the portrait's pixels), both as the site keeps them; both may be left out.
//
// FIGURE_IMPORT_BENCH_RUNS imports each case that many times (3). FIGURE_IMPORT_BENCH_OUT takes every run's laps.
// FIGURE_IMPORT_BENCH_GOLDEN names the file of what each case made: written where there is none, and held to
// where there is one, hash for hash: the rig to the bit, the two PNG files byte for byte, and their pixels as
// another decoder (sharp) reads them.
const manifest = process.env.FIGURE_IMPORT_BENCH ?? ''
const runs = Math.max(1, Number(process.env.FIGURE_IMPORT_BENCH_RUNS) || 3)
const out = process.env.FIGURE_IMPORT_BENCH_OUT ?? ''
const goldenFile = process.env.FIGURE_IMPORT_BENCH_GOLDEN ?? ''

interface Case {
  name: string
  psd: string
  portrait: string
  profile?: 'bust' | 'fullBody'
  skeleton?: string
  variants?: Array<{ gesture: string; side: 'left' | 'right'; picture: string; points?: string }>
}

type Made = BenchResult['hashes'] & { atlasPixels: string; analysisReferencePixels: string }

test('a real import, timed and held to what it made before', async ({ page }) => {
  test.skip(!manifest || !existsSync(manifest), 'FIGURE_IMPORT_BENCH names no cases')
  test.setTimeout(60 * 60_000)
  const { cases } = JSON.parse(await readFile(manifest, 'utf8')) as { cases: Case[] }
  const golden: Record<string, Made> = goldenFile && existsSync(goldenFile)
    ? JSON.parse(await readFile(goldenFile, 'utf8')) as Record<string, Made>
    : {}
  const holding = Object.keys(golden).length > 0
  const report: Record<string, { made: Made; sizes: BenchResult['sizes']; runs: Array<Pick<BenchResult, 'wallMs' | 'returnMs' | 'laps'>> }> = {}
  const files: string[] = []
  const serve = (file: string) => `/bench-file/${files.push(file) - 1}`
  await page.route('**/bench-file/*', async (route) => {
    const file = files[Number(new URL(route.request().url()).pathname.split('/').pop())]
    if (!file) return route.fulfill({ status: 404 })
    await route.fulfill({ body: await readFile(file), contentType: file.endsWith('.png') ? 'image/png' : 'application/octet-stream' })
  })
  const json = async <T>(file: string) => JSON.parse(await readFile(file, 'utf8')) as T

  for (const one of cases) {
    const portraitUrl = serve(one.portrait)
    const skeleton = one.skeleton
      ? await json<{ model: string; width: number; height: number; keypoints: Array<[number, number, number]> }>(one.skeleton)
      : null
    const request: BenchRequest = {
      psdUrl: serve(one.psd),
      sourceMasterAssetId: portraitUrl,
      sourceMasterUrl: portraitUrl,
      profile: one.profile ?? 'bust',
      expressions: [],
      armVariants: await Promise.all((one.variants ?? []).map(async (variant) => {
        const points = variant.points ? await json<{ hand?: Array<[number, number]>; keypoints?: Array<[number, number, number]> }>(variant.points) : {}
        return {
          gesture: variant.gesture as 'wave',
          side: variant.side,
          url: serve(variant.picture),
          ...(points.hand?.length ? { hand: points.hand } : {}),
          ...(points.keypoints?.length ? { keypoints: points.keypoints } : {}),
        }
      })),
      ...(skeleton ? { skeleton: { sourceMasterAssetId: portraitUrl, ...skeleton } } : {}),
    }
    const taken: BenchResult[] = []
    let made: Made | null = null
    for (let run = 0; run < runs; run += 1) {
      // A page of its own each time, as an import on the site has a worker of its own.
      await page.goto('/importBench.html')
      await page.waitForFunction(() => 'importBench' in window)
      const result = await page.evaluate((request) => window.importBench.run(request), request)
      taken.push(result)
      if (made) {
        // The same import twice makes the same thing: without that, no golden means anything.
        expect({ ...made, ...result.hashes }, `${one.name}, run ${run + 1}`).toEqual(made)
        continue
      }
      const pixels = async (which: 'atlas' | 'analysisReference', size: number, hash: string) => {
        const parts: Buffer[] = []
        const step = 3 << 20
        for (let from = 0; from < size; from += step) {
          parts.push(Buffer.from(await page.evaluate(([which, from, step]) => window.importBench.bytes(which, from, step), [which, from, step] as const), 'base64'))
        }
        const file = Buffer.concat(parts)
        expect(createHash('sha256').update(file).digest('hex'), `${one.name} ${which} as read back`).toBe(hash)
        const { data, info } = await sharp(file, { limitInputPixels: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
        return createHash('sha256').update(`${info.width}x${info.height}x${info.channels}:`).update(data).digest('hex')
      }
      made = {
        ...result.hashes,
        atlasPixels: await pixels('atlas', result.sizes.atlasBytes, result.hashes.atlas),
        analysisReferencePixels: await pixels('analysisReference', result.sizes.analysisReferenceBytes, result.hashes.analysisReference),
      }
    }
    report[one.name] = { made: made!, sizes: taken[0]!.sizes, runs: taken.map(({ wallMs, returnMs, laps }) => ({ wallMs, returnMs, laps })) }
    if (out) await writeFile(out, JSON.stringify(report, null, 1))
    if (holding) expect(made, `${one.name} against ${goldenFile}`).toEqual(golden[one.name])
  }
  if (goldenFile && !holding) await writeFile(goldenFile, JSON.stringify(Object.fromEntries(Object.entries(report).map(([name, { made }]) => [name, made])), null, 1))
})
