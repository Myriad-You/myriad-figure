import type { RigPsdImportOptions } from '../../../src/rig/psdImporter'
import { isAnime25DPlayback } from '@myriad/figure-player'
import { writePsd } from 'ag-psd'
import { fixture, importPsd } from './synthetic'

// The browser's import of a PSD, through the page's own entry and its worker,
// with every file it read and made kept for the test to read back and give the
// Node import the same.

/** The portrait a synthetic PSD is cut from: one colour, or the layers drawn over it, at its size or half of it. */
export type SyntheticPortrait = 'flat' | 'layers' | 'layers-half'

type Files = Record<'psd' | 'portrait' | 'atlas' | 'analysisReference', Uint8Array>

export interface BrowserImport {
  source: string
  playbackValid: boolean
  sizes: Record<keyof Files, number>
}

let kept: Files | null = null

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no PNG')))))
}

async function portraitOf(kind: string, portrait: SyntheticPortrait): Promise<Blob> {
  const psd = fixture(kind)
  const canvas = document.createElement('canvas')
  canvas.width = 192
  canvas.height = 256
  const context = canvas.getContext('2d')!
  context.fillStyle = '#efcdbc'
  context.fillRect(0, 0, canvas.width, canvas.height)
  if (portrait === 'flat') return canvasBlob(canvas)
  // The square PSD pads the 192 × 256 portrait by 32 on each side.
  for (const layer of psd.children ?? []) {
    const { width, height, data } = layer.imageData!
    const drawn = document.createElement('canvas')
    drawn.width = width
    drawn.height = height
    drawn.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0)
    context.drawImage(drawn, (layer.left ?? 0) - 32, layer.top ?? 0)
  }
  if (portrait === 'layers') return canvasBlob(canvas)
  const half = document.createElement('canvas')
  half.width = 96
  half.height = 128
  const halfContext = half.getContext('2d')!
  halfContext.imageSmoothingQuality = 'high'
  halfContext.drawImage(canvas, 0, 0, 96, 128)
  return canvasBlob(half)
}

async function run(psd: Blob, portrait: Blob, options: Omit<RigPsdImportOptions, 'apiUrl' | 'sourceMasterAssetId'>): Promise<BrowserImport> {
  const url = URL.createObjectURL(portrait)
  try {
    const prepared = await importPsd(new File([psd], 'figure.psd'), {
      ...options,
      sourceMasterAssetId: url,
      ...(options.skeleton ? { skeleton: { ...options.skeleton, sourceMasterAssetId: url } } : {}),
    })
    kept = {
      psd: await bytesOf(psd),
      portrait: await bytesOf(portrait),
      atlas: await bytesOf(prepared.atlas),
      analysisReference: await bytesOf(prepared.analysisReference),
    }
    return {
      // With the portrait's address as the asset, which the Node import is given in its place.
      source: JSON.stringify({ ...prepared.source, sourceMasterAssetId: 'portrait' }),
      playbackValid: isAnime25DPlayback(prepared.source.anime25dPlayback),
      sizes: Object.fromEntries(Object.entries(kept).map(([name, bytes]) => [name, bytes.byteLength])) as BrowserImport['sizes'],
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function synthetic(kind: string, portrait: SyntheticPortrait): Promise<BrowserImport> {
  const psd = new Blob([writePsd(fixture(kind), { generateThumbnail: false })])
  return run(psd, await portraitOf(kind, portrait), { sourceGenerationFingerprint: 'fixture-generation' })
}

/** A PSD and portrait the test serves, with what else the import is given. */
async function served(
  psdUrl: string,
  portraitUrl: string,
  options: Omit<RigPsdImportOptions, 'apiUrl' | 'sourceMasterAssetId'>,
): Promise<BrowserImport> {
  const [psd, portrait] = await Promise.all([psdUrl, portraitUrl].map((url) => fetch(url).then((response) => response.blob())))
  return run(psd!, portrait!, options)
}

/** A stretch of one of the last import's files, as base64. */
function bytes(which: keyof Files, from: number, length: number): string {
  if (!kept) throw new Error('nothing imported yet')
  let text = ''
  for (const byte of kept[which].subarray(from, from + length)) text += String.fromCharCode(byte)
  return btoa(text)
}

declare global {
  interface Window {
    nodeCompile: { synthetic: typeof synthetic; served: typeof served; bytes: typeof bytes }
  }
}

window.nodeCompile = { synthetic, served, bytes }
