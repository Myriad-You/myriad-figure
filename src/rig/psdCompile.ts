import type { PreparedAnime25DRigImport } from './anime25dImporter'
import type { Anime25DSourceReference } from './anime25dImportTypes'
import type { ArmVariantReference } from './armVariants'
import type { AuthoredExpressionReference } from './authoredExpression'
import type { ImportLap } from './importTiming'
import type { HoldZipChannel } from './psdDecode'
import type { RigPsdImportRequest, RigPsdImportStage } from './psdImportClient'
import type { RigRaster } from './rigRaster'
import { FigureError } from '../errors'
import { prepareAnime25DRigPsd } from './anime25dImporter'
import { ImportTimer } from './importTiming'
import { decodeRigPsd } from './psdDecode'
import { psdPlacement } from './psdPlacement'
import { alignSkeletonToPsd } from './skeleton'

/** Where an import gets what it needs besides the PSD, and how it reports. */
export interface RigPsdCompileEnvironment<Picture extends { width: number; height: number }> {
  raster: RigRaster<Picture>
  /** The file at an address the request names (the portrait, a redraw, a gesture arm); rejects when it is not there. */
  read: (url: string) => Promise<Blob>
  onStage?: (stage: RigPsdImportStage) => void
  /** Checked between the steps; the import stops with its reason. */
  signal?: AbortSignal
  /** Holds each zip-compressed PSD channel before it is inflated (see `decodeRigPsd`). */
  holdZipChannel?: HoldZipChannel
}

export interface RigPsdCompiled {
  prepared: PreparedAnime25DRigImport
  /** Where the time went, when the request asked (`timing`). */
  laps?: ImportLap[]
}

/**
 * A PSD made into a rig, the portrait and the redraws read and fitted onto it:
 * the import the browser's worker runs, with the raster and the reading given.
 */
export async function compileRigPsd<Picture extends { width: number; height: number }>(
  request: RigPsdImportRequest,
  { raster, read, onStage, signal, holdZipChannel }: RigPsdCompileEnvironment<Picture>,
): Promise<RigPsdCompiled> {
  const {
    buffer,
    sourceMasterAssetId,
    sourceMasterUrl,
    sourceGenerationFingerprint,
    expressions,
    armVariants,
    profile,
    skeleton,
    timing,
  } = request
  signal?.throwIfAborted()
  const timer = timing ? new ImportTimer() : undefined
  const psd = (() => {
    try {
      return decodeRigPsd(buffer, timer, holdZipChannel)
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      throw new FigureError(code === 'psdTooLarge' || code === 'psdLayerCountInvalid' ? code : 'psdSpecInvalid')
    }
  })()
  const fit = async (url: string, frame: ImageSize | null) => {
    const picture = await raster.decode(await read(url))
    try {
      const size = { width: picture.width, height: picture.height }
      const placement = psdPlacement(frame ?? size, psd.width, psd.height)
      return { size, reference: raster.place(picture, psd.width, psd.height, placement) }
    } finally {
      raster.release(picture)
    }
  }
  const master = await (async () => {
    const { size, reference } = await fit(sourceMasterUrl, null)
    if (!reference) throw new FigureError('psdPreviewFailed')
    return { size, reference }
  })()
  signal?.throwIfAborted()
  timer?.lap('reference.portrait')
  const expressionReferences = await alignExpressions(expressions ?? [], master.size, fit)
  timer?.lap('reference.expressions')
  const armVariantReferences = await alignArmVariants(armVariants ?? [], psd.width, psd.height, master.size, fit)
  signal?.throwIfAborted()
  timer?.lap('reference.armVariants')
  const prepared = await prepareAnime25DRigPsd(psd, {
    sourceMasterAssetId,
    onStage: (stage) => {
      signal?.throwIfAborted()
      onStage?.(stage)
    },
    timer,
    sourceGenerationFingerprint,
    sourceReference: master.reference,
    expressionReferences,
    armVariantReferences,
    profile,
    skeleton: skeleton && skeleton.sourceMasterAssetId === sourceMasterAssetId
      ? (alignSkeletonToPsd(skeleton, psd.width, psd.height) ?? undefined)
      : undefined,
    raster,
  })
  signal?.throwIfAborted()
  return timer ? { prepared, laps: timer.laps() } : { prepared }
}

interface ImageSize {
  width: number
  height: number
}

/** A picture read and drawn onto the PSD, placed as a portrait of `frame` size would be (its own when null). */
type Fit = (url: string, frame: ImageSize | null) => Promise<{ size: ImageSize; reference: Anime25DSourceReference | null }>

/**
 * Expression redraws come back at the model's output size, a few pixels off the
 * portrait's; each is stretched onto the portrait's frame before placement.
 */
async function alignExpressions(
  expressions: NonNullable<RigPsdImportRequest['expressions']>,
  master: ImageSize,
  fit: Fit,
): Promise<AuthoredExpressionReference[]> {
  const aligned = await Promise.all(
    expressions.map(async ({ kind, url }) => {
      try {
        const { reference } = await fit(url, master)
        return reference ? { kind, ...reference } : null
      } catch {
        // An unreadable redraw only loses its authored parts.
        return null
      }
    }),
  )
  return aligned.filter((reference) => reference !== null)
}

/** Gesture arms, placed like the expression redraws; their hand points and joints go with them. */
async function alignArmVariants(
  variants: NonNullable<RigPsdImportRequest['armVariants']>,
  width: number,
  height: number,
  master: ImageSize,
  fit: Fit,
): Promise<ArmVariantReference[]> {
  const placement = psdPlacement(master, width, height)
  const aligned = await Promise.all(
    variants.map(async ({ gesture, side, url, hand, keypoints }) => {
      try {
        const { reference } = await fit(url, master)
        return reference
          ? {
              gesture,
              side,
              ...reference,
              placement: { x: placement.x, y: placement.y, width: placement.width, height: placement.height },
              ...(hand?.length ? { hand: hand.map(([x, y]) => placement.map(x, y)) } : {}),
              ...(keypoints?.length
                ? { keypoints: keypoints.map(([x, y, score]) => [...placement.map(x, y), score] as const) }
                : {}),
            }
          : null
      } catch {
        // An unreadable variant only loses that gesture.
        return null
      }
    }),
  )
  return aligned.filter((reference) => reference !== null)
}
