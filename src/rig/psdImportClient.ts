import type { FigureErrorCode, FigureErrorParams } from '../errors'
import type { PreparedAnime25DRigImport } from './anime25dImporter'
import type { ArmVariantGesture } from './armVariants'
import type { AuthoredExpressionKind } from './authoredExpression'
import type { CharacterAssetProfile } from './contract'
import type { DetectedSkeleton } from './skeleton'
import { FigureError, isFigureErrorCode } from '../errors'

export interface RigPsdImportRequest {
  buffer: ArrayBuffer
  sourceMasterAssetId: string
  sourceMasterUrl: string
  sourceGenerationFingerprint?: string
  /** Image-model redraws of the portrait, cut into authored expression parts. */
  expressions?: ReadonlyArray<{ kind: AuthoredExpressionKind; url: string }>
  /** Gesture arms drawn on the portrait (armVariants). */
  armVariants?: ReadonlyArray<ArmVariantSource>
  /** The bust by default. */
  profile?: CharacterAssetProfile
  /** Joints found on the portrait, to bind the rig to. */
  skeleton?: DetectedSkeleton
}

/**
 * A gesture arm the image model drew on the portrait: `side` is the arm it
 * changed on the picture, `hand` points on that hand and `keypoints` the pose
 * model's joints on the whole picture (COCO-WholeBody `[x, y, score]`), in
 * the portrait's pixels.
 */
export interface ArmVariantSource {
  gesture: ArmVariantGesture
  side: 'left' | 'right'
  url: string
  hand?: ReadonlyArray<readonly [number, number]>
  keypoints?: ReadonlyArray<readonly [number, number, number]>
}

export type RigPsdImportStage = 'validated' | 'packing'
export type RigPsdImportReply =
  | { stage: RigPsdImportStage }
  | { prepared: PreparedAnime25DRigImport }
  | { error: { code: FigureErrorCode; params: FigureErrorParams } }
  | { failure: string }

/** A hung import gives up after this long for a PSD of IMPORT_TIMEOUT_PIXELS or less. */
const IMPORT_TIMEOUT_MS = 60_000
/** Larger PSDs (a stitched full figure, 4096 tall and as wide as its gown) get proportionally longer. */
const IMPORT_TIMEOUT_PIXELS = 2048 * 2048

/** How long the import of a PSD may take, from the size its header gives. */
export function importTimeoutMs(buffer: ArrayBuffer): number {
  if (buffer.byteLength < 26) return IMPORT_TIMEOUT_MS
  const header = new DataView(buffer)
  const pixels = header.getUint32(14) * header.getUint32(18)
  return IMPORT_TIMEOUT_MS * Math.max(1, pixels / IMPORT_TIMEOUT_PIXELS)
}

export function importRigPsdInWorker(
  request: RigPsdImportRequest,
  signal?: AbortSignal,
  onStage?: (stage: RigPsdImportStage) => void,
  createWorker: () => Worker = () =>
    new Worker(new URL('./psdImport.worker.ts', import.meta.url), {
      type: 'module',
    }),
): Promise<PreparedAnime25DRigImport> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const worker = createWorker()
    let settled = false
    const finish = (error?: unknown, prepared?: PreparedAnime25DRigImport) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      worker.onmessage = null
      worker.onerror = null
      worker.onmessageerror = null
      worker.terminate()
      if (prepared) resolve(prepared)
      else reject(error)
    }
    const abort = () =>
      finish(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
    const timeout = setTimeout(
      () => finish(new FigureError('psdSpecInvalid')),
      importTimeoutMs(request.buffer),
    )
    worker.onmessage = (event: MessageEvent<RigPsdImportReply>) => {
      if (settled) return
      if (signal?.aborted) {
        abort()
      } else if (Object.hasOwn(event.data, 'stage')) {
        try {
          onStage?.(
            (event.data as { stage: RigPsdImportStage }).stage,
          )
        } catch (error) {
          finish(error)
        }
      } else if (Object.hasOwn(event.data, 'prepared')) {
        finish(
          undefined,
          (event.data as { prepared: PreparedAnime25DRigImport }).prepared,
        )
      } else if (Object.hasOwn(event.data, 'error')) {
        const { code, params } = (event.data as { error: { code: FigureErrorCode; params: FigureErrorParams } }).error
        finish(new FigureError(isFigureErrorCode(code) ? code : 'psdSpecInvalid', params))
      } else {
        finish(new Error((event.data as { failure: string }).failure))
      }
    }
    worker.onerror = () => finish(new FigureError('psdSpecInvalid'))
    worker.onmessageerror = () => finish(new FigureError('psdSpecInvalid'))
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) {
      abort()
      return
    }
    try {
      worker.postMessage(request, [request.buffer])
    } catch (error) {
      finish(error)
    }
  })
}
