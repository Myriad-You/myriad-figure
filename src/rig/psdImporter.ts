import type { AuthoredExpressionKind } from '@myriad-you/figure-player/contract'
import type { CharacterAssetProfile } from '@myriad-you/figure-player/internals'
import type { PreparedAnime25DRigImport } from './anime25dImporter'
import type { ArmVariantSource } from './psdImportClient'
import type { DetectedSkeleton } from './skeleton'
import { FigureError } from '../errors'
import { addImportEnhancement } from './importEnhancement'
import { importRigPsdInWorker } from './psdImportClient'
import { turnKeyformsFor } from './turnKeyformImport'

/** The worker's psdDecode MAX_PSD_BYTES, kept here so the page needs no PSD reader. */
const MAX_PSD_BYTES = 96 * 1024 * 1024

export type PreparedRigPsdImport = PreparedAnime25DRigImport

export function sourceMasterFetchUrl(source: string, pageUrl: string, apiUrl: string): string {
  return new URL(source, apiUrl ? new URL(apiUrl, pageUrl).href : pageUrl).href
}

export interface RigPsdImportOptions {
  sourceMasterAssetId: string
  /** Where the API serving the master portrait lives; empty is the page's own origin. */
  apiUrl: string
  onStage?: (stage: 'validated' | 'packing') => void
  sourceGenerationFingerprint?: string
  signal?: AbortSignal
  expressions?: ReadonlyArray<{ kind: AuthoredExpressionKind; url: string }>
  /** Gesture arms drawn on the portrait; only a bust takes them. */
  armVariants?: ReadonlyArray<ArmVariantSource>
  /** The bust by default. */
  profile?: CharacterAssetProfile
  skeleton?: DetectedSkeleton
  /** The picture the decomposition was cut from when it is not the master itself (an enlarged figure's). */
  referenceUrl?: string
}

export async function prepareRigPsdImport(
  file: File,
  {
    sourceMasterAssetId,
    apiUrl,
    onStage,
    sourceGenerationFingerprint,
    signal,
    expressions = [],
    armVariants = [],
    profile = 'bust',
    skeleton,
    referenceUrl,
  }: RigPsdImportOptions,
): Promise<PreparedRigPsdImport> {
  signal?.throwIfAborted()
  if (!sourceMasterAssetId) throw new FigureError('psdNeedAsset')
  if (file.size <= 0 || file.size > MAX_PSD_BYTES) {
    throw new FigureError('psdTooLarge')
  }
  const buffer = await file.arrayBuffer()
  signal?.throwIfAborted()
  const prepared = await importRigPsdInWorker(
    {
      buffer,
      sourceMasterAssetId,
      // Resolve against the page, not the worker chunk URL.
      sourceMasterUrl: referenceUrl ?? sourceMasterFetchUrl(sourceMasterAssetId, document.baseURI, apiUrl),
      sourceGenerationFingerprint,
      expressions: expressions.map(({ kind, url }) => ({
        kind,
        url: sourceMasterFetchUrl(url, document.baseURI, apiUrl),
      })),
      armVariants: armVariants.map((variant) => ({
        ...variant,
        url: sourceMasterFetchUrl(variant.url, document.baseURI, apiUrl),
      })),
      profile,
      ...(skeleton ? { skeleton } : {}),
    },
    signal,
    onStage,
  )
  addImportEnhancement(prepared, turnKeyformsFor(file), expressions.length > 0)
  return prepared
}
