// Building a rig without a browser: the PSD import run in Node, on its own raster.
// Nothing here is reachable from the other entries; it imports Node's modules.
//
// The import is synchronous work on the thread that runs it: seconds for a
// bust, up to some 20 for a 4096-pixel figure, and 0.5–1.5 GB at its height.
// A server runs it in a worker thread or a child process of its own, with a
// memory limit and a deadline after which it is killed; `signal` only stops it
// between steps.

import type { CharacterAssetProfile } from '@myriad/figure-player/internals'
import type { PreparedAnime25DRigImport } from '../anime25dImporter'
import type { AuthoredExpressionKind } from '../authoredExpression'
import type { ImportLap } from '../importTiming'
import type { ArmVariantSource, RigPsdImportStage } from '../psdImportClient'
import type { DetectedSkeleton } from '../skeleton'
import type { DocumentTurnKeyforms } from '../turnKeyformImport'
import { FigureError } from '../../errors'
import { ARM_VARIANT_GESTURES } from '../armVariants'
import { AUTHORED_EXPRESSION_KINDS } from '../authoredExpression'
import { addImportEnhancement } from '../importEnhancement'
import { compileRigPsd } from '../psdCompile'
import { MAX_PSD_BYTES } from '../psdDecode'
import { isDocumentTurnKeyforms } from '../turnKeyformImport'
import { MAX_PICTURE_BYTES, MAX_PICTURE_EDGE, MAX_PICTURE_PIXELS, readPictureHeader } from './picture'
import { nodeRigRaster } from './raster'

export type { AuthoredExpressionKind, DocumentTurnKeyforms, ImportLap, PreparedAnime25DRigImport, RigPsdImportStage }
export { MAX_PICTURE_BYTES, MAX_PICTURE_EDGE, MAX_PICTURE_PIXELS }

/** As many redraws as there are kinds, and a gesture arm for each gesture on each side. */
export const MAX_EXPRESSION_PICTURES = AUTHORED_EXPRESSION_KINDS.length
export const MAX_ARM_VARIANT_PICTURES = ARM_VARIANT_GESTURES.length * 2

/**
 * A picture file: PNG (8-bit or 16-bit; an interlaced one of 8 bits or more)
 * or JPEG (8-bit baseline or progressive, grey or colour), at most
 * MAX_PICTURE_BYTES, MAX_PICTURE_EDGE on a side and MAX_PICTURE_PIXELS.
 */
export type RigPicture = Uint8Array

export interface NodeRigPsdImportOptions {
  sourceMasterAssetId: string
  /** The portrait the decomposition was cut from: the master, or the enlarged figure's picture. */
  sourceMaster: RigPicture
  sourceGenerationFingerprint?: string
  /** Image-model redraws of the portrait, cut into authored expression parts. */
  expressions?: ReadonlyArray<{ kind: AuthoredExpressionKind; picture: RigPicture }>
  /** Gesture arms drawn on the portrait; only a bust takes them. */
  armVariants?: ReadonlyArray<Omit<ArmVariantSource, 'url'> & { picture: RigPicture }>
  /** The bust by default. */
  profile?: CharacterAssetProfile
  /** Joints found on the portrait, to bind the rig to. */
  skeleton?: DetectedSkeleton
  /** Turn keys measured on this decomposition, as its job gives them; left out when they are not keys. */
  turnKeyforms?: DocumentTurnKeyforms
  onStage?: (stage: RigPsdImportStage) => void
  /** Measures where the time goes; the import itself is the same. */
  timing?: boolean
  /** Stops the import between its steps, with the signal's reason. */
  signal?: AbortSignal
}

export interface NodeRigPsdImport {
  /** What the browser import gives the page: the rig, the atlas and the reference picture (PNG files), the findings. */
  prepared: PreparedAnime25DRigImport
  laps?: ImportLap[]
}

/**
 * A decomposition PSD made into a rig, as the page's import makes it, with no
 * browser: no Worker, canvas or DOM. Errors are `FigureError`s with the codes
 * the page's import throws. Every picture is held to the limits before any is
 * decoded: one that is too large, of a kind this cannot read, or one too many
 * is a `psdPreviewFailed` whose params say which (`picture`) and why
 * (`reason`: tooLarge, unsupported, unreadable, tooMany). A redraw or a
 * gesture arm that passes that but cannot be decoded only loses its parts, as
 * in the browser.
 */
export async function compileRigPsdInNode(
  psd: Uint8Array | ArrayBuffer,
  {
    sourceMasterAssetId,
    sourceMaster,
    sourceGenerationFingerprint,
    expressions = [],
    armVariants = [],
    profile = 'bust',
    skeleton,
    turnKeyforms,
    onStage,
    timing,
    signal,
  }: NodeRigPsdImportOptions,
): Promise<NodeRigPsdImport> {
  signal?.throwIfAborted()
  if (!sourceMasterAssetId) throw new FigureError('psdNeedAsset')
  if (psd.byteLength <= 0 || psd.byteLength > MAX_PSD_BYTES) throw new FigureError('psdTooLarge')
  if (expressions.length > MAX_EXPRESSION_PICTURES) throw new FigureError('psdPreviewFailed', { picture: 'expressions', reason: 'tooMany' })
  if (armVariants.length > MAX_ARM_VARIANT_PICTURES) throw new FigureError('psdPreviewFailed', { picture: 'armVariants', reason: 'tooMany' })
  const held = (picture: RigPicture, name: string) => {
    try {
      readPictureHeader(picture)
    } catch (error) {
      if (error instanceof FigureError) throw new FigureError(error.code, { ...error.params, picture: name })
      throw error
    }
  }
  held(sourceMaster, 'sourceMaster')
  expressions.forEach(({ picture }, index) => held(picture, `expressions.${index}`))
  armVariants.forEach(({ picture }, index) => held(picture, `armVariants.${index}`))
  // Its own copy, as the worker gets one.
  const buffer = psd instanceof ArrayBuffer ? psd.slice(0) : new Uint8Array(psd).buffer
  const pictures: RigPicture[] = []
  const named = (picture: RigPicture) => `picture:${pictures.push(picture) - 1}`
  const { prepared, laps } = await compileRigPsd({
    buffer,
    sourceMasterAssetId,
    sourceMasterUrl: named(sourceMaster),
    sourceGenerationFingerprint,
    expressions: expressions.map(({ kind, picture }) => ({ kind, url: named(picture) })),
    armVariants: armVariants.map(({ picture, ...variant }) => ({ ...variant, url: named(picture) })),
    profile,
    ...(skeleton ? { skeleton } : {}),
    timing,
  }, {
    raster: nodeRigRaster,
    read: async (url) => {
      const picture = pictures[Number(url.slice('picture:'.length))]
      if (!picture) throw new FigureError('psdPreviewFailed')
      return new Blob([new Uint8Array(picture)])
    },
    onStage,
    signal,
  })
  addImportEnhancement(prepared, isDocumentTurnKeyforms(turnKeyforms) ? turnKeyforms : undefined, expressions.length > 0)
  return laps ? { prepared, laps } : { prepared }
}
