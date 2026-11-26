// Building a rig without a browser: the PSD import run in Node, on its own raster.
// Nothing here is reachable from the other entries; it imports Node's modules.

import type { CharacterAssetProfile } from '@myriad/figure-player/internals'
import type { PreparedAnime25DRigImport } from '../anime25dImporter'
import type { AuthoredExpressionKind } from '../authoredExpression'
import type { ImportLap } from '../importTiming'
import type { ArmVariantSource, RigPsdImportStage } from '../psdImportClient'
import type { DetectedSkeleton } from '../skeleton'
import type { DocumentTurnKeyforms } from '../turnKeyformImport'
import { FigureError } from '../../errors'
import { addImportEnhancement } from '../importEnhancement'
import { compileRigPsd } from '../psdCompile'
import { MAX_PSD_BYTES } from '../psdDecode'
import { isDocumentTurnKeyforms } from '../turnKeyformImport'
import { nodeRigRaster } from './raster'

export type { AuthoredExpressionKind, DocumentTurnKeyforms, ImportLap, PreparedAnime25DRigImport, RigPsdImportStage }

/** A picture file: PNG or JPEG. */
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
}

export interface NodeRigPsdImport {
  /** What the browser import gives the page: the rig, the atlas and the reference picture (PNG files), the findings. */
  prepared: PreparedAnime25DRigImport
  laps?: ImportLap[]
}

/**
 * A decomposition PSD made into a rig, as the page's import makes it, with no
 * browser: no Worker, canvas or DOM. Errors are `FigureError`s with the codes
 * the page's import throws.
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
  }: NodeRigPsdImportOptions,
): Promise<NodeRigPsdImport> {
  if (!sourceMasterAssetId) throw new FigureError('psdNeedAsset')
  if (psd.byteLength <= 0 || psd.byteLength > MAX_PSD_BYTES) throw new FigureError('psdTooLarge')
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
  })
  addImportEnhancement(prepared, isDocumentTurnKeyforms(turnKeyforms) ? turnKeyforms : undefined, expressions.length > 0)
  return laps ? { prepared, laps } : { prepared }
}
