import type { RasterLayer } from './anime25dImportTypes'
import type { ArmCuffPictures } from './armCuff'
import type { P2 } from './armRaster'
import assert from 'node:assert/strict'
import test from 'node:test'
import { cuffDrawnAtWrist } from './armCuff'
import { dropMovedCuffs } from './armVariants'

const W = 400
const H = 600
const SLEEVE = [70, 90, 160] as const
const BAND = [220, 60, 60] as const
const SKIN = [240, 205, 190] as const
type Rgb = readonly [number, number, number]

const SHOULDER: P2 = [200, 100]
const ELBOW: P2 = [200, 300]
const HUNG: P2 = [200, 500]
const RAISED: P2 = [320, 180]

function along(q: P2, a: P2, b: P2): { t: number; d: number } {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy)))
  return { t, d: Math.hypot(q[0] - a[0] - dx * t, q[1] - a[1] - dy * t) }
}

/** An arm 30 wide each side: its upper arm sleeved (a band down by the elbow, `bandUp`), its forearm skin (a band at `bandFore` along it). */
function arm(wrist: P2, bandUp: boolean, bandFore: [number, number] | null) {
  const img = new Uint8Array(W * H * 3).fill(255)
  const mask = new Uint8Array(W * H)
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const up = along([x, y], SHOULDER, ELBOW)
      const fore = along([x, y], ELBOW, wrist)
      let c: Rgb | null = null
      if (fore.d < 30) c = bandFore && fore.t >= bandFore[0] && fore.t < bandFore[1] ? BAND : SKIN
      if (up.d < 30 && !(fore.d < 30 && fore.t > 0.05)) c = bandUp && up.t > 0.76 && up.t < 0.92 ? BAND : SLEEVE
      if (!c) continue
      img.set(c, (y * W + x) * 3)
      mask[y * W + x] = 1
    }
  }
  return { img, mask }
}

function pictures(variant: ReturnType<typeof arm>, portraitBand = true): ArmCuffPictures {
  const portrait = arm(HUNG, portraitBand, null)
  return {
    width: W,
    height: H,
    portrait: portrait.img,
    variant: variant.img,
    base: portrait.mask,
    mask: variant.mask,
    rest: [SHOULDER, ELBOW, HUNG],
    raised: [SHOULDER, ELBOW, RAISED],
    radius: Array.from({ length: 24 }, () => 30),
    skin: [...SKIN],
  }
}

test('the portrait\'s band drawn at the wrist is found', () => {
  assert.equal(cuffDrawnAtWrist(pictures(arm(RAISED, false, [0.55, 0.75]))), true)
})

test('the band kept by the elbow, the forearm bare, is not', () => {
  assert.equal(cuffDrawnAtWrist(pictures(arm(RAISED, true, null))), false)
})

test('a portrait with no band says nothing', () => {
  assert.equal(cuffDrawnAtWrist(pictures(arm(RAISED, false, [0.55, 0.75]), false)), null)
})

function cut(side: RasterLayer['side'], cuffAtWrist: boolean | null) {
  return {
    layer: { side, armVariant: { gesture: 'wave', lift: 0, model: {} } } as unknown as RasterLayer,
    cuffAtWrist,
  }
}
const modelled = (c: ReturnType<typeof cut>) => c.layer.armVariant?.model !== undefined

test('one picture of an arm moving the cuff, where the others keep it, keeps no model', () => {
  const pictures = [cut('L', false), cut('L', true), cut('L', false), cut('R', true)]
  dropMovedCuffs(pictures)
  assert.deepEqual(pictures.map(modelled), [true, false, true, true])
})

test('all of an arm\'s pictures moving it alike keep theirs', () => {
  const pictures = [cut('L', true), cut('L', true), cut('L', null), cut('L', false)]
  dropMovedCuffs(pictures)
  assert.deepEqual(pictures.map(modelled), [true, true, true, true])
})
