import type { RigPsdImportReply, RigPsdImportRequest } from './psdImportClient'
import { FigureError } from '../errors'
import { compileRigPsd } from './psdCompile'
import { browserRigRaster } from './rigRaster'

const reply = (data: RigPsdImportReply) => globalThis.postMessage(data)

async function read(url: string): Promise<Blob> {
  const response = await fetch(url)
  if (!response.ok) throw new FigureError('psdPreviewFailed')
  return response.blob()
}

globalThis.onmessage = async (event: MessageEvent<RigPsdImportRequest>) => {
  try {
    const { prepared, laps } = await compileRigPsd(event.data, {
      raster: browserRigRaster,
      read,
      onStage: (stage) => reply({ stage }),
    })
    reply(laps ? { prepared, timing: { laps, sentAt: performance.timeOrigin + performance.now() } } : { prepared })
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
