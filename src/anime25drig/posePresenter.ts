import type { ContinuousMouthShape } from './continuousMouth'
import type { ContinuousMouthTexture } from './continuousMouthTexture'
import type { DrawingParts, DrawnFrame } from './drawnFrame'
import type { Anime25DDriver } from './driver'
import type { Anime25DPose } from './pose'
import type { PoseFigure } from './poseFrame'
import { uploadCollarClipMesh } from './collarRuntime'
import { drawFrame } from './drawnFrame'
import { capturePose, figureKey, moves, poseFits, poseFrame } from './poseFrame'

/** The live figure a pose is taken of and shown in place of. */
export interface PresentedFigure extends PoseFigure {
  atlas: WebGLTexture | null
  mouth: ContinuousMouthTexture | null
}

/**
 * Takes the figure's last drawn frame as a pose, and shows a pose in its place. A shown pose is only on the GPU (the
 * moving vertices, the mouth's painting); what the figure itself is stays, and comes back as it was with the next tick.
 */
export class PosePresenter {
  private key: string | null = null
  private shown: { pose: DrawnFrame, mouth: ContinuousMouthShape | null } | null = null

  constructor(private readonly parts: DrawingParts) {}

  get showing(): boolean {
    return this.shown !== null
  }

  /** Another package: what was shown is gone with the one before. */
  reset(): void {
    this.key = null
    this.shown = null
  }

  take(figure: PresentedFigure, drawn: DrawnFrame, time: number, driver: Anime25DDriver): Anime25DPose {
    const mouth = this.shown ? this.shown.mouth : figure.mouth?.shape ?? null
    return capturePose(figure, drawn, { key: this.keyOf(figure), time, driver, mouth })
  }

  /** Shows a pose; false, with nothing changed, for one that is not of this figure. */
  show(figure: PresentedFigure, pose: Readonly<Anime25DPose>): boolean {
    if (!figure.atlas || !poseFits(figure, this.keyOf(figure), pose)) return false
    const { gl } = this.parts
    const mouth = this.shown ? this.shown.mouth : figure.mouth ? { ...figure.mouth.shape } : null
    figure.layers.forEach((layer, i) => {
      const { vertices } = pose.layers[i]!
      if (vertices) upload(gl, layer.vertexBuffer, vertices)
    })
    if (figure.collarClip && pose.collar) upload(gl, figure.collarClip.vertexBuffer, pose.collar)
    if (figure.mouth && pose.mouth) figure.mouth.show(pose.mouth)
    this.shown = { pose: poseFrame(figure, pose), mouth }
    this.redraw(figure)
    return true
  }

  /** Draws the shown pose again. */
  redraw(figure: PresentedFigure): void {
    if (this.shown) drawFrame(this.parts, figure.atlas, this.shown.pose)
  }

  /** The GPU back as the figure itself left it. */
  leave(figure: PresentedFigure): void {
    if (!this.shown) return
    const { gl } = this.parts
    const { mouth } = this.shown
    this.shown = null
    for (const layer of figure.layers) {
      if (moves(layer)) upload(gl, layer.vertexBuffer, layer.deformed)
    }
    if (figure.collarClip) uploadCollarClipMesh(gl, figure.collarClip)
    if (figure.mouth && mouth) figure.mouth.show(mouth)
  }

  private keyOf(figure: PoseFigure): string {
    return (this.key ??= figureKey(figure))
  }
}

function upload(gl: WebGL2RenderingContext, buffer: WebGLBuffer | null, vertices: Float32Array): void {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices)
}
