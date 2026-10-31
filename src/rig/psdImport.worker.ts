import type { Anime25DSourceReference } from './anime25dImportTypes'
import type { AuthoredExpressionReference } from './authoredExpression'
import type { RigPsdImportReply, RigPsdImportRequest } from './psdImportClient'
import { FigureError } from '../errors'
import { prepareAnime25DRigPsd } from './anime25dImporter'
import { decodeRigPsd } from './psdDecode'
import { psdPlacement } from './psdPlacement'
import { alignSkeletonToPsd } from './skeleton'

const reply = (data: RigPsdImportReply) => globalThis.postMessage(data)

globalThis.onmessage = async (event: MessageEvent<RigPsdImportRequest>) => {
  const {
    buffer,
    sourceMasterAssetId,
    sourceMasterUrl,
    sourceGenerationFingerprint,
    expressions,
    profile,
    skeleton,
  } = event.data
  try {
    const psd = (() => {
      try {
        return decodeRigPsd(buffer)
      } catch (error) {
        const code = error instanceof Error ? error.message : ''
        throw new FigureError(code === 'psdTooLarge' || code === 'psdLayerCountInvalid' ? code : 'psdSpecInvalid')
      }
    })()
    const master = await alignSourceMaster(sourceMasterUrl, psd.width, psd.height)
    const expressionReferences = master
      ? await alignExpressions(expressions ?? [], psd.width, psd.height, master.size)
      : []
    const prepared = await prepareAnime25DRigPsd(psd, {
      sourceMasterAssetId,
      onStage: (stage) => reply({ stage }),
      sourceGenerationFingerprint,
      sourceReference: master?.reference,
      expressionReferences,
      profile,
      skeleton: skeleton && skeleton.sourceMasterAssetId === sourceMasterAssetId
        ? (alignSkeletonToPsd(skeleton, psd.width, psd.height) ?? undefined)
        : undefined,
    })
    reply({ prepared })
  } catch (error) {
    // Errors cross the worker boundary as data; the page rebuilds a FigureError from the code.
    reply(
      error instanceof FigureError
        ? { error: { code: error.code, params: error.params } }
        : error instanceof Error
          ? { failure: error.message }
          : { error: { code: 'psdSpecInvalid', params: {} } },
    )
  }
}

interface ImageSize {
  width: number
  height: number
}

async function alignSourceMaster(
  url: string,
  width: number,
  height: number,
): Promise<{ reference: Anime25DSourceReference; size: ImageSize } | undefined> {
  const response = await fetch(url)
  if (!response.ok) throw new FigureError('psdPreviewFailed')
  const bitmap = await createImageBitmap(await response.blob())
  try {
    const size = { width: bitmap.width, height: bitmap.height }
    const reference = drawIntoPsd(bitmap, size, width, height)
    if (!reference) throw new FigureError('psdPreviewFailed')
    return { reference, size }
  } finally {
    bitmap.close()
  }
}

/**
 * Expression redraws come back at the model's output size, a few pixels off the
 * portrait's; each is stretched onto the portrait's frame before placement.
 */
async function alignExpressions(
  expressions: NonNullable<RigPsdImportRequest['expressions']>,
  width: number,
  height: number,
  master: ImageSize,
): Promise<AuthoredExpressionReference[]> {
  const aligned = await Promise.all(
    expressions.map(async ({ kind, url }) => {
      try {
        const response = await fetch(url)
        if (!response.ok) return null
        const bitmap = await createImageBitmap(await response.blob())
        try {
          const reference = drawIntoPsd(bitmap, master, width, height)
          return reference ? { kind, ...reference } : null
        } finally {
          bitmap.close()
        }
      } catch {
        // An unreadable redraw only loses its authored parts.
        return null
      }
    }),
  )
  return aligned.filter((reference) => reference !== null)
}

function drawIntoPsd(
  bitmap: ImageBitmap,
  frame: ImageSize,
  width: number,
  height: number,
): Anime25DSourceReference | null {
  const placement = psdPlacement(frame, width, height)
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')
  if (!context) return null
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(
    bitmap,
    placement.x,
    placement.y,
    placement.width,
    placement.height,
  )
  return {
    width,
    height,
    data: context.getImageData(0, 0, width, height).data,
  }
}
