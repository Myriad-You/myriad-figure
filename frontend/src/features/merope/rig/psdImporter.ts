import type { PreparedAnime25DRigImport } from './anime25dImporter'
import { API_URL } from '../../../config'
import { currentCopy } from '../../../i18n/localeCopy'
import { anime25DImportCopy } from './anime25dImportCopy'
import { importRigPsdInWorker } from './psdImportClient'

const MAX_PSD_BYTES = 32 * 1024 * 1024

export type PreparedRigPsdImport = PreparedAnime25DRigImport

export function sourceMasterFetchUrl(source: string, pageUrl: string, apiUrl = API_URL): string {
  return new URL(source, apiUrl ? new URL(apiUrl, pageUrl).href : pageUrl).href
}

export async function prepareRigPsdImport(
  file: File,
  sourceMasterAssetId: string,
  onStage?: (stage: 'validated' | 'packing') => void,
  sourceGenerationFingerprint?: string,
  signal?: AbortSignal,
): Promise<PreparedRigPsdImport> {
  signal?.throwIfAborted()
  if (!sourceMasterAssetId) throw new Error(currentCopy().merope.psdNeedAsset)
  if (file.size <= 0 || file.size > MAX_PSD_BYTES) {
    throw new Error(currentCopy().merope.psdTooLarge)
  }
  const buffer = await file.arrayBuffer()
  signal?.throwIfAborted()
  return importRigPsdInWorker(
    {
      buffer,
      sourceMasterAssetId,
      // Resolve against the page, not the worker chunk URL.
      sourceMasterUrl: sourceMasterFetchUrl(sourceMasterAssetId, document.baseURI),
      sourceGenerationFingerprint,
      copy: anime25DImportCopy(),
    },
    signal,
    onStage,
  )
}
