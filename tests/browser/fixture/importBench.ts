import type { PreparedAnime25DRigImport } from '../../../src/rig/anime25dImporter'
import type { ImportLap } from '../../../src/rig/importTiming'
import type { RigPsdImportReply, RigPsdImportRequest } from '../../../src/rig/psdImportClient'

// One real import in the production worker, timed step by step, and everything
// it returns reduced to hashes: two imports that made the same thing, bit for
// bit, give the same hashes. The test serves the files; none are kept here.

export type BenchRequest = Omit<RigPsdImportRequest, 'buffer' | 'timing'> & { psdUrl: string }

export interface BenchResult {
  /** From making the worker to its answer arriving. */
  wallMs: number
  /** The worker's own steps, in the order they ended. */
  laps: ImportLap[]
  /** The answer's way back to the page (the atlas, the reference picture and the rig, cloned). */
  returnMs: number
  hashes: {
    /** The rig as it would be uploaded, key order and every number's bits included. */
    source: string
    /** Everything else returned that is not a picture. */
    rest: string
    /** The two PNG files, byte for byte. */
    atlas: string
    analysisReference: string
  }
  sizes: { atlasBytes: number; analysisReferenceBytes: number; atlas: [number, number]; parts: number }
}

/** A value as text that two values share only when they are the same to the bit, key order included. */
function exact(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value)
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return String(value)
  if (value instanceof Blob) return `Blob(${value.size},${value.type})`
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    return `${value.constructor.name}(${bytes.join(',')})`
  }
  if (Array.isArray(value)) return `[${value.map(exact).join(',')}]`
  if (typeof value === 'object') {
    return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}:${exact(item)}`).join(',')}}`
  }
  throw new Error(`no exact text for a ${typeof value}`)
}

async function sha256(data: ArrayBuffer | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

let kept: { atlas: Uint8Array; analysisReference: Uint8Array } | null = null

async function run({ psdUrl, ...request }: BenchRequest): Promise<BenchResult> {
  const buffer = await fetch(psdUrl).then((response) => response.arrayBuffer())
  const started = performance.now()
  const { prepared, timing, arrived } = await new Promise<{
    prepared: PreparedAnime25DRigImport
    timing: { laps: ImportLap[]; sentAt: number }
    arrived: number
  }>((resolve, reject) => {
    const worker = new Worker(new URL('../../../src/rig/psdImport.worker.ts', import.meta.url), { type: 'module' })
    const fail = (reason: unknown) => {
      worker.terminate()
      reject(reason instanceof Error ? reason : new Error(JSON.stringify(reason)))
    }
    worker.onerror = (event) => fail(new Error(event.message || 'the worker failed'))
    worker.onmessage = (event: MessageEvent<RigPsdImportReply>) => {
      const arrived = performance.now()
      if ('stage' in event.data) return
      if (!('prepared' in event.data) || !event.data.timing) return fail(event.data)
      worker.terminate()
      resolve({ prepared: event.data.prepared, timing: event.data.timing, arrived })
    }
    worker.postMessage({ ...request, buffer, timing: true } satisfies RigPsdImportRequest, [buffer])
  })
  const { atlas, analysisReference, source, ...rest } = prepared
  const [atlasBytes, referenceBytes] = await Promise.all([atlas.arrayBuffer(), analysisReference.arrayBuffer()])
  kept = { atlas: new Uint8Array(atlasBytes), analysisReference: new Uint8Array(referenceBytes) }
  return {
    wallMs: arrived - started,
    laps: timing.laps,
    returnMs: performance.timeOrigin + arrived - timing.sentAt,
    hashes: {
      source: await sha256(exact(source)),
      rest: await sha256(exact(rest)),
      atlas: await sha256(atlasBytes),
      analysisReference: await sha256(referenceBytes),
    },
    sizes: {
      atlasBytes: atlasBytes.byteLength,
      analysisReferenceBytes: referenceBytes.byteLength,
      atlas: [source.atlas.width, source.atlas.height],
      parts: prepared.partCount,
    },
  }
}

/** A stretch of one of the last import's PNG files, as base64: the test decodes them itself. */
function bytes(which: 'atlas' | 'analysisReference', from: number, length: number): string {
  if (!kept) throw new Error('nothing imported yet')
  let text = ''
  for (const byte of kept[which].subarray(from, from + length)) text += String.fromCharCode(byte)
  return btoa(text)
}

declare global {
  interface Window {
    importBench: { run: typeof run; bytes: typeof bytes }
  }
}

window.importBench = { run, bytes }
