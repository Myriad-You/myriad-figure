import type { Page } from '@playwright/test'
import type { BustRequest, RiseResult } from './fixture/armVariants'
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

test.skip(!root || !existsSync(join(root, 'variants')), 'FIGURE_ARM_VARIANTS names no variants')
test.describe.configure({ timeout: 180_000 })

function tagsOf(bust: string): string[] {
  return ['wave', 'point', 'chest', 'chin'].flatMap((gesture) => ['L', 'R'].map((side) => `${bust}-${gesture}-${side}`))
    .filter((tag) => existsSync(join(root, 'variants', `${tag}.png`)))
}

/** The points of the hand the variant raised: the one of the two the pose model is surer of. */
async function handOf(tag: string): Promise<Array<[number, number]>> {
  const { keypoints } = JSON.parse(await readFile(join(root, 'variants', `${tag}-pose.json`), 'utf8')) as { keypoints: number[][] }
  const hands = [keypoints.slice(91, 112), keypoints.slice(112, 133)]
  const sure = (hand: number[][]) => hand.reduce((sum, point) => sum + (point[2] ?? 0), 0)
  const best = sure(hands[0]!) >= sure(hands[1]!) ? hands[0]! : hands[1]!
  return best.filter((point) => (point[2] ?? 0) >= 0.3).map((point) => [point[0]!, point[1]!])
}

async function serve(page: Page, bust: string, tags: string[]): Promise<BustRequest> {
  const name = BUSTS[bust]!
  await page.route('**/arm/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/arm\//, '')
    const file = path.startsWith('psd/') ? join(root, '..', path) : join(root, path)
    await route.fulfill({ body: await readFile(file), contentType: file.endsWith('.png') ? 'image/png' : 'application/octet-stream' })
  })
  await page.goto('/armVariants.html')
  await page.waitForFunction(() => 'armVariantProbe' in window)
  return {
    psdUrl: `/arm/psd/${name}.psd`,
    portraitUrl: `/arm/psd/${name}.png`,
    variants: await Promise.all(tags.map(async (tag) => {
      const [, gesture, side] = tag.split('-') as [string, 'wave', 'L' | 'R']
      return { gesture, side: side === 'L' ? 'left' as const : 'right' as const, url: `/arm/variants/${tag}.png`, hand: await handOf(tag) }
    })),
  }
}

test('gesture arms drawn on a bust change nothing it draws until one is raised', async ({ page }) => {
  for (const bust of ['b00', 'h06']) {
    const request = await serve(page, bust, tagsOf(bust))
    const result = await page.evaluate((request) => window.armVariantProbe.golden(request), request)
    expect(result.roles.filter((role) => role === 'arm-variant')).toHaveLength(request.variants.length)
    expect(result.roles).not.toContain('arm-variant without')
    expect(result.frames).toBeGreaterThan(10)
    // A rounding step at most, on a sliver of the pixels.
    expect(result.worst, bust).toBeLessThanOrEqual(1)
    expect(result.differing / (result.frames * 384 * 512 * 4), bust).toBeLessThan(0.001)
  }
})

const raised = process.env.FIGURE_ARM_VARIANTS_ALL
  ? Object.keys(BUSTS).flatMap(tagsOf)
  : SAMPLE.filter((tag) => existsSync(join(root, 'variants', `${tag}.png`)))

for (const tag of raised) {
  test(`${tag} rises in and goes down with nothing left bare`, async ({ page }, testInfo) => {
    const [bust, gesture, side] = tag.split('-') as [string, string, 'L' | 'R']
    const request = await serve(page, bust, [tag])
    const result: RiseResult = await page.evaluate(([request, side, gesture]) =>
      window.armVariantProbe.rise(request, side, gesture), [request, side, gesture] as const)
    await testInfo.attach('coverage', { body: JSON.stringify({ rest: result.rest, held: result.held, covered: result.covered }), contentType: 'application/json' })
    for (const shot of result.shots) await testInfo.attach(shot.name, { body: Buffer.from(shot.image, 'base64'), contentType: 'image/png' })
    expect(result.gestures[side]).toEqual([gesture])
    // Every frame of the rise and the fall covers the arm's box at least as
    // well as resting or raised does (a gap shows as bare canvas there).
    const floor = Math.min(result.rest, result.held) - 0.005
    const worst = Math.min(...result.covered)
    expect(worst, `worst ${worst.toFixed(4)} against rest ${result.rest.toFixed(4)} and raised ${result.held.toFixed(4)}`).toBeGreaterThanOrEqual(floor)
  })
}
