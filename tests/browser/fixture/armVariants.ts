import type { Anime25DDriver } from '../../../src/anime25drig/driver'
import type { ArmVariantSource } from '../../../src/rig/psdImportClient'
import type { PreparedRigPsdImport } from '../../../src/rig/psdImporter'
import type { DetectedSkeleton } from '../../../src/rig/skeleton'
import { ARM_VARIANT_DRIVERS } from '../../../src/anime25drig/armVariantPresenter'
import { IDENTITY_DRIVER } from '../../../src/anime25drig/driver'
import { Anime25DPlayer } from '../../../src/anime25drig/player'
import { prepareRigPsdImport } from '../../../src/rig/psdImporter'

// Real busts with their gesture arms, imported the way the site imports them
// (the worker, against the portrait) and played on the production player.
// Nothing here is synthetic: the test serves the files.

const PREVIEW = { mouth: 'preview', expression: 'preview', gaze: 'preview', headBody: 'preview' } as const
const QUIET: Partial<Anime25DDriver> = { idle: false, blink: false, phys: true, talk: false }
const FPS = 60

export interface BustRequest {
  psdUrl: string
  portraitUrl: string
  variants: ArmVariantSource[]
  /** The pose model's joints on the portrait: with them (and each variant's own), the arms are measured in 3D. */
  skeleton?: DetectedSkeleton
}

async function importBust({ psdUrl, portraitUrl, variants, skeleton }: BustRequest): Promise<PreparedRigPsdImport> {
  const blob = await fetch(psdUrl).then((response) => response.blob())
  return prepareRigPsdImport(new File([blob], 'bust.psd'), {
    sourceMasterAssetId: portraitUrl,
    apiUrl: '',
    referenceUrl: portraitUrl,
    armVariants: variants,
    ...(skeleton ? { skeleton } : {}),
  })
}

let seed = 1749
function seededRandom(): number {
  seed = (seed + 0x6D2B79F5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

interface Stage {
  player: Anime25DPlayer
  gl: WebGL2RenderingContext
  width: number
  height: number
  scale: number
  close: () => void
}

async function open(prepared: PreparedRigPsdImport, width = 384): Promise<Stage> {
  const playback = prepared.source.anime25dPlayback!
  const atlasUrl = URL.createObjectURL(prepared.atlas)
  seed = 1749
  Math.random = seededRandom
  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  const player = new Anime25DPlayer(canvas, playback)
  await player.replaceLivePackage(playback, undefined, atlasUrl)
  const scale = width / playback.pixelCanvas.width
  const height = Math.round(playback.pixelCanvas.height * scale)
  player.resize(width, height, 1)
  player.setMotionPolicy(PREVIEW)
  const gl = canvas.getContext('webgl2')!
  return {
    player,
    gl,
    width: gl.drawingBufferWidth,
    height: gl.drawingBufferHeight,
    scale,
    close: () => {
      player.dispose()
      canvas.remove()
      URL.revokeObjectURL(atlasUrl)
    },
  }
}

function readPixels(stage: Stage): Uint8Array {
  const pixels = new Uint8Array(stage.width * stage.height * 4)
  stage.gl.readPixels(0, 0, stage.width, stage.height, stage.gl.RGBA, stage.gl.UNSIGNED_BYTE, pixels)
  return pixels
}

function png(stage: Stage): string {
  return (stage.gl.canvas as HTMLCanvasElement).toDataURL('image/png').split(',')[1]!
}

/** A script of poses the figure is held in, the same every run. */
const SCRIPT: Array<[Partial<Anime25DDriver>, number]> = [
  [{}, 30],
  [{ body: -1, angleX: -0.6 }, 40],
  [{ body: 1, angleX: 0.6, torsoTurn: 0.5 }, 40],
  [{ angleY: 0.8, bodyLift: 0.6 }, 30],
  [{}, 30],
]

/** Every tenth frame the script draws. */
async function scripted(prepared: PreparedRigPsdImport): Promise<Uint8Array[]> {
  const stage = await open(prepared)
  try {
    const frames: Uint8Array[] = []
    let frame = 0
    for (const [pose, count] of SCRIPT) {
      stage.player.replaceTarget({ ...IDENTITY_DRIVER, ...QUIET, ...pose })
      for (let i = 0; i < count; i += 1) {
        stage.player.tick(1 / FPS)
        if (++frame % 10 === 0) frames.push(readPixels(stage))
      }
    }
    return frames
  } finally {
    stage.close()
  }
}

/**
 * The script played on the figure imported with gesture arms and without:
 * with none raised it must draw what it draws without them. The atlas holds
 * the arms beside the rest, so a texel's place in it is a fraction of another
 * size; that rounding is all that may differ. A side whose arms are measured in
 * 3D hangs its modelled arm in the drawn one's place, which is near the drawn
 * arm, not it: `apart` is each frame's share of pixels off by more than a
 * rounding (a channel by more than 48).
 */
async function golden(request: BustRequest): Promise<{ frames: number; worst: number; differing: number; apart: number[]; roles: string[] }> {
  const withArms = await importBust(request)
  const without = await importBust({ ...request, variants: [] })
  const [a, b] = [await scripted(withArms), await scripted(without)]
  let worst = 0
  let differing = 0
  const apart: number[] = []
  for (const [index, frame] of a.entries()) {
    const other = b[index]!
    let off = 0
    for (let i = 0; i < frame.length; i += 4) {
      let most = 0
      for (let c = 0; c < 4; c += 1) {
        const delta = Math.abs(frame[i + c]! - other[i + c]!)
        if (delta > 0) differing += 1
        most = Math.max(most, delta)
      }
      worst = Math.max(worst, most)
      if (most > 48) off += 1
    }
    apart.push(off / (frame.length / 4))
  }
  const roles = withArms.source.anime25dPlayback!.layers.map((layer) => layer.role)
  if (without.source.anime25dPlayback!.layers.some((layer) => layer.role === 'arm-variant')) roles.push('arm-variant without')
  return { frames: a.length, worst, differing, apart, roles }
}

/**
 * The box's pixels (playback pixels) as two numbers: the share drawn (alpha past half) and how light what is drawn
 * is, on average (0–1).
 */
function measure(stage: Stage, pixels: Uint8Array, box: { x: number; y: number; w: number; h: number }): { drawn: number; light: number } {
  const x0 = Math.max(0, Math.floor(box.x * stage.scale))
  const x1 = Math.min(stage.width, Math.ceil((box.x + box.w) * stage.scale))
  // readPixels rows run bottom up.
  const y0 = Math.max(0, Math.floor(box.y * stage.scale))
  const y1 = Math.min(stage.height, Math.ceil((box.y + box.h) * stage.scale))
  let drawn = 0
  let total = 0
  let light = 0
  for (let y = y0; y < y1; y += 1) {
    const row = stage.height - 1 - y
    for (let x = x0; x < x1; x += 1) {
      const i = (row * stage.width + x) * 4
      total += 1
      if (pixels[i + 3]! > 128) {
        drawn += 1
        light += (0.3 * pixels[i]! + 0.59 * pixels[i + 1]! + 0.11 * pixels[i + 2]!) / 255
      }
    }
  }
  return { drawn: total ? drawn / total : 1, light: drawn ? light / drawn : 0 }
}

/**
 * How far each frame stands outside the range of the frames either side of it (the larger of the drawn share's and
 * the lightness's): an arm moving, however fast, has each frame between its neighbours; a frame that shows or drops
 * something for itself alone (a hole, a flash of another picture) stands out of them. One per frame but the first
 * and last.
 */
function flicker(series: ReadonlyArray<{ drawn: number; light: number }>): number[] {
  const out = (a: number, b: number, c: number) => Math.max(0, b - Math.max(a, c), Math.min(a, c) - b)
  return series.slice(1, -1).map((b, i) => {
    const a = series[i]!
    const c = series[i + 2]!
    return Math.max(out(a.drawn, b.drawn, c.drawn), out(a.light, b.light, c.light))
  })
}

export interface RiseResult {
  gestures: Record<'L' | 'R', string[]>
  /**
   * The share of the portrait arm's box drawn, every frame of the rise and of
   * the fall (not of the sway between, which moves the figure out of the box).
   */
  covered: number[]
  rest: number
  held: number
  /** Each frame of the rise and of the fall, how far it stands outside its neighbours (`flicker`). */
  flicker: number[]
  /** Whether the gesture was measured as a 3D arm. */
  modelled: boolean
  shots: { name: string; image: string }[]
}

/** Raises `gesture` on `side` through its driver, holds it, swaying, and puts it down. */
async function rise(request: BustRequest, side: 'L' | 'R', gesture: string): Promise<RiseResult> {
  const prepared = await importBust(request)
  const stage = await open(prepared)
  try {
    const playback = prepared.source.anime25dPlayback!
    const arm = playback.layers.find((layer) => layer.role === 'handwear' && layer.side === side)
    const variant = playback.layers.find((layer) => layer.armVariant?.gesture === gesture && layer.side === side)
    if (!variant) throw new Error(`no ${gesture} arm on ${side}: ${playback.layers.filter((layer) => layer.armVariant).map((layer) => layer.name).join(', ')}`)
    // Where the portrait's arm was and the gesture arm ends: nothing there may go bare.
    const parts = [arm, variant].filter((layer) => layer && layer.w > 8)
    const box = {
      x: Math.min(...parts.map((layer) => layer!.x)),
      y: Math.min(...parts.map((layer) => layer!.y)),
      w: 0,
      h: 0,
    }
    box.w = Math.max(...parts.map((layer) => layer!.x + layer!.w)) - box.x
    box.h = Math.max(...parts.map((layer) => layer!.y + layer!.h)) - box.y
    const key = (ARM_VARIANT_DRIVERS[side] as Record<string, keyof Anime25DDriver>)[gesture]!
    const covered: number[] = []
    const shots: { name: string; image: string }[] = []
    let last = 0
    let series: Array<{ drawn: number; light: number }> = []
    const flickers: number[] = []
    const run = (pose: Partial<Anime25DDriver>, frames: number, shotAt: number[] = [], label = '', measured = false) => {
      stage.player.replaceTarget({ ...IDENTITY_DRIVER, ...QUIET, ...pose })
      series = []
      for (let i = 0; i < frames; i += 1) {
        stage.player.tick(1 / FPS)
        const seen = measure(stage, readPixels(stage), box)
        last = seen.drawn
        if (measured) {
          covered.push(last)
          series.push(seen)
        }
        if (shotAt.includes(i)) shots.push({ name: `${label}-${String(i).padStart(2, '0')}`, image: png(stage) })
      }
      flickers.push(...flicker(series))
    }
    run({}, 30, [29], 'rest')
    const rest = last
    run({ [key]: 1 }, 60, [2, 6, 10, 14, 18, 59], 'rise', true)
    const held = last
    run({ [key]: 1, body: 1, angleX: 0.6 }, 40, [39], 'sway')
    // Back upright before it goes down: the body settles slowly after a sway.
    run({ [key]: 1 }, 120)
    run({}, 40, [2, 6, 10, 14, 18, 39], 'lower', true)
    const modelled = Boolean(variant.armVariant?.model)
    return { gestures: stage.player.armVariantGestures(), covered, rest, held, flicker: flickers, modelled, shots }
  } finally {
    stage.close()
  }
}

declare global {
  interface Window {
    armVariantProbe: { golden: typeof golden; rise: typeof rise }
  }
}

window.armVariantProbe = { golden, rise }
