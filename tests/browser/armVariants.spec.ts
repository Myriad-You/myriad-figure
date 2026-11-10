import type { Page } from '@playwright/test'
import type { BustRequest, FreeResult, RiseResult } from './fixture/armVariants'
import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { expect, test } from '@playwright/test'

// Gesture arms on real busts. No artwork is kept in this repository: the test
// runs where FIGURE_ARM_VARIANTS names a directory of variants/<tag>.png and
// <tag>-pose.json beside ../psd/<bust>.psd and ../psd/<bust>.png (a tag is
// <bust>-<gesture>-<L|R>, the bust its short name), and is skipped elsewhere.
// With portrait-pose/<bust>.json there too (the pose model's joints on the
// portrait), the arms are measured and played as 3D arms; without, raised flat.
// FIGURE_ARM_VARIANTS_ALL=1 raises every variant there, not just a sample.
const root = process.env.FIGURE_ARM_VARIANTS ?? ''
const BUSTS: Record<string, string> = {
  b00: 'blind-b00-house-bust',
  h01: 'blind-h01-gothic-bust',
  h05: 'blind-h05-idol-bust',
  h06: 'blind-h06-sci-fi-bust',
  h08: 'blind-h08-japanese-bust',
  h11: 'blind-h11-lounge-bust',
  h13: 'blind-h13-formal-bust',
}
const SAMPLE = ['b00-wave-L', 'b00-chest-L', 'h13-point-L', 'h13-chin-L', 'h06-wave-R', 'h08-chest-L']

const hasBusts = Boolean(root) && existsSync(join(root, 'variants'))
test.describe.configure({ timeout: 180_000 })

function tagsOf(bust: string): string[] {
  return ['wave', 'point', 'chest', 'chin'].flatMap((gesture) => ['L', 'R'].map((side) => `${bust}-${gesture}-${side}`))
    .filter((tag) => existsSync(join(root, 'variants', `${tag}.png`)))
}

interface Pose { keypoints: number[][]; width?: number; height?: number; hand?: number[][] }

const triples = (points: number[][]) => points.map(([x, y, score]) => [x ?? 0, y ?? 0, score ?? 0] as const)

async function poseOf(file: string): Promise<Pose> {
  return JSON.parse(await readFile(file, 'utf8')) as Pose
}

/** The points of the hand the variant raised: the one of the two the pose model is surer of. */
function handOf({ keypoints }: Pose): Array<[number, number]> {
  const hands = [keypoints.slice(91, 112), keypoints.slice(112, 133)]
  const sure = (hand: number[][]) => hand.reduce((sum, point) => sum + (point[2] ?? 0), 0)
  const best = sure(hands[0]!) >= sure(hands[1]!) ? hands[0]! : hands[1]!
  return best.filter((point) => (point[2] ?? 0) >= 0.3).map((point) => [point[0]!, point[1]!])
}

/** Whether the bust's portrait has its joints here: then its arms are measured in 3D. */
function measured(bust: string): boolean {
  return existsSync(join(root, 'portrait-pose', `${BUSTS[bust]}.json`))
}

/** The bust and its variants for the page; measured in 3D where its portrait's joints are here, unless `flat`. */
async function serve(page: Page, bust: string, tags: string[], flat = false): Promise<BustRequest> {
  const name = BUSTS[bust]!
  await page.route('**/arm/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/arm\//, '')
    const file = path.startsWith('psd/') ? join(root, '..', path) : join(root, path)
    await route.fulfill({ body: await readFile(file), contentType: file.endsWith('.png') ? 'image/png' : 'application/octet-stream' })
  })
  await page.goto('/armVariants.html')
  await page.waitForFunction(() => 'armVariantProbe' in window)
  const portraitUrl = `/arm/psd/${name}.png`
  const portrait = measured(bust) && !flat ? await poseOf(join(root, 'portrait-pose', `${name}.json`)) : null
  const variants = await Promise.all(tags.map(async (tag) => {
    const [, gesture, side] = tag.split('-') as [string, 'wave', 'L' | 'R']
    const pose = await poseOf(join(root, 'variants', `${tag}-pose.json`))
    return {
      gesture,
      side: side === 'L' ? 'left' as const : 'right' as const,
      url: `/arm/variants/${tag}.png`,
      hand: handOf(pose),
      ...(portrait ? { keypoints: triples(pose.keypoints) } : {}),
      size: [pose.width, pose.height] as const,
    }
  }))
  const [width, height] = variants[0]?.size ?? []
  return {
    psdUrl: `/arm/psd/${name}.psd`,
    portraitUrl,
    variants: variants.map(({ size: _size, ...variant }) => variant),
    ...(portrait
      ? { skeleton: { sourceMasterAssetId: portraitUrl, model: 'dwpose', width: portrait.width ?? width ?? 0, height: portrait.height ?? height ?? 0, keypoints: triples(portrait.keypoints) } }
      : {}),
  }
}

test.describe('busts', () => {
  test.skip(!hasBusts, 'FIGURE_ARM_VARIANTS names no variants')

  test('gesture arms drawn on a bust change nothing it draws until one is raised', async ({ page }) => {
    for (const bust of ['b00', 'h06']) {
      const request = await serve(page, bust, tagsOf(bust), true)
      const result = await page.evaluate((request) => window.armVariantProbe.golden(request), request)
      expect(result.roles.filter((role) => role === 'arm-variant')).toHaveLength(request.variants.length)
      expect(result.roles).not.toContain('arm-variant without')
      expect(result.frames).toBeGreaterThan(10)
      // A rounding step at most, on a sliver of the pixels.
      expect(result.worst, bust).toBeLessThanOrEqual(1)
      expect(result.differing / (result.frames * 384 * 512 * 4), bust).toBeLessThan(0.001)
    }
  })

  test('a side measured in 3D hangs its modelled arm where the drawn one hangs', async ({ page }) => {
    const busts = ['b00', 'h13'].filter(measured)
    test.skip(busts.length === 0, 'no portrait joints here')
    test.setTimeout(400_000)
    for (const bust of busts) {
      const request = await serve(page, bust, tagsOf(bust))
      const result = await page.evaluate((request) => window.armVariantProbe.golden(request), request)
      expect(result.roles.filter((role) => role === 'arm-variant')).toHaveLength(request.variants.length)
      expect(result.frames).toBeGreaterThan(10)
      // Its edge a pixel or so off the drawn arm's while the figure stands upright (about 0.4% of the picture measured
      // here), a little more as the body leans and turns under the scripted poses (about 1.8%); misplaced or missing,
      // the arm is many times that.
      const upright = [...result.apart.slice(0, 3), ...result.apart.slice(-2)]
      expect(Math.max(...upright), `${bust} upright ${upright.map((v) => v.toFixed(4)).join(' ')}`).toBeLessThan(0.008)
      expect(Math.max(...result.apart), `${bust} ${result.apart.map((v) => v.toFixed(4)).join(' ')}`).toBeLessThan(0.03)
    }
  })

  const raised = !hasBusts ? [] : process.env.FIGURE_ARM_VARIANTS_ALL
    ? Object.keys(BUSTS).flatMap(tagsOf)
    : SAMPLE.filter((tag) => existsSync(join(root, 'variants', `${tag}.png`)))

  for (const tag of raised) {
    test(`${tag} rises in and goes down with nothing left bare`, async ({ page }, testInfo) => {
      const [bust, gesture, side] = tag.split('-') as [string, string, 'L' | 'R']
      const request = await serve(page, bust, [tag])
      const result: RiseResult = await page.evaluate(([request, side, gesture]) =>
        window.armVariantProbe.rise(request, side, gesture), [request, side, gesture] as const)
      await testInfo.attach('coverage', { body: JSON.stringify({ rest: result.rest, held: result.held, covered: result.covered, flicker: result.flicker }), contentType: 'application/json' })
      for (const shot of result.shots) await testInfo.attach(shot.name, { body: Buffer.from(shot.image, 'base64'), contentType: 'image/png' })
      expect(result.gestures[side]).toEqual([gesture])
      expect(result.modelled).toBe(measured(bust))
      // Every frame of the rise and the fall covers the arm's box at least as
      // well as resting or raised does (a gap shows as bare canvas there).
      const floor = Math.min(result.rest, result.held) - 0.005
      const worst = Math.min(...result.covered)
      expect(worst, `worst ${worst.toFixed(4)} against rest ${result.rest.toFixed(4)} and raised ${result.held.toFixed(4)}`).toBeGreaterThanOrEqual(floor)
      // No frame shows or drops something for itself alone: a moving arm keeps each frame's drawn share and lightness
      // between its neighbours' (measured at most about 0.011 on the busts here, a fast wave's fingers).
      const jump = Math.max(...result.flicker)
      expect(jump, `frame ${result.flicker.indexOf(jump) + 1} stands ${jump.toFixed(4)} outside its neighbours`).toBeLessThan(0.03)
    })
  }
})

// Gesture arms on real standing figures, the same way: FIGURE_ARM_VARIANTS_FULL names a directory laid out as the
// busts' (variants/<tag>.png and <tag>-pose.json, portrait-pose/<figure>.json, ../psd/<figure>.psd and .png, the
// picture there the enlarged one the figure was decomposed from). A full body's arms are always measured in 3D.
const fullRoot = process.env.FIGURE_ARM_VARIANTS_FULL ?? ''
const FIGURES: Record<string, string> = {
  b08: 'blind-b08-house-full',
  h16: 'blind-h16-sci-fi-full',
}
const hasFigures = Boolean(fullRoot) && existsSync(join(fullRoot, 'variants'))

// h16's left arm (a long white glove) is modelled wider than drawn; fitting the sleeve to the drawing is the
// next step. Passing, one of these says so.
const KNOWN_FIGURE_FLICKERS = new Set(['h16-wave-L', 'h16-point-L', 'h16-chest-L'])

function figureTags(figure: string): string[] {
  return ['wave', 'point', 'chest', 'chin'].flatMap((gesture) => ['L', 'R'].map((side) => `${figure}-${gesture}-${side}`))
    .filter((tag) => existsSync(join(fullRoot, 'variants', `${tag}.png`)))
}

async function serveFigure(page: Page, figure: string, tags: string[]): Promise<BustRequest> {
  const name = FIGURES[figure]!
  await page.route('**/arm/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/arm\//, '')
    const file = path.startsWith('psd/') ? join(fullRoot, '..', path) : join(fullRoot, path)
    await route.fulfill({ body: await readFile(file), contentType: file.endsWith('.png') ? 'image/png' : 'application/octet-stream' })
  })
  await page.goto('/armVariants.html')
  await page.waitForFunction(() => 'armVariantProbe' in window)
  const portraitUrl = `/arm/psd/${name}.png`
  const portrait = await poseOf(join(fullRoot, 'portrait-pose', `${name}.json`))
  const variants = await Promise.all(tags.map(async (tag) => {
    const [, gesture, side] = tag.split('-') as [string, 'wave', 'L' | 'R']
    const pose = await poseOf(join(fullRoot, 'variants', `${tag}-pose.json`))
    // Both a figure's hands are drawn: the gesture's is the one on its side, as the backend stored it.
    const hand = pose.hand?.length ? pose.hand.map(([x, y]) => [x ?? 0, y ?? 0] as [number, number]) : handOf(pose)
    return { gesture, side: side === 'L' ? 'left' as const : 'right' as const, url: `/arm/variants/${tag}.png`, hand, keypoints: triples(pose.keypoints) }
  }))
  return {
    psdUrl: `/arm/psd/${name}.psd`,
    portraitUrl,
    variants,
    skeleton: { sourceMasterAssetId: portraitUrl, model: 'dwpose', width: portrait.width ?? 0, height: portrait.height ?? 0, keypoints: triples(portrait.keypoints) },
    fullBody: true,
  }
}

test.describe('standing figures', () => {
  test.skip(!hasFigures, 'FIGURE_ARM_VARIANTS_FULL names no variants')

  test('gesture arms on a standing figure change nothing it draws until one is raised, swaying and turning', async ({ page }) => {
    test.setTimeout(600_000)
    for (const figure of Object.keys(FIGURES).filter((f) => figureTags(f).length > 0)) {
      const request = await serveFigure(page, figure, figureTags(figure))
      const result = await page.evaluate((request) => window.armVariantProbe.golden(request), request)
      expect(result.roles.filter((role) => role === 'arm-variant')).toHaveLength(request.variants.length)
      expect(result.frames).toBeGreaterThan(10)
      // Its drawn arms hang until one gesture is raised: a rounding step at most, as on a bust without joints.
      expect(result.worst, figure).toBeLessThanOrEqual(1)
      expect(Math.max(...result.apart), figure).toBe(0)
    }
  })

  for (const figure of Object.keys(FIGURES)) {
    for (const tag of hasFigures ? figureTags(figure) : []) {
      test(`${tag} rises on a standing figure and goes down with nothing left bare`, async ({ page }, testInfo) => {
        test.fail(KNOWN_FIGURE_FLICKERS.has(tag), 'the modelled sleeve is wider than drawn: the drawn upper arm laid over it as it arrives and goes doubles its edge for a few frames')
        const [, gesture, side] = tag.split('-') as [string, string, 'L' | 'R']
        const request = await serveFigure(page, figure, [tag])
        const result: RiseResult = await page.evaluate(([request, side, gesture]) =>
          window.armVariantProbe.rise(request, side, gesture), [request, side, gesture] as const)
        await testInfo.attach('coverage', { body: JSON.stringify({ rest: result.rest, held: result.held, covered: result.covered, flicker: result.flicker }), contentType: 'application/json' })
        for (const shot of result.shots) await testInfo.attach(shot.name, { body: Buffer.from(shot.image, 'base64'), contentType: 'image/png' })
        expect(result.gestures[side]).toEqual([gesture])
        expect(result.modelled).toBe(true)
        const floor = Math.min(result.rest, result.held) - 0.005
        expect(Math.min(...result.covered)).toBeGreaterThanOrEqual(floor)
        const jump = Math.max(...result.flicker)
        expect(jump, `frame ${result.flicker.indexOf(jump) + 1} stands ${jump.toFixed(4)} outside its neighbours`).toBeLessThan(0.03)
      })
    }
  }
  for (const [figure, side] of [['b08', 'L'], ['b08', 'R'], ['h16', 'R']] as const) {
    test(`${figure}'s ${side} arm goes from gesture to gesture and where it is aimed without being put down`, async ({ page }, testInfo) => {
      test.setTimeout(600_000)
      const tags = figureTags(figure).filter((tag) => tag.endsWith(`-${side}`))
      test.skip(tags.length < 2, 'fewer than two gestures drawn on this side')
      const gestures = tags.map((tag) => tag.split('-')[1]!)
      const request = await serveFigure(page, figure, tags)
      const result: FreeResult = await page.evaluate(([request, side, gestures]) =>
        window.armVariantProbe.free(request, side, gestures), [request, side, gestures] as const)
      await testInfo.attach('flicker', { body: JSON.stringify(Object.fromEntries(Object.entries(result.flicker).map(([name, f]) => [name, Math.max(...f)]))), contentType: 'application/json' })
      for (const shot of result.shots) await testInfo.attach(shot.name, { body: Buffer.from(shot.image, 'base64'), contentType: 'image/png' })
      for (const [name, series] of Object.entries(result.flicker)) {
        const jump = Math.max(...series)
        expect(jump, `${name}: frame ${series.indexOf(jump) + 1} stands ${jump.toFixed(4)} outside its neighbours`).toBeLessThan(0.03)
      }
      // Let go, the figure is the one it was: its drawn arm, nothing of a gesture left.
      expect(result.changed).toBeLessThan(0.001)
    })
  }
})
