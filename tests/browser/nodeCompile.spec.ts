import type { Page, TestInfo } from '@playwright/test'
import type { BrowserImport, SyntheticPortrait } from './fixture/nodeCompile'
import type { NodeCompileRequest, NodeCompileResult } from './nodeCompileRun'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import sharp from 'sharp'
import { psdPlacement } from '../../src/rig/psdPlacement'

// The Node import (`@myriad/figure/rig/node`) against the browser's: the same
// PSD and portrait through the page's import and its worker, and through Node,
// make the same rig, and pictures that differ only where a canvas rounds.
//
// What a canvas rounds is its own: each browser keeps a half-transparent pixel
// premultiplied in 8 bits, and gives it back unpremultiplied by its own
// arithmetic; Node rounds to nearest, as WebKit does. Chromium's comes out at
// most one level off it, and the same once premultiplied again (as the player
// uploads the atlas); Firefox rounds the other way, one level premultiplied.
// The reference picture is drawn between pixels, each browser smoothing in its
// own way; it is only ever looked at by a vision model.
//
// Real figures run where FIGURE_IMPORT_BENCH names the import bench's cases
// (see importBench.spec.ts), and are skipped elsewhere.

const root = fileURLToPath(new URL('../..', import.meta.url))
const run = promisify(execFile)

/** How far a channel is off by the engine's rounding alone, unpremultiplied and premultiplied. */
const ATLAS_ROUNDING: Record<string, { straight: number; premultiplied: number }> = {
  chromium: { straight: 1, premultiplied: 0 },
  webkit: { straight: 0, premultiplied: 0 },
  firefox: { straight: 255, premultiplied: 1 },
}

interface PixelDifference {
  /** Over every channel of every pixel. */
  max: number
  mean: number
  /** The same of the pixels premultiplied (colour times alpha, to 8 bits). */
  premultipliedMax: number
  /** Share of channels that differ at all. */
  differing: number
  /** Share of pixels that differ by more than the engine's rounding. */
  beyondRounding: number
}

async function rgba(file: Buffer) {
  const { data, info } = await sharp(file, { limitInputPixels: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

async function difference(
  browserFile: Buffer,
  nodeFile: Buffer,
  rounding: { straight: number; premultiplied: number },
): Promise<PixelDifference> {
  const [a, b] = await Promise.all([rgba(browserFile), rgba(nodeFile)])
  expect([b.width, b.height]).toEqual([a.width, a.height])
  let max = 0
  let sum = 0
  let premultipliedMax = 0
  let differing = 0
  let beyond = 0
  for (let pixel = 0; pixel < a.data.length; pixel += 4) {
    let off = false
    for (let i = pixel; i < pixel + 4; i += 1) {
      const d = Math.abs(a.data[i]! - b.data[i]!)
      if (d === 0) continue
      const premultiplied = i === pixel + 3
        ? d
        : Math.abs(Math.round((a.data[i]! * a.data[pixel + 3]!) / 255) - Math.round((b.data[i]! * b.data[pixel + 3]!) / 255))
      differing += 1
      sum += d
      max = Math.max(max, d)
      premultipliedMax = Math.max(premultipliedMax, premultiplied)
      if (d > rounding.straight || premultiplied > rounding.premultiplied) off = true
    }
    if (off) beyond += 1
  }
  return { max, mean: sum / a.data.length, premultipliedMax, differing: differing / a.data.length, beyondRounding: beyond / (a.data.length / 4) }
}

async function readBack(page: Page, sizes: BrowserImport['sizes']): Promise<Record<keyof BrowserImport['sizes'], Buffer>> {
  const read = async (which: keyof BrowserImport['sizes']) => {
    const parts: Buffer[] = []
    const step = 3 << 20
    for (let from = 0; from < sizes[which]; from += step) {
      parts.push(Buffer.from(await page.evaluate(([which, from, step]) => window.nodeCompile.bytes(which, from, step), [which, from, step] as const), 'base64'))
    }
    return Buffer.concat(parts)
  }
  return { psd: await read('psd'), portrait: await read('portrait'), atlas: await read('atlas'), analysisReference: await read('analysisReference') }
}

async function compileInNode(
  testInfo: TestInfo,
  files: { psd: Buffer; portrait: Buffer; armVariants?: string[] },
  options: NodeCompileRequest['options'],
): Promise<NodeCompileResult & { atlas: Buffer; analysisReference: Buffer }> {
  const out = testInfo.outputPath('node')
  await mkdir(out, { recursive: true })
  const request: NodeCompileRequest = { psd: `${out}/figure.psd`, portrait: `${out}/portrait.png`, out, options }
  await writeFile(request.psd, files.psd)
  await writeFile(request.portrait, files.portrait)
  await writeFile(`${out}/request.json`, JSON.stringify(request))
  await run(process.execPath, ['--import', 'tsx', 'tests/browser/nodeCompileRun.ts', `${out}/request.json`], { cwd: root, maxBuffer: 64 << 20 })
  const result = JSON.parse(await readFile(`${out}/result.json`, 'utf8')) as NodeCompileResult
  return { ...result, atlas: await readFile(`${out}/atlas.png`), analysisReference: await readFile(`${out}/analysisReference.png`) }
}

/** How many of two rigs' values (numbers, strings, …, and places one has and the other not) differ. */
function differingLeaves(a: unknown, b: unknown): { differing: number; total: number } {
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
    return { differing: Object.is(a, b) ? 0 : 1, total: 1 }
  }
  let differing = 0
  let total = 0
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    const one = differingLeaves((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
    differing += one.differing
    total += one.total
  }
  return { differing, total }
}

interface Bounds {
  /** The rig must be the same to the last value; else this share of its values may differ. */
  sameRig: boolean
  rigDiffering: number
  /** Share of the atlas's pixels that may be off by more than the engine's rounding. */
  atlasBeyondRounding: number
  /** How far off the reference picture may be, in any channel and on average. */
  reference: { max: number; mean: number }
}

/** Holds the Node import to the browser's, and notes how far apart their pictures are. */
async function holdToBrowser(
  testInfo: TestInfo,
  browserName: string,
  browser: BrowserImport,
  files: Record<'atlas' | 'analysisReference', Buffer>,
  node: Awaited<ReturnType<typeof compileInNode>>,
  bounds: Bounds,
) {
  // Beside the Node import's files, for a look when this fails.
  await writeFile(testInfo.outputPath('node', 'browser-atlas.png'), files.atlas)
  await writeFile(testInfo.outputPath('node', 'browser-analysisReference.png'), files.analysisReference)
  await writeFile(testInfo.outputPath('node', 'browser-source.json'), browser.source)
  expect.soft(browser.playbackValid, 'the browser import plays').toBe(true)
  expect.soft(node.playbackValid, 'the Node import plays').toBe(true)
  const rig = { browser: JSON.parse(browser.source), node: JSON.parse(node.source) }
  const leaves = differingLeaves(rig.browser, rig.node)
  if (bounds.sameRig) expect.soft(rig.node, 'the rig').toEqual(rig.browser)
  else expect.soft(leaves.differing / leaves.total, 'share of the rig\'s values that differ').toBeLessThanOrEqual(bounds.rigDiffering)
  const rounding = ATLAS_ROUNDING[browserName] ?? { straight: 255, premultiplied: 1 }
  const atlas = await difference(files.atlas, node.atlas, rounding)
  const reference = await difference(files.analysisReference, node.analysisReference, rounding)
  testInfo.annotations.push(
    { type: 'rig', description: JSON.stringify(leaves) },
    { type: 'atlas', description: JSON.stringify(atlas) },
    { type: 'analysisReference', description: JSON.stringify(reference) },
    { type: 'node', description: JSON.stringify({ ms: Math.round(node.ms), peakRssMB: Math.round(node.peakRssBytes / 2 ** 20) }) },
  )
  expect.soft(atlas.beyondRounding, 'atlas pixels off by more than rounding').toBeLessThanOrEqual(bounds.atlasBeyondRounding)
  expect.soft(reference.max, 'reference picture, most off').toBeLessThanOrEqual(bounds.reference.max)
  expect.soft(reference.mean, 'reference picture, mean').toBeLessThanOrEqual(bounds.reference.mean)
}

/** Whether the portrait is drawn onto the PSD at another size than its own. */
async function portraitStretched(psd: Buffer, portrait: Buffer): Promise<boolean> {
  const { width = 0, height = 0 } = await sharp(portrait).metadata()
  const placed = psdPlacement({ width, height }, psd.readUInt32BE(18), psd.readUInt32BE(14))
  return placed.width !== width || placed.height !== height
}

const SYNTHETIC: Array<[kind: string, portrait: SyntheticPortrait]> = [
  ['ordinary', 'flat'],
  ['alternate-eyes', 'flat'],
  ['closed-mouth', 'flat'],
  ['collar', 'flat'],
  ['necklace', 'flat'],
  ['painted', 'layers'],
  ['painted', 'layers-half'],
]

for (const [kind, portrait] of SYNTHETIC) {
  test(`synthetic ${kind} PSD, ${portrait} portrait: the Node import makes what the browser's does`, async ({ page, browserName }, testInfo) => {
    test.setTimeout(90_000)
    await page.goto('/nodeCompile.html')
    await page.waitForFunction(() => 'nodeCompile' in window)
    const browser = await page.evaluate(([kind, portrait]) => window.nodeCompile.synthetic(kind, portrait), [kind, portrait] as const)
    const files = await readBack(page, browser.sizes)
    const node = await compileInNode(testInfo, files, { sourceMasterAssetId: 'portrait', sourceGenerationFingerprint: 'fixture-generation' })
    await holdToBrowser(testInfo, browserName, browser, files, node, { sameRig: true, rigDiffering: 0, atlasBeyondRounding: 0, reference: { max: 255, mean: 1 } })
  })
}

interface BenchCase {
  name: string
  psd: string
  portrait: string
  profile?: 'bust' | 'fullBody'
  skeleton?: string
  variants?: Array<{ gesture: 'wave'; side: 'left' | 'right'; picture: string; points?: string }>
}

const bench = process.env.FIGURE_IMPORT_BENCH ?? ''

test('real figures: the Node import makes what the browser\'s does', async ({ page, browserName }, testInfo) => {
  test.skip(!bench || !existsSync(bench), 'FIGURE_IMPORT_BENCH names no cases')
  test.setTimeout(60 * 60_000)
  const { cases } = JSON.parse(await readFile(bench, 'utf8')) as { cases: BenchCase[] }
  const served: string[] = []
  const serve = (file: string) => `/node-compile-file/${served.push(file) - 1}`
  await page.route('**/node-compile-file/*', async (route) => {
    const file = served[Number(new URL(route.request().url()).pathname.split('/').pop())]
    if (!file) return route.fulfill({ status: 404 })
    await route.fulfill({ body: await readFile(file), contentType: file.endsWith('.png') ? 'image/png' : 'application/octet-stream' })
  })
  const json = async <T>(file: string) => JSON.parse(await readFile(file, 'utf8')) as T
  for (const one of cases) {
    await test.step(one.name, async () => {
      const skeleton = one.skeleton
        ? await json<{ model: string; width: number; height: number; keypoints: Array<[number, number, number]> }>(one.skeleton)
        : undefined
      const variants = await Promise.all((one.variants ?? []).map(async ({ picture, points, ...variant }) => {
        const found = points ? await json<{ hand?: Array<[number, number]>; keypoints?: Array<[number, number, number]> }>(points) : {}
        return {
          ...variant,
          picture,
          ...(found.hand?.length ? { hand: found.hand } : {}),
          ...(found.keypoints?.length ? { keypoints: found.keypoints } : {}),
        }
      }))
      const shared = {
        profile: one.profile ?? 'bust',
        ...(skeleton ? { skeleton: { sourceMasterAssetId: 'portrait', ...skeleton } } : {}),
      }
      await page.goto('/nodeCompile.html')
      await page.waitForFunction(() => 'nodeCompile' in window)
      const browser = await page.evaluate(([psd, portrait, options]) => window.nodeCompile.served(psd, portrait, options), [
        serve(one.psd),
        serve(one.portrait),
        { ...shared, armVariants: variants.map(({ picture, ...variant }) => ({ ...variant, url: serve(picture) })) },
      ] as const)
      const files = await readBack(page, browser.sizes)
      const node = await compileInNode(testInfo, files, { sourceMasterAssetId: 'portrait', ...shared, armVariants: variants })
      // Unstretched, the portrait is the same pixels to both; stretched, it is each one's own resampling.
      const stretched = await portraitStretched(files.psd, files.portrait)
      testInfo.annotations.push({ type: 'case', description: JSON.stringify({ name: one.name, stretched }) })
      await holdToBrowser(testInfo, browserName, browser, files, node, stretched
        ? { sameRig: false, rigDiffering: 0.25, atlasBeyondRounding: 0.01, reference: { max: 255, mean: 1 } }
        : { sameRig: true, rigDiffering: 0, atlasBeyondRounding: 0, reference: { max: 255, mean: 1 } })
    })
  }
})
