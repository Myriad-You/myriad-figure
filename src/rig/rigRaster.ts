import { FigureError } from '../errors'

/** A picture's pixels: RGBA, 8 bits a channel, not premultiplied, rows from the top. */
export interface RgbaPixels {
  width: number
  height: number
  data: Uint8ClampedArray
}

/** Where a picture is drawn: the rectangle it is stretched onto, in the target's pixels. */
export interface RasterRect {
  x: number
  y: number
  width: number
  height: number
}

/** A sprite drawn onto a picture being made, at (x, y): stretched to `width` × `height` where given, else at its own size. */
export interface RasterDraw {
  pixels: RgbaPixels
  x: number
  y: number
  width?: number
  height?: number
}

/**
 * The 2D raster an import draws with: reading the portrait and the redraws,
 * fitting them onto the PSD, and making the atlas and the reference picture.
 * The browser's is a 2D canvas (`browserRigRaster`); one without a canvas
 * gives its own (`@myriad/figure/rig/node`).
 */
export interface RigRaster<Picture extends { width: number; height: number } = { width: number; height: number }> {
  /** A picture file read; rejects when it cannot be. */
  decode: (file: Blob) => Promise<Picture>
  /** Lets go of what `decode` holds. */
  release: (picture: Picture) => void
  /**
   * The picture stretched onto `to` of a transparent `width` × `height`
   * frame, smoothed at high quality; null when there is no surface to draw on.
   */
  place: (picture: Picture, width: number, height: number, to: RasterRect) => RgbaPixels | null
  /**
   * A PNG of a transparent `width` × `height` picture with the sprites drawn
   * over it in order (source-over, smoothed where stretched or off the pixel grid).
   */
  paint: (width: number, height: number, draws: readonly RasterDraw[]) => Promise<Blob>
}

type Canvas = HTMLCanvasElement | OffscreenCanvas

function createCanvas(): Canvas {
  return typeof document === 'undefined'
    ? new OffscreenCanvas(1, 1)
    : document.createElement('canvas')
}

function requiredContext(canvas: Canvas): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext('2d', { willReadFrequently: true }) as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!context) throw new FigureError('canvasUnsupported')
  return context
}

function canvasPng(canvas: Canvas): Promise<Blob> {
  if ('convertToBlob' in canvas)
    return canvas.convertToBlob({ type: 'image/png' })
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new FigureError('rigAtlasFailed'))),
      'image/png',
    ),
  )
}

/** The browser's raster: a 2D canvas (an OffscreenCanvas in a worker). */
export const browserRigRaster: RigRaster<ImageBitmap> = {
  decode: (file) => createImageBitmap(file),
  release: (bitmap) => bitmap.close(),
  place(bitmap, width, height, to) {
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) return null
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, to.x, to.y, to.width, to.height)
    return { width, height, data: context.getImageData(0, 0, width, height).data }
  },
  paint(width, height, draws) {
    const target = createCanvas()
    target.width = width
    target.height = height
    const context = requiredContext(target)
    const sprite = createCanvas()
    for (const { pixels, x, y, width: drawWidth, height: drawHeight } of draws) {
      sprite.width = pixels.width
      sprite.height = pixels.height
      const bytes = new Uint8ClampedArray(pixels.data.length)
      bytes.set(pixels.data)
      requiredContext(sprite).putImageData(new ImageData(bytes, pixels.width, pixels.height), 0, 0)
      if (drawWidth === undefined || drawHeight === undefined) context.drawImage(sprite, x, y)
      else context.drawImage(sprite, x, y, drawWidth, drawHeight)
    }
    return canvasPng(target)
  },
}
