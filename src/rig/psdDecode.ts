import type { Layer, Psd } from 'ag-psd'
import type { ImportTimer } from './importTiming'
import { decodeLayerPixels, initializeCanvas, readPsd } from 'ag-psd'

export const MAX_PSD_BYTES = 96 * 1024 * 1024
/** A standing figure decomposed in tiles is stitched at up to 4096 px tall. */
export const MAX_EDGE = 4096
const MAX_LAYERS = 64
const MAX_PIXELS = 128 * 1024 * 1024

export function validateRigPsdHeader(buffer: ArrayBuffer): void {
  if (buffer.byteLength < 26 || buffer.byteLength > MAX_PSD_BYTES)
    throw new Error('psdSpecInvalid')
  const view = new DataView(buffer)
  const height = view.getUint32(14)
  const width = view.getUint32(18)
  if (
    view.getUint32(0) !== 0x38425053 ||
    view.getUint16(4) !== 1 ||
    width < 256 ||
    height < 256 ||
    width > MAX_EDGE ||
    height > MAX_EDGE ||
    view.getUint16(22) !== 8 ||
    view.getUint16(24) !== 3
  ) {
    throw new Error('psdSpecInvalid')
  }
}

export function validateRigPsdStructure(psd: Psd): void {
  let count = 0
  let pixels = 0
  let visible = 0
  function visit(layers: Layer[], depth: number, parentVisible: boolean): void {
    if (depth > 32) throw new Error('psdLayerCountInvalid')
    for (const layer of layers) {
      if (++count > 256) throw new Error('psdLayerCountInvalid')
      const shown = parentVisible && !layer.hidden && layer.opacity !== 0
      const width = Math.max(0, (layer.right ?? 0) - (layer.left ?? 0))
      const height = Math.max(0, (layer.bottom ?? 0) - (layer.top ?? 0))
      if (
        !Number.isSafeInteger(width) ||
        !Number.isSafeInteger(height) ||
        width > MAX_EDGE ||
        height > MAX_EDGE
      ) {
        throw new Error('psdSpecInvalid')
      }
      pixels += width * height
      if (pixels > MAX_PIXELS) throw new Error('psdTooLarge')
      if (layer.children) visit(layer.children, depth + 1, shown)
      else if (shown && width && height) visible += 1
    }
  }
  visit(psd.children ?? [], 0, true)
  if (!visible || visible > MAX_LAYERS) throw new Error('psdLayerCountInvalid')
}

/** Most bytes the layers' pixels and masks may take, as 8-bit RGBA. */
const MAX_PIXEL_BYTES = 512 * 1024 * 1024

/**
 * A zip-compressed channel, held before it is inflated: `most` is the bytes its
 * rectangle holds. Throws to refuse it. ag-psd inflates a zip channel whole,
 * with nothing to stop it; a host that can inflate with a cap (Node) holds it here.
 */
export type HoldZipChannel = (data: Uint8Array, most: number) => void

interface RawChannels {
  rawData?: { channels: Array<{ id: number; compression: number; data?: Uint8Array }> }
}

function area(rect: { top?: number; left?: number; bottom?: number; right?: number } | undefined) {
  return rect ? Math.max(0, (rect.right ?? 0) - (rect.left ?? 0)) * Math.max(0, (rect.bottom ?? 0) - (rect.top ?? 0)) : 0
}

/**
 * The PSD's layers with their pixels. It is read whole first with each
 * channel's bytes kept as they are (nothing is inflated while it is read, so a
 * read that fails has inflated nothing), then the pixels and masks of the
 * layers in its tree are decoded one by one, each zip channel held first by
 * `holdZipChannel` and all of them held to MAX_PIXEL_BYTES. A group's closing
 * divider is not in the tree, and is never decoded.
 */
export function decodeRigPsd(buffer: ArrayBuffer, timer?: ImportTimer, holdZipChannel?: HoldZipChannel): Psd {
  validateRigPsdHeader(buffer)
  const options = {
    useImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true,
    skipLinkedFilesData: true,
    totalMemoryLimit: 512 * 1024 * 1024,
  }
  const metadata = readPsd(buffer, { ...options, skipLayerImageData: true })
  validateRigPsdStructure(metadata)
  timer?.lap('psd.structure')
  initializeCanvas(
    () => {
      throw new Error('Canvas decoding is not allowed in the PSD worker')
    },
    (width, height) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
      colorSpace: 'srgb',
    }),
  )
  const psd = readPsd(buffer, { ...options, useRawData: true })
  let left = MAX_PIXEL_BYTES
  const decode = (layers: Layer[]) => {
    for (const layer of layers) {
      const channels = (layer as RawChannels).rawData?.channels ?? []
      const rectOf = (id: number) => (id === -2 ? layer.mask : id === -3 ? layer.realMask : layer)
      for (const { id, compression, data } of channels) {
        if ((compression === 2 || compression === 3) && data?.length) holdZipChannel?.(data, area(rectOf(id)))
      }
      // What ag-psd allocates: the layer, and each mask that has its channel.
      const has = (id: number) => channels.some((channel) => channel.id === id && channel.data)
      left -= 4 * (area(layer) + (has(-2) ? area(layer.mask) : 0) + (has(-3) ? area(layer.realMask) : 0))
      if (left < 0) throw new Error('Exceeded memory limit')
      decodeLayerPixels(layer, true)
      decode(layer.children ?? [])
    }
  }
  decode(psd.children ?? [])
  timer?.lap('psd.pixels')
  return psd
}
