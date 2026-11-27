import type { MeropeRigManifest } from '@myriad-you/figure-player/contract'
import { resetCachedAtlasImagesForTests } from '@myriad-you/figure-player/internals'
import { mulberry32 } from '../rig/rigFuzz.fixture'
import { Anime25DPlayer } from './player'

/** What a run of the player in Node showed. */
export interface PlayerRun {
  /** The first number it gave the GPU that is not one. */
  nonFinite: string | null
  /** Of every float it gave the GPU (vertices and uniforms), in order: the same for two runs that drew the same. */
  drawn: number
}

/**
 * Builds the real player on a manifest, loads its package, plays it through its ranges and (`swap`) swaps it in again,
 * with the GPU, the DOM and chance stood in for: the same manifest draws the same, every time. Everything the manifest
 * reaches on the CPU runs as it does on a page.
 */
export async function playManifest(manifest: MeropeRigManifest, frames = 4, swap = true): Promise<PlayerRun> {
  const run: PlayerRun = { nonFinite: null, drawn: 0x811C9DC5 }
  const restore = installFakeDom()
  try {
    const player = new Anime25DPlayer(fakeCanvas(run) as unknown as HTMLCanvasElement, manifest.anime25dPlayback!, manifest)
    try {
      await player.loadAtlas(manifest.textures[0].url)
      player.resize(300, 400, 1)
      play(player, frames)
      if (swap) {
        await player.replaceLivePackage(manifest.anime25dPlayback!, manifest, manifest.textures[0].url)
        play(player, frames)
      }
      player.inspect()
      player.debugSnapshot()
      player.hitTestTouch(150, 120)
    } finally {
      player.dispose()
    }
  } finally {
    restore()
  }
  return run
}

function play(player: Anime25DPlayer, frames: number): void {
  for (let frame = 0; frame < frames; frame += 1) {
    const at = frames > 1 ? (frame / (frames - 1)) * 2 - 1 : 1
    player.setTarget({
      headYaw: at, headPitch: -at, headRoll: at, bodyLean: at, jaw: Math.abs(at), lidL: 1 - Math.abs(at),
      handWaveL: frame > 1 ? 1 : 0, eyeCry: frame === 2 ? 1 : 0, thinking: frame === 3,
    })
    player.tick(0.25)
  }
}

const GL_SIZES = new Set(['MAX_TEXTURE_SIZE', 'MAX_VERTEX_ATTRIBS', 'MAX_TEXTURE_IMAGE_UNITS', 'MAX_SAMPLES'])

function fakeCanvas(run: PlayerRun) {
  const canvas = new (globalThis.HTMLCanvasElement as unknown as new () => Record<string, unknown>)()
  const gl = fakeGl(run, canvas)
  canvas.getContext = (kind: string) => (kind === 'webgl2' ? gl : null)
  return canvas
}

function fakeGl(run: PlayerRun, canvas: unknown): unknown {
  const constants = new Map<string, number>()
  const methods = new Map<string, (...args: unknown[]) => unknown>()
  const bits = new DataView(new ArrayBuffer(4))
  const note = (name: string, values: Iterable<unknown>) => {
    let index = 0
    for (const value of values) {
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) run.nonFinite ??= `${name}[${index}] = ${value}`
        bits.setFloat32(0, value)
        run.drawn = Math.imul(run.drawn ^ bits.getUint32(0), 0x01000193) >>> 0
      }
      index += 1
    }
  }
  const call = (name: string) => (...args: unknown[]): unknown => {
    if (name === 'bufferData' || name === 'bufferSubData') {
      const data = args.find((arg) => arg instanceof Float32Array)
      if (data) note(name, data as Float32Array)
    } else if (name.startsWith('uniform') || name === 'viewport' || name === 'scissor') {
      for (const arg of args) {
        if (arg instanceof Float32Array || Array.isArray(arg)) note(name, arg as number[])
        else note(name, [arg])
      }
    }
    if (name === 'getShaderParameter' || name === 'getProgramParameter') return true
    if (name === 'checkFramebufferStatus') return constantOf('FRAMEBUFFER_COMPLETE')
    if (name === 'getParameter') return GL_SIZES.has([...constants].find(([, v]) => v === args[0])?.[0] ?? '') ? 4096 : null
    if (name === 'getAttribLocation') return 0
    if (name === 'getError') return 0
    if (name === 'getUniformLocation' || name.startsWith('create')) return {}
    if (name === 'isContextLost') return false
    return null
  }
  const constantOf = (name: string) => {
    if (!constants.has(name)) constants.set(name, constants.size + 1)
    return constants.get(name)!
  }
  return new Proxy({ canvas, drawingBufferWidth: 300, drawingBufferHeight: 400 } as Record<string, unknown>, {
    get(target, name) {
      if (typeof name !== 'string' || name in target) return target[name as string]
      if (/^[A-Z][A-Z0-9_]*$/.test(name)) return constantOf(name)
      if (!methods.has(name)) methods.set(name, call(name))
      return methods.get(name)
    },
  })
}

/** A canvas past a browser's own size limits fails there; here it says so. */
const MAX_CANVAS_PIXELS = 16_384 * 16_384 / 4

/** The atlas as it decodes, whatever size the manifest says: small, so a run is quick. */
const ATLAS_EDGE = 256

function installFakeDom(): () => void {
  const previous = new Map<string, unknown>()
  const set = (name: string, value: unknown) => {
    previous.set(name, (globalThis as Record<string, unknown>)[name])
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  }
  class Canvas {
    width = 300
    height = 150
    style: Record<string, string> = {}
    isConnected = true
    getContext: unknown = () => context2d(this)
    getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 400 } }
  }
  class FakeImage {
    width = ATLAS_EDGE
    height = ATLAS_EDGE
    naturalWidth = ATLAS_EDGE
    naturalHeight = ATLAS_EDGE
    complete = false
    crossOrigin = ''
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    get src() { return '' }
    set src(url: string) {
      if (!url) return
      this.complete = true
      queueMicrotask(() => this.onload?.())
    }
  }
  const { random } = Math
  Math.random = mulberry32(1)
  set('HTMLCanvasElement', Canvas)
  set('Image', FakeImage)
  set('document', { createElement: () => new Canvas() })
  resetCachedAtlasImagesForTests()
  return () => {
    Math.random = random
    resetCachedAtlasImagesForTests()
    for (const [name, value] of previous) {
      if (value === undefined) delete (globalThis as Record<string, unknown>)[name]
      else Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
    }
  }
}

/** Every crop reads as an opaque ellipse on clear ground: a drawing, to what looks for one's outline. */
function context2d(canvas: { width: number; height: number }): unknown {
  const target: Record<string, unknown> = {
    canvas,
    getImageData(_x: number, _y: number, w: number, h: number) {
      if (!(w >= 1 && h >= 1) || w * h > MAX_CANVAS_PIXELS) throw new RangeError(`canvas ${w}×${h}`)
      const data = new Uint8ClampedArray(w * h * 4)
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const dx = (x + 0.5) / w * 2 - 1
          const dy = (y + 0.5) / h * 2 - 1
          if (dx * dx + dy * dy > 1) continue
          const i = (y * w + x) * 4
          data[i] = 200
          data[i + 1] = 160
          data[i + 2] = 140
          data[i + 3] = 255
        }
      }
      return { data, width: w, height: h }
    },
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    measureText: () => ({ width: 10 }),
  }
  return new Proxy(target, {
    get: (held, name) => (name in held ? held[name as string] : () => {}),
    set: (held, name, value) => {
      held[name as string] = value
      return true
    },
  })
}
