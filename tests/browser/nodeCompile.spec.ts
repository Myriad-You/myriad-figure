import type { Page, TestInfo } from '@playwright/test'
import type { BrowserImport, SyntheticPortrait } from './fixture/nodeCompile'
import type { NodeCompileRequest, NodeCompileResult, NodePlaceRequest, PlaceCase } from './nodeCompileRun'
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
  /**
   * The findings against the portrait must be the same to the last value. A
   * stretched portrait is each one's own resampling, and its heatmap differs
   * where the pixels do; those findings are recorded only.
   */
  sameFindings: boolean
  /** Share of the atlas's pixels that may be off by more than the engine's rounding. */
  atlasBeyondRounding: number
  /** How far off the reference picture may be, in any channel and on average. */
  reference: { max: number; mean: number }
}

/**
 * The bounds, measured and given some room. Unstretched, the portrait is the
 * same pixels to both, and only the reference picture's smoothing differs
 * (Chromium's: 8 levels at most on macOS and 11 on Linux, 0.17 on average; WebKit and Firefox smooth the
 * edges too). Stretched, it is each one's own resampling, and a pixel moved
 * across a threshold moves a repair: Node follows Chromium's (on a bust with
 * gesture arms, 1% of the rig's values and 0.07% of the atlas's pixels differ);
 * WebKit and Firefox are as far from Node as from Chromium (9% and 21% there).
 * The synthetic portrait at half size is stretched, but its flat shapes leave
 * nothing near a threshold, and it is held as unstretched, but for its
 * findings (its heatmap: 2% of the values differ from Chromium's).
 */
function boundsFor(browserName: string, stretched: boolean): Bounds {
  const chromium = browserName === 'chromium'
  const fromPicture = (synthetic: boolean) => ({ max: chromium ? 16 : 255, mean: chromium ? 0.25 : synthetic ? 0.3 : 0.6 })
  if (!stretched) return { sameRig: true, rigDiffering: 0, sameFindings: true, atlasBeyondRounding: 0, reference: fromPicture(true) }
  return chromium
    ? { sameRig: false, rigDiffering: 0.03, sameFindings: false, atlasBeyondRounding: 0.002, reference: { max: 255, mean: 0.5 } }
    : { sameRig: false, rigDiffering: 0.25, sameFindings: false, atlasBeyondRounding: 0.01, reference: fromPicture(false) }
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
  const findings = { browser: JSON.parse(browser.findings), node: JSON.parse(node.findings) }
  // The findings hold the portrait's part: how far the layers agree with it, where they do not.
  if (bounds.sameFindings) expect.soft(findings.node, 'the findings against the portrait').toEqual(findings.browser)
  if (bounds.sameRig) expect.soft(rig.node, 'the rig').toEqual(rig.browser)
  else expect.soft(leaves.differing / leaves.total, 'share of the rig\'s values that differ').toBeLessThanOrEqual(bounds.rigDiffering)
  const rounding = ATLAS_ROUNDING[browserName] ?? { straight: 255, premultiplied: 1 }
  const atlas = await difference(files.atlas, node.atlas, rounding)
  const reference = await difference(files.analysisReference, node.analysisReference, rounding)
  testInfo.annotations.push(
    { type: 'rig', description: JSON.stringify(leaves) },
    { type: 'findings', description: JSON.stringify(differingLeaves(findings.browser, findings.node)) },
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

/** A 97 × 83 picture stretched onto frames, as the import fits a portrait onto a PSD. */
const PLACES: PlaceCase[] = [
  { name: 'identity', width: 97, height: 83, to: { x: 0, y: 0, width: 97, height: 83 } },
  { name: 'twice', width: 200, height: 170, to: { x: 3, y: 2, width: 194, height: 166 } },
  { name: 'enlarged-off-grid', width: 140, height: 120, to: { x: 2.5, y: 1.25, width: 132.89, height: 113.71 } },
  { name: 'three-quarters', width: 80, height: 70, to: { x: 1, y: 1, width: 72.75, height: 62.25 } },
  { name: 'half', width: 60, height: 50, to: { x: 0, y: 0, width: 48.5, height: 41.5 } },
  { name: 'wider-and-shorter', width: 140, height: 80, to: { x: 0, y: 0, width: 126.1, height: 66.4 } },
  { name: 'under-half', width: 40, height: 40, to: { x: 0, y: 0, width: 29.1, height: 24.9 } },
  { name: 'jpeg', jpeg: true, width: 97, height: 83, to: { x: 0, y: 0, width: 97, height: 83 } },
]

/**
 * How far Node's stretch may be from Chromium's, premultiplied (as it is
 * drawn): the most a channel is off, and on average. Measured: one level at
 * most at every scale; on average under 0.04, and 0.16–0.25 where two mip
 * levels are blended (each rounds on its own side). WebKit and Firefox stretch
 * in ways of their own and are only recorded.
 */
const PLACE_BOUND = { max: 2, mean: 0.3 }

/**
 * A JPEG whose colour is halved across and down (4:2:0, as browsers and most
 * encoders write it) is not decoded alike: Chromium (libjpeg-turbo) smooths
 * the colour back up, jpeg-js repeats it (as Firefox does: 3 levels from it at
 * most). On this picture's fine texture Chromium is 61 levels off at most, 2.9
 * on average; on a portrait (4:2:0 at quality 90) it was 20 levels at most and
 * 0.4 on average, and 3 and 0.3 for a JPEG that keeps its colour whole.
 * Recorded here, and bound only so that a JPEG read wrong would fail.
 */
const JPEG_BOUND = { max: 255, mean: 12 }

test('a portrait stretched onto the PSD is stretched as the browser\'s canvas does', async ({ page, browserName }, testInfo) => {
  test.setTimeout(60_000)
  await page.goto('/nodeCompile.html')
  await page.waitForFunction(() => 'nodeCompile' in window)
  const browser = await page.evaluate((cases) => window.nodeCompile.place(cases), PLACES)
  const out = testInfo.outputPath('place')
  await mkdir(out, { recursive: true })
  const request: NodePlaceRequest = { place: PLACES, png: `${out}/picture.png`, jpeg: `${out}/picture.jpg`, out }
  await writeFile(request.png, Buffer.from(browser.png, 'base64'))
  await writeFile(request.jpeg, Buffer.from(browser.jpeg, 'base64'))
  await writeFile(`${out}/request.json`, JSON.stringify(request))
  await run(process.execPath, ['--import', 'tsx', 'tests/browser/nodeCompileRun.ts', `${out}/request.json`], { cwd: root })
  for (const { name, jpeg } of PLACES) {
    const ours = await readFile(`${out}/${name}.rgba`)
    const theirs = Buffer.from(browser.frames[name]!, 'base64')
    await writeFile(`${out}/${name}.browser.rgba`, theirs)
    expect(ours.length, name).toBe(theirs.length)
    let max = 0
    let sum = 0
    for (let i = 0; i < ours.length; i += 1) {
      const alpha = i - (i % 4) + 3
      const d = i % 4 === 3
        ? Math.abs(ours[i]! - theirs[i]!)
        : Math.abs(Math.round(ours[i]! * ours[alpha]! / 255) - Math.round(theirs[i]! * theirs[alpha]! / 255))
      max = Math.max(max, d)
      sum += d
    }
    const measured = { premultipliedMax: max, premultipliedMean: sum / ours.length }
    testInfo.annotations.push({ type: `place ${name}`, description: JSON.stringify(measured) })
    // Only Chromium's stretch is the one Node follows; the others are recorded.
    if (browserName !== 'chromium') continue
    const bound = jpeg ? JPEG_BOUND : PLACE_BOUND
    expect.soft(measured.premultipliedMax, `${name}, most off`).toBeLessThanOrEqual(bound.max)
    expect.soft(measured.premultipliedMean, `${name}, mean`).toBeLessThanOrEqual(bound.mean)
  }
})

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
    // Drawn from its own layers, the portrait agrees with them: a portrait read or placed wrong would not.
    if (portrait !== 'flat') expect(JSON.parse(browser.findings).reconciliation.status).toBe('reconciled')
    await holdToBrowser(testInfo, browserName, browser, files, node, { ...boundsFor(browserName, false), sameFindings: portrait !== 'layers-half' })
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
      await holdToBrowser(testInfo, browserName, browser, files, node, boundsFor(browserName, stretched))
    })
  }
})
