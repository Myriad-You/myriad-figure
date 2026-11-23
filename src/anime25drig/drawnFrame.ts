import type { Anime25DArmVariants, DrawnArms } from './armVariantPresenter'
import type { CollarClipMesh } from './collarRuntime'
import type { Anime25DFrameWork } from './performanceTelemetry'
import type { Anime25DRenderableLayer, Anime25DRendererBindings, Anime25DRenderFrame } from './renderer'
import type { ThinkingSticker, ThinkingStickerFrame } from './thinkingSticker'
import { drawAnime25DFrame, redrawAnime25DLayers } from './renderer'

/** All that drawing one frame takes: the live figure's, or a pose's. */
export interface DrawnFrame {
  /** In drawing order. */
  layers: readonly Anime25DRenderableLayer[]
  collarClip: CollarClipMesh | null
  renderFrame: Anime25DRenderFrame
  arms: readonly DrawnArms[]
  sticker: ThinkingStickerFrame | null
}

/** What a figure draws with. */
export interface DrawingParts {
  gl: WebGL2RenderingContext
  program: WebGLProgram
  bindings: Anime25DRendererBindings
  armVariants: Anime25DArmVariants
  sticker: ThinkingSticker
}

/** Draws one frame; nothing of the figure moves. Its vertices are on the GPU by now. */
export function drawFrame(parts: DrawingParts, atlas: WebGLTexture | null, frame: DrawnFrame, work?: Anime25DFrameWork): void {
  const { gl, program, bindings } = parts
  drawAnime25DFrame(gl, program, bindings, frame.layers, atlas, frame.collarClip, frame.renderFrame, work)
  if (!atlas) return
  parts.armVariants.drawModelled(frame.arms, gl.drawingBufferWidth, gl.drawingBufferHeight,
    (layers, cut) => redrawAnime25DLayers(gl, program, bindings, layers, atlas, frame.renderFrame, cut))
  if (frame.sticker) parts.sticker.paint(gl, frame.sticker, frame.renderFrame.viewWidth, frame.renderFrame.viewHeight)
}
