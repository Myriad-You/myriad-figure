import type { Page, TestInfo } from '@playwright/test'
import type { PackageRef, SwapRequest } from './fixture/probes'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { basename, delimiter } from 'node:path'
import process from 'node:process'
import { expect, test } from '@playwright/test'

// Synthetic packages run everywhere. Real art runs where FIGURE_REAL_ASSETS
// lists package directories (manifest.json + atlas.png); no artwork is kept
// in this repository. A probe a package cannot exercise is skipped with the
// reason, from what the package itself carries.
const real = (process.env.FIGURE_REAL_ASSETS ?? '').split(delimiter).filter(Boolean)
const packages: { name: string, synthetic?: string, root?: string }[] = [
  { name: 'synthetic', synthetic: 'ordinary' },
  { name: 'synthetic collar', synthetic: 'collar' },
  ...real.map(root => ({ name: `real ${basename(root).slice(0, 8)}`, root })),
]

type Probes = typeof import('./fixture/probes')['probes']

/** The importer reads a portrait for every PSD; serves a flat one. */
async function servePortrait(page: Page) {
  const portrait = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 192
    canvas.height = 256
    const context = canvas.getContext('2d')!
    context.fillStyle = '#efcdbc'
    context.fillRect(0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png').split(',')[1]!
  })
  await page.route('**/unused*.png', route => route.fulfill({ contentType: 'image/png', body: Buffer.from(portrait, 'base64') }))
}

async function stage(page: Page, pkg: (typeof packages)[number]): Promise<PackageRef> {
  await page.route('**/api/**', route => route.abort())
  await page.goto('/probes.html')
  await page.waitForFunction(() => 'figureProbes' in window)
  if (pkg.root) {
    const manifest = JSON.parse(await readFile(`${pkg.root}/manifest.json`, 'utf8'))
    const atlas = await readFile(`${pkg.root}/atlas.png`)
    await page.route('**/real-atlas.png', route => route.fulfill({ contentType: 'image/png', body: atlas }))
    return { manifest, atlasUrl: '/real-atlas.png' }
  }
  await servePortrait(page)
  return { synthetic: pkg.synthetic! }
}

async function run<K extends keyof Probes>(page: Page, name: K, ref: Parameters<Probes[K]>[0]): Promise<Awaited<ReturnType<Probes[K]>>> {
  const result = await page.evaluate(
    ([name, ref]) => (window as unknown as { figureProbes: Record<string, (ref: unknown) => unknown> }).figureProbes[name]!(ref),
    [name as string, ref as unknown] as const,
  )
  return result as Awaited<ReturnType<Probes[K]>>
}

async function attach(testInfo: TestInfo, metrics: unknown, shots: { name: string, image: string }[] = []) {
  await testInfo.attach('metrics', { body: JSON.stringify(metrics, (_key, value) => typeof value === 'string' && value.length > 200 ? undefined : value, 2), contentType: 'application/json' })
  for (const shot of shots) await testInfo.attach(shot.name, { body: Buffer.from(shot.image, 'base64'), contentType: 'image/png' })
}

test('the body stage on the GPU agrees with the CPU mirror inspect() draws with', async ({ page }) => {
  await page.goto('/probes.html')
  await page.waitForFunction(() => 'figureProbes' in window)
  const error = await page.evaluate(() => (window as unknown as { figureProbes: Probes }).figureProbes.bodyStageProjection())
  expect(error).toBeLessThan(0.001)
})

for (const pkg of packages) {
  test.describe(pkg.name, () => {
    test.describe.configure({ timeout: 300_000 })

    test('lift and pitch reach pixels, keep the neck on the torso and the cut in place', async ({ page }, testInfo) => {
      const result = await run(page, 'posture', await stage(page, pkg))
      await attach(testInfo, result, result.shots)
      expect(result.error).toBe(0)
      const [, up, down, forward, back] = result.poses
      expect(up!.amount).toBeGreaterThan(result.reach * 0.8)
      expect(down!.amount).toBeLessThan(-result.reach * 0.8)
      expect(forward!.pitchAmount).toBeGreaterThan(0.17)
      expect(back!.pitchAmount).toBeLessThan(-0.17)
      expect(new Set(result.poses.map(pose => pose.hash)).size).toBe(result.poses.length)
      for (const pose of result.poses) {
        if (!pose.pitch) expect(Math.abs(pose.neckShift + pose.amount)).toBeLessThan(0.001)
        if (pose.pitch || pose.lift) expect(pose.changed).toBeGreaterThan(pose.pixels * 0.01)
        expect(pose.cutShift).toBe(0)
        expect(pose.shapeRatio).toBeGreaterThan(0.65)
        // A standing figure's lean is in its layers' own vertices: against itself upright, nothing folds
        // (the neck under a chin come down over it is pressed shortest).
        expect(pose.uprightRatio).toBeGreaterThan(0.3)
      }
      // Head performances recruit the posture without knowing about it (a standing figure leans back as it looks up).
      expect(result.recruited.lift).toBeGreaterThan(result.reach * 0.15)
      expect(Math.abs(result.recruited.pitch)).toBeGreaterThan(0.04)
    })

    test('a short head turn reaches the torso within the cue and the torso returns to rest', async ({ page }, testInfo) => {
      const result = await run(page, 'torsoTurn', await stage(page, pkg))
      await attach(testInfo, result)
      // `sustained` holds the turn for the whole replay: its value is the settled torso turn.
      expect(result.sustained.atCueEnd).toBeGreaterThan(0)
      expect(result.short.atCueEnd).toBeGreaterThan(result.sustained.atCueEnd * 0.4)
      expect(result.short.residual).toBeLessThan(0.001)
      expect(Math.max(result.short.error, result.sustained.error)).toBe(0)
    })

    test('through continuous turns at 30, 60 and 120 fps earrings stay on the ears and nothing jumps', async ({ page }, testInfo) => {
      const result = await run(page, 'turns', await stage(page, pkg))
      await attach(testInfo, result)
      for (const metric of result) {
        expect(metric.invalid).toBe(0)
        expect(metric.error).toBe(0)
        if (metric.rootsChecked) expect(metric.roots).toBeLessThan(0.01)
        expect(metric.minRatio).toBeGreaterThan(0)
      }
    })

    test('the same performance moves the same way at every frame rate', async ({ page }, testInfo) => {
      const result = await run(page, 'turns', await stage(page, pkg))
      await attach(testInfo, result)
      const finest = result.at(-1)!
      for (const metric of result) {
        expect(metric.maxSpeed).toBeLessThan(finest.maxSpeed * 1.25)
        metric.trajectory.forEach((point, i) => {
          expect(Math.hypot(point.x - finest.trajectory[i]!.x, point.y - finest.trajectory[i]!.y)).toBeLessThan(2)
        })
      }
    })

    test('at every corner of combined turns the head surfaces stay oriented', async ({ page }, testInfo) => {
      // The synthetic face is a flat block, not a drawn face; see README.
      test.skip(!pkg.root, 'Drawn faces only')
      const result = await run(page, 'corners', await stage(page, pkg))
      await attach(testInfo, result, result.shots)
      expect(result.error).toBe(0)
      for (const corner of result.runs) {
        expect(corner.visibleTriangles).toBeGreaterThan(20)
        expect(corner.minimum, JSON.stringify(corner)).toBeGreaterThan(0)
      }
    })

    test('an authored correction moves only its pose and releases exactly', async ({ page }, testInfo) => {
      const result = await run(page, 'correction', await stage(page, pkg))
      await attach(testInfo, result.differences, result.shots)
      result.differences.forEach((difference, index) => {
        expect(difference.error).toBe(0)
        expect(difference.bodyError).toBe(0)
        expect(difference.restored).toBe(0)
        if (index === 4) {
          // The synthetic face is flat colour: its moved surface shows no pixel change.
          if (pkg.root) expect(difference.changed).toBeGreaterThan(100)
          expect(difference.eyeShift).toBeGreaterThan(8)
          expect(difference.eyeShift).toBeLessThan(16.5)
        }
        else {
          expect(difference.changed).toBe(0)
          expect(difference.eyeShift).toBeLessThan(0.001)
        }
      })
    })

    test('a high collar keeps its own opening and is not sewn to skin', async ({ page }, testInfo) => {
      const result = await run(page, 'collar', await stage(page, pkg))
      test.skip(!result.aperture, 'No high collar in this package')
      if (!result.aperture) return
      await attach(testInfo, result, [{ name: 'collar', image: result.shot }])
      expect(result.roles).toEqual(expect.arrayContaining(['neck', 'collar-front', 'collar-back']))
      expect(result.contacts).toBe(0)
      expect(result.sleeveContacts).toBe(0)
      expect(result.invalid).toBe(0)
      expect(result.excursion).toBeGreaterThan(1)
      expect(result.error).toBe(0)
    })

    test('exposed shoulders stay sewn to the torso\'s drawn edge through body and arm motion', async ({ page }, testInfo) => {
      const result = await run(page, 'shoulder', await stage(page, pkg))
      test.skip(!result.contacts.length, 'No exposed shoulder in this package')
      await attach(testInfo, result, result.settled?.map((pose, i) => ({ name: `shoulder-pose-${i}`, image: pose.shot })))
      expect(result.contacts).toHaveLength(2)
      expect(result.boundary).toBeGreaterThan(5)
      for (const sweep of result.sweeps) {
        expect(sweep.invalid).toBe(0)
        expect(sweep.error).toBe(0)
        expect(sweep.seam).toBeLessThan(0.25)
        expect(sweep.contactRatio).toBeGreaterThan(0)
        expect(sweep.hairRatio).toBeGreaterThan(0)
      }
      for (const pose of result.settled ?? []) {
        expect(pose.finite).toBe(true)
        expect(pose.error).toBe(0)
      }
    })

    test('earrings swing on their own while their roots stay on the ear', async ({ page }, testInfo) => {
      const result = await run(page, 'earrings', await stage(page, pkg))
      test.skip(!result.names.length, 'No hanging earrings in this package')
      await attach(testInfo, result)
      expect(result.checked).toBeGreaterThanOrEqual(result.names.length)
      expect(result.roots).toBeLessThan(0.01)
      expect(result.swing).toBeGreaterThan(2)
      expect(result.determinant).toBeGreaterThan(0.75)
      expect(result.error).toBe(0)
    })

    test('hair follows a nod both ways, a combined turn without tearing, and a body-only move, then settles', async ({ page }, testInfo) => {
      // Six replays, one of them fifteen seconds; drawn art with many hair layers takes minutes.
      test.setTimeout(600_000)
      const result = await run(page, 'hair', await stage(page, pkg))
      await attach(testInfo, result, result.shots)
      expect(result.nod.error).toBe(0)
      expect(result.nod.minY).toBeLessThan(-0.5)
      expect(result.nod.maxY).toBeGreaterThan(0.5)
      expect(result.nod.pixels).toBeGreaterThan(100)
      expect(result.nod.ratio).toBeGreaterThan(0)
      expect(result.combined.strands).toBeGreaterThan(3)
      expect(result.combined.spread).toBeGreaterThan(5)
      expect(result.combined.ratio).toBeGreaterThan(0)
      // A reversal at the faster, frame-rate-independent head speed swings back hair hardest: on drawn art
      // a back-hair edge stretched to 1.42× its rigid length and still looked whole (the worst edge's frame
      // is attached as hair-turn-most-stretched). A tear stretches far beyond that.
      expect(result.combined.edgeRatio, JSON.stringify(result.combined.worstEdge)).toBeLessThan(1.5)
      expect(result.combined.error).toBe(0)
      expect(result.trail.headMoved).toBeLessThan(1e-8)
      expect(result.trail.peak).toBeGreaterThan(3)
      // Still moving less than a fifth of a pixel a second after fourteen seconds.
      expect(result.trail.settledMotion).toBeLessThan(0.2)
      expect(result.trail.error).toBe(0)
    })

    test('music hands over to idle without resetting the head or freezing the hair', async ({ page }, testInfo) => {
      const result = await run(page, 'musicExit', await stage(page, pkg))
      await attach(testInfo, result)
      for (const metric of result) {
        expect(metric.reset).toBe(false)
        expect(metric.musicRange).toBeGreaterThan(0.1)
        expect(metric.idleRange).toBeGreaterThan(0.1)
        expect(metric.idleHairTravel).toBeGreaterThan(5)
        // Against the music's own beats, so a full body's long lever does not count as a jump; a reset is
        // hundreds of times the music.
        expect(metric.peakAcceleration).toBeLessThan(metric.musicAcceleration * 6)
        expect(metric.error).toBe(0)
      }
    })

    test('speech during a thought keeps a newer face and lets the thought go without a jump', async ({ page }, testInfo) => {
      const result = await run(page, 'thoughtToSpeech', await stage(page, pkg))
      await attach(testInfo, result)
      expect(result.reset).toBe(false)
      expect(result.brow).toBe(0.24)
      expect(result.thinking).toBe(false)
      expect(result.released).toBe(true)
      expect(result.maxHeadStep).toBeLessThan(0.2)
      expect(result.mouthPeak).toBeGreaterThan(0.15)
      expect(result.error).toBe(0)
    })

    test('layers cut by the canvas edge together stay joined along it', async ({ page }, testInfo) => {
      const result = await run(page, 'sharedCut', await stage(page, pkg))
      test.skip(!result.names.length, 'Nothing in this package shares the canvas cut')
      await attach(testInfo, result)
      expect(result.maxError).toBeLessThan(0.001)
      expect(result.folds).toBe(0)
      expect(result.error).toBe(0)
    })
  })
}

// What is shown, and what the failing swap puts on: another outfit; one with a modelled arm, over a figure without arms
// and over one with (its GPU steps only, the reads being the same); and real art those two ways.
const synthetic = (kind: string, armed = false): PackageRef => ({ synthetic: kind, armed })
const swaps: { name: string, root?: string, refs: (own: PackageRef) => SwapRequest }[] = [
  { name: 'synthetic to synthetic collar', refs: () => ({ shown: synthetic('ordinary'), next: synthetic('collar') }) },
  { name: 'synthetic collar to an outfit with a modelled arm', refs: () => ({ shown: synthetic('collar'), next: synthetic('ordinary', true) }) },
  { name: 'synthetic with a modelled arm to the same', refs: () => ({ shown: synthetic('ordinary', true), next: synthetic('ordinary', true), kinds: ['gpu'] }) },
  ...real.flatMap((root) => {
    const name = `real ${basename(root).slice(0, 8)}`
    return [
      { name: `synthetic to ${name}`, root, refs: (own: PackageRef) => ({ shown: synthetic('ordinary'), next: own }) },
      { name: `${name} to itself`, root, refs: (own: PackageRef) => ({ shown: own, next: own, kinds: ['gpu'] }) },
    ]
  }),
]

for (const { name, root, refs } of swaps) {
  test(`${name}: an outfit swap that fails anywhere leaves the figure exactly as it was`, async ({ page }, testInfo) => {
    // Every place builds most of an outfit again; real art, with its modelled arms, takes many minutes.
    test.setTimeout(root ? 3_600_000 : 900_000)
    const own = await stage(page, { name, root, synthetic: 'ordinary' })
    if (root) await servePortrait(page)
    const request = refs(own)
    const result = await run(page, 'swapFaults', request)
    await attach(testInfo, result)
    expect(result.runs.filter(run => !run.fired), 'every failure was put where it was meant').toEqual([])
    for (const kind of request.kinds ?? ['gpu', 'read'])
      expect(result.runs.some(run => run.kind === kind && run.outcome === 'refused'), kind).toBe(true)
    if (name.includes('modelled arm')) expect(result.runs.some(run => run.site.includes('arm3dArm')), 'a modelled arm was made').toBe(true)
    expect(result.runs.filter(run => !run.same || run.leaked || run.lost || run.error)).toEqual([])
    expect(result.recovered, 'after refused swaps the next one goes through').toBe(true)
  })
}

// A frame as data, drawn again: plain, with a modelled arm, and on real art.
const posed: { name: string, root?: string, ref?: PackageRef }[] = [
  { name: 'synthetic', ref: synthetic('ordinary') },
  { name: 'synthetic collar', ref: synthetic('collar') },
  { name: 'synthetic with a modelled arm and a mouth painted as she speaks', ref: synthetic('closed-mouth', true) },
  ...real.map(root => ({ name: `real ${basename(root).slice(0, 8)}`, root })),
]

for (const { name, root, ref } of posed) {
  test(`${name}: a pose taken as data is drawn again to the pixel and moves nothing`, async ({ page }, testInfo) => {
    test.setTimeout(root ? 1_200_000 : 300_000)
    const own = await stage(page, { name, root, synthetic: 'ordinary' })
    if (root) await servePortrait(page)
    const result = await run(page, 'poses', ref ?? own)
    await attach(testInfo, result)
    expect(result.error).toBe(0)
    expect(result.lagging, 'what the GPU has is what the pose says').toBe(0)
    expect(result.replayed, 'drawn by another player').toBe(result.drawn)
    expect(result.sized, 'and as large as its canvas').toBe(result.drawn)
    expect(result.resized).toBe(true)
    expect(result.gone, 'no frame of the outfit put on again yet').toBe(true)
    expect(result.again).toBe(true)
    expect(result.went).toBe(true)
    expect(result.damaged).toBeGreaterThan(0)
    expect(result.taking, 'damaged in what is drawn, yet drawn').toEqual([])
    expect(result.spoilt, 'refused, it changes nothing').toBe(0)
    expect(result.drifted, 'drawing poses leaves her as she was').toBe(0)
    expect(result.settled, 'a pose shown while she is still leaves nothing of it').toBe(true)
    expect(result.refused).toBe(0)
    expect(result.shown).toBeGreaterThan(0)
    expect(result.returned, 'and her own frame again on top').toBe(result.shown)
    expect(result.between, 'a pose between two is another picture').toBeGreaterThan(0)
    // What the package has is in the poses.
    expect(result.stickers).toBeGreaterThan(0)
    if (result.parts.mouth) expect(result.mouths).toBeGreaterThan(1)
    if (result.parts.arm) expect(result.armed).toBeGreaterThan(0)
    if (result.parts.cloth) expect(result.cloths).toBeGreaterThan(0)
    if (name.includes('modelled arm')) expect(result.parts).toEqual({ mouth: true, cloth: false, arm: true })
    expect(result.wrong).toEqual({ other: false, short: false, nothing: false, bad: false })
  })
}
