import type { Anime25DDriver } from '../../../src/anime25drig/driver'
import type { ArmVariantSource } from '../../../src/rig/psdImportClient'
import type { PreparedRigPsdImport } from '../../../src/rig/psdImporter'
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
}

async function importBust({ psdUrl, portraitUrl, variants }: BustRequest): Promise<PreparedRigPsdImport> {
  const blob = await fetch(psdUrl).then((response) => response.blob())
  return prepareRigPsdImport(new File([blob], 'bust.psd'), {
    sourceMasterAssetId: portraitUrl,
    apiUrl: '',
    referenceUrl: portraitUrl,
    armVariants: variants,
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
 * size; that rounding is all that may differ.
 */
async function golden(request: BustRequest): Promise<{ frames: number; worst: number; differing: number; roles: string[] }> {
  const withArms = await importBust(request)
  const without = await importBust({ ...request, variants: [] })
  const [a, b] = [await scripted(withArms), await scripted(without)]
  let worst = 0
  let differing = 0
  for (const [index, frame] of a.entries()) {
    const other = b[index]!
    for (let i = 0; i < frame.length; i += 1) {
      const delta = Math.abs(frame[i]! - other[i]!)
      if (delta > 0) differing += 1
      worst = Math.max(worst, delta)
    }
  }
  const roles = withArms.source.anime25dPlayback!.layers.map((layer) => layer.role)
  if (without.source.anime25dPlayback!.layers.some((layer) => layer.role === 'arm-variant')) roles.push('arm-variant without')
  return { frames: a.length, worst, differing, roles }
}

/** Share of the box's pixels drawn (alpha past half), the box in playback pixels. */
function coverage(stage: Stage, pixels: Uint8Array, box: { x: number; y: number; w: number; h: number }): number {
  const x0 = Math.max(0, Math.floor(box.x * stage.scale))
  const x1 = Math.min(stage.width, Math.ceil((box.x + box.w) * stage.scale))
  // readPixels rows run bottom up.
  const y0 = Math.max(0, Math.floor(box.y * stage.scale))
  const y1 = Math.min(stage.height, Math.ceil((box.y + box.h) * stage.scale))
  let drawn = 0
  let total = 0
  for (let y = y0; y < y1; y += 1) {
    const row = stage.height - 1 - y
    for (let x = x0; x < x1; x += 1) {
      total += 1
      if (pixels[(row * stage.width + x) * 4 + 3]! > 128) drawn += 1
    }
  }
  return total ? drawn / total : 1
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
    const run = (pose: Partial<Anime25DDriver>, frames: number, shotAt: number[] = [], label = '', measured = false) => {
      stage.player.replaceTarget({ ...IDENTITY_DRIVER, ...QUIET, ...pose })
      for (let i = 0; i < frames; i += 1) {
        stage.player.tick(1 / FPS)
        last = coverage(stage, readPixels(stage), box)
        if (measured) covered.push(last)
        if (shotAt.includes(i)) shots.push({ name: `${label}-${String(i).padStart(2, '0')}`, image: png(stage) })
      }
    }
    run({}, 30, [29], 'rest')
    const rest = last
    run({ [key]: 1 }, 60, [2, 6, 10, 14, 18, 59], 'rise', true)
    const held = last
    run({ [key]: 1, body: 1, angleX: 0.6 }, 40, [39], 'sway')
    // Back upright before it goes down: the body settles slowly after a sway.
    run({ [key]: 1 }, 120)
    run({}, 40, [2, 6, 10, 14, 18, 39], 'lower', true)
    return { gestures: stage.player.armVariantGestures(), covered, rest, held, shots }
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
