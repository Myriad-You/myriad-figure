import type { MeropeRigManifest } from '../rig/types'
import type { Anime25DArmAim } from './arm3dReach'
import type { Anime25DArmSide } from './armVariantPresenter'
import type { ClosedEyePresentation } from './closedEyePresentation'
import type { CollarClipMesh } from './collarRuntime'
import type { DrawnFrame } from './drawnFrame'
import type { Anime25DDriver } from './driver'
import type { Anime25DDriving } from './driving'
import type { FaceFrameInput } from './faceFrames'
import type { Anime25DIrisRebound } from './irisRebound'
import type { LayerDeformationContext } from './layerFrameDeformation'
import type { Anime25DGpuLayer } from './layerGpuBinding'
import type { Anime25DMotionEnvelopeProfile } from './motionEnvelope'
import type { Anime25DFrameWork } from './performanceTelemetry'
import type { Anime25DDebugSnapshot } from './playerDebug'
import type { Anime25DInspection } from './playerInspection'
import type { PackageState, PreparedSwap, SwapParts } from './playerSwap'
import type { Anime25DPose } from './pose'
import type { PoseCorrection } from './poseCorrections'
import type { PoseCorrectionStageSource } from './poseCorrectionStage'
import type { PresentedFigure } from './posePresenter'
import type { Anime25DRendererBindings, Anime25DRenderFrame } from './renderer'
import type { TouchAtlas, TouchPaintLayer, VisibleTouchHit } from './touchVisibility'
import type { Anime25DPlayback } from './types'
import { FigureError } from '../errors'
import { Anime25DArmVariants } from './armVariantPresenter'
import { Anime25DBodyFrames } from './bodyFrames'
import { carryCollarClipOnFigure, deformCollarClipMesh, uploadCollarClipMesh } from './collarRuntime'
import { drawFrame } from './drawnFrame'
import { Anime25DFaceFrames } from './faceFrames'
import { animationCatchupSeconds, animationElapsedSeconds, animationSubstepCount } from './frameClock'
import { deformLayers, settleDependentLayers } from './layerFrameDeformation'
import { drawOrder } from './legOrder'
import { Anime25DPerformanceTelemetry, createAnime25DFrameWork } from './performanceTelemetry'
import { describeAnime25DPlayback } from './playerDebug'
import { inspectAnime25DFrame } from './playerInspection'
import { releaseCompiledGpu, touchLayersFor } from './playerPackage'
import { measurePackage, prepareSwap, releaseSwap } from './playerSwap'
import { bindPoseCorrections, isPoseCorrections } from './poseCorrections'
import { Anime25DPoseInertia } from './poseInertia'
import { PosePresenter } from './posePresenter'
import { createAnime25DRendererBindings, disposeAnime25DRendererBindings } from './renderer'
import { resolveAnime25DRenderSurface, shouldApplyAnime25DResize } from './runtimePolicy'
import { ThinkingSticker } from './thinkingSticker'
import { touchPointInView } from './touchHitTest'
import { hitTestVisibleTouch } from './touchVisibility'
import { compileProgram, loadImage } from './webglRuntime'

/** What the stage and its driving share: the driving writes them, the stage draws them. */
export interface Anime25DStageShared {
  current: Anime25DDriver
  closedEyes: ClosedEyePresentation
  irisRebound: Anime25DIrisRebound
}

/**
 * The figure on a canvas: its outfit on the GPU, the body, face and arms that deform it, and the drawing. Each tick
 * the driving writes `current` substep by substep and the stage draws what it says.
 */
export class Anime25DStage<Measured = unknown> {
  private readonly thinkingSticker = new ThinkingSticker()
  private readonly gl: WebGL2RenderingContext
  private playback!: Anime25DPlayback
  private rigManifest: MeropeRigManifest | undefined
  private readonly program: WebGLProgram
  /** What an outfit swap measures against (playerSwap). */
  private readonly parts: SwapParts<Measured>
  private readonly rendererBindings: Anime25DRendererBindings
  private readonly poses: PosePresenter
  /** The frame drawn last; null before the first, and for another outfit. */
  private drawn: DrawnFrame | null = null
  private readonly renderFrame: Anime25DRenderFrame = {
    viewWidth: 1,
    viewHeight: 1,
    bodyPivotX: 0,
    bodyPivotY: 0,
    bodyRotationCosine: 1,
    bodyRotationSine: 0,
    bodyBendHeight: 0,
    time: 0,
    eyeCry: 0,
  }

  private layers: Anime25DGpuLayer[] = []
  private atlasTexture: WebGLTexture | null = null
  private touchAtlas: TouchAtlas | null = null
  private touchLayers: TouchPaintLayer[] = []
  private readonly performanceTelemetry = new Anime25DPerformanceTelemetry()
  private readonly current: Anime25DDriver
  private readonly deformationPoint = { x: 0, y: 0 }
  private readonly jellyShift = { x: 0, y: 0 }

  private time = 0
  private readonly irisRebound: Anime25DIrisRebound
  private readonly closedEyes: ClosedEyePresentation
  private readonly body: Anime25DBodyFrames
  private readonly armVariants = new Anime25DArmVariants()
  private readonly face: Anime25DFaceFrames
  private readonly poseInertia = new Anime25DPoseInertia()
  private motionEnvelopeProfile!: Anime25DMotionEnvelopeProfile
  private collarClip: CollarClipMesh | null = null
  private disposed = false
  private atlasAbort: AbortController | null = null
  /** Per-frame inputs every layer's deformation reads; refilled, never reallocated. */
  private readonly layerContext: LayerDeformationContext

  private readonly faceInput: FaceFrameInput = {
    time: 0,
    jawDrop: 0,
    jawOpen: 0,
    stylizedMotion: null,
    sillyMouthShare: 1,
  }

  constructor(
    canvas: HTMLCanvasElement,
    playback: Anime25DPlayback,
    rigManifest: MeropeRigManifest | undefined,
    private readonly driving: Anime25DDriving<Measured>,
    shared: Anime25DStageShared,
  ) {
    this.current = shared.current
    this.irisRebound = shared.irisRebound
    this.closedEyes = shared.closedEyes
    this.body = new Anime25DBodyFrames(this.current, this.renderFrame, driving)
    this.face = new Anime25DFaceFrames(this.current, this.irisRebound, this.closedEyes)
    this.layerContext = {
      anchors: undefined!,
      current: this.current,
      time: 0,
      deformationFrame: undefined!,
      secondaryDeformationFrame: undefined!,
      irisRebound: this.irisRebound,
      headJellyElement: null,
      headStretch: 0,
      deformationPoint: this.deformationPoint,
      jellyShift: this.jellyShift,
    }
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      stencil: true,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    })
    if (!gl) throw new FigureError('anime25dWebglFailed')
    this.gl = gl
    this.program = compileProgram(gl)
    this.parts = { gl, program: this.program, current: this.current, driving, body: this.body, face: this.face, armVariants: this.armVariants }
    let bindings: Anime25DRendererBindings | null = null
    try {
      bindings = createAnime25DRendererBindings(gl, this.program)
      this.rendererBindings = bindings
      this.poses = new PosePresenter({ gl, program: this.program, bindings, armVariants: this.armVariants, sticker: this.thinkingSticker })
      this.adoptPackage(measurePackage(this.parts, playback, rigManifest))
    } catch (error) {
      // A failed constructor has no owner that can call dispose().
      if (bindings) disposeAnime25DRendererBindings(gl, bindings)
      gl.deleteProgram(this.program)
      throw error
    }
  }

  /**
   * The last outfit keeps drawing until the next one is ready, and stays exactly as it was if the next one fails:
   * everything that can fail it is measured and made on the GPU first, touching nothing on screen, and only then taken
   * in one step that cannot fail. Its modelled arms are made in that step, the last one's gone; should they not be, its
   * gestures are raised flat.
   */
  async replaceLivePackage(
    playback: Anime25DPlayback,
    rigManifest: MeropeRigManifest | undefined,
    atlasUrl: string,
  ): Promise<void> {
    this.atlasAbort?.abort()
    const atlasAbort = new AbortController()
    this.atlasAbort = atlasAbort
    const image = await loadImage(atlasUrl, atlasAbort.signal)
    if (this.disposed || atlasAbort.signal.aborted) return
    const next = prepareSwap(this.parts, playback, rigManifest, image)
    if (this.disposed || atlasAbort.signal.aborted) {
      releaseSwap(this.parts, next)
      return
    }
    this.commitSwap(next)
  }

  /** Takes a prepared outfit in place of the live one, whose GPU resources go. Cannot fail. */
  private commitSwap(next: PreparedSwap<Measured>): void {
    const { prepared } = next
    const { compiled } = prepared
    this.adoptPackage(next.state)
    releaseCompiledGpu(this.gl, this.layers, this.collarClip, this.atlasTexture)
    this.atlasTexture = prepared.texture
    this.layers = compiled.layers
    this.collarClip = compiled.collarClip
    this.face.bindAtlas(next.mouth)
    // Last of what is taken on the GPU: modelled arms are made here, with all of the outfit before gone.
    this.armVariants.adopt(next.arms)
    this.driving.bindCapabilities(next.capabilities)
    this.touchAtlas = prepared.touchAtlas
    this.thinkingSticker.setTint(next.tint)
    this.touchLayers = touchLayersFor(this.layers, this.collarClip)
    this.drawn = null
    this.poses.reset()
  }

  async loadAtlas(url: string): Promise<void> {
    await this.replaceLivePackage(this.playback, this.rigManifest, url)
  }

  /** Workbench-only override. Never changes the immutable playback package. */
  previewPoseCorrections(corrections: readonly PoseCorrection[] | null): void {
    if (corrections !== null && !isPoseCorrections(corrections)) throw new Error('Invalid pose corrections')
    const profile = this.playback.shellProfile
    for (const layer of this.layers) {
      if (layer.attachment || layer.neckwearBridge || layer.shaderGlobalTransform) continue
      layer.secondaryDeformation.poseCorrections = bindPoseCorrections(
        corrections ?? profile.poseCorrections, layer.secondaryDeformation.shellMode, layer.rest, profile.head,
      )
    }
  }

  /** Workbench-only: what correction picking reads of the live frame; null once disposed. */
  poseStage(): PoseCorrectionStageSource | null {
    return this.disposed || this.poses.showing ? null : { canvas: this.gl.canvas, frame: this.renderFrame, layers: this.layers,
      head: this.playback.shellProfile.head, atlas: this.touchAtlas, gain: this.body.poseCorrectionGain(), driver: this.body.poseCorrectionDriver() }
  }

  hitTestTouch(clientX: number, clientY: number): VisibleTouchHit | null {
    const canvas = this.gl.canvas
    if (
      this.disposed ||
      this.poses.showing ||
      !this.touchAtlas ||
      !(canvas instanceof HTMLCanvasElement)
    ) {
      return null
}
    const point = touchPointInView(
      clientX,
      clientY,
      canvas.getBoundingClientRect(),
      {
        width: this.renderFrame.viewWidth,
        height: this.renderFrame.viewHeight,
      },
    )
    return point
      ? hitTestVisibleTouch(
          point.x,
          point.y,
          this.touchLayers,
          this.touchAtlas,
          this.renderFrame,
        )
      : null
  }

  private adoptPackage(state: PackageState<Measured>): void {
    const { playback, motionEnvelopeProfile } = state
    this.playback = playback
    this.closedEyes.bind(playback.layers)
    this.rigManifest = state.rigManifest
    this.motionEnvelopeProfile = motionEnvelopeProfile
    this.driving.bind(state.measured, motionEnvelopeProfile)
    this.body.bind(state.body)
    this.face.bind(state.face)
  }

  /** The seconds the figure has moved through, which `current` is written for. */
  animationTime(): number {
    return this.time
  }

  /** The gesture arms each side of the picture was drawn with. */
  armVariantGestures(): Record<Anime25DArmSide, string[]> {
    return this.armVariants.gestures()
  }

  /** The gesture each side is raising or holding now. */
  raisedArmVariants(): Record<Anime25DArmSide, string | null> {
    return this.armVariants.raised()
  }

  /**
   * Put a side's hand where `aim` says (from its shoulder, in arm lengths), from wherever the arm is and whatever
   * the drivers ask; null lets it follow them again. Led a little each frame the hand is there at once; moved
   * far at once the arm goes there. Only a modelled gesture arm of a bound figure can.
   */
  aimArm(side: Anime25DArmSide, aim: Anime25DArmAim | null): void {
    this.armVariants.aim(side, aim)
  }

  /** The aim that holds a side's arm as its `gesture` is drawn: a place to start an aim from. */
  armGestureAim(side: Anime25DArmSide, gesture: string): Anime25DArmAim | null {
    return this.armVariants.aimOf(side, gesture)
  }

  /** What was drawn this frame, copied out for tests and inspectors. */
  inspect(): Anime25DInspection {
    const { current, layers, collarClip, renderFrame } = this
    return inspectAnime25DFrame({ current, layers, collarClip, renderFrame, torsoYaw: this.body.torsoTurn(), figurePitch: this.body.secondaryDeformationFrame.figure?.pitch?.angle })
  }

  /** The package and the frame cost; `transferredEnergy` is the driving's, what its envelope moved between channels. */
  debugSnapshot(transferredEnergy = 0): Anime25DDebugSnapshot {
    return describeAnime25DPlayback(
      this.playback,
      this.motionEnvelopeProfile,
      transferredEnergy,
      this.performanceTelemetry.observe(),
      { ...this.current },
    )
  }

  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void {
    if (!shouldApplyAnime25DResize(cssWidth, cssHeight)) return
    const { width: pixelWidth, height: pixelHeight } = this.playback.pixelCanvas
    const surface = resolveAnime25DRenderSurface({
      sourceWidth: pixelWidth,
      sourceHeight: pixelHeight,
      cssWidth,
      cssHeight,
      devicePixelRatio,
    })
    const canvas = this.gl.canvas
    const cleared = canvas instanceof HTMLCanvasElement
      && (canvas.width !== surface.bufferWidth || canvas.height !== surface.bufferHeight)
    if (canvas instanceof HTMLCanvasElement) {
      if (canvas.width !== surface.bufferWidth)
        canvas.width = surface.bufferWidth
      if (canvas.height !== surface.bufferHeight)
        canvas.height = surface.bufferHeight
      const nextWidth = `${surface.displayWidth}px`
      const nextHeight = `${surface.displayHeight}px`
      if (canvas.style.width !== nextWidth) canvas.style.width = nextWidth
      if (canvas.style.height !== nextHeight) canvas.style.height = nextHeight
    }
    this.renderFrame.viewWidth = pixelWidth
    this.renderFrame.viewHeight = pixelHeight
    this.gl.viewport(0, 0, surface.bufferWidth, surface.bufferHeight)
    // 改缓冲区会清空画布；ResizeObserver 跑在本帧 rAF 之后、绘制之前，不当场补画就空一帧。
    if (!cleared || this.disposed || this.layers.length === 0) return
    if (this.poses.showing) this.poses.redraw(this.presented())
    else this.draw()
  }

  /**
   * Her own frame drawn last, as data (pose.ts), also while another is shown: drawn again it is the same picture to
   * the pixel. Null until one is drawn, and for another outfit until its own.
   */
  getPose(): Anime25DPose | null {
    return this.disposed || !this.drawn ? null : this.poses.take(this.presented(), this.drawn, this.time, this.current)
  }

  /**
   * Draws a pose in place of the figure, which does not move by it: the next tick goes on from where it was. False,
   * and nothing drawn, for a pose that is not of this outfit. Meanwhile nothing is touched (hitTestTouch) or
   * corrected; inspect() is of her own frame.
   */
  renderPose(pose: Readonly<Anime25DPose>): boolean {
    return !this.disposed && this.layers.length > 0 && this.poses.show(this.presented(), pose)
  }

  private presented(): PresentedFigure {
    return { layers: this.layers, collarClip: this.collarClip, armVariants: this.armVariants, atlas: this.atlasTexture, mouth: this.face.mouth }
  }

  tick(deltaSeconds: number): void {
    if (this.disposed || this.layers.length === 0) return
    this.poses.leave(this.presented())
    const elapsed = animationElapsedSeconds(deltaSeconds)
    const catchup = animationCatchupSeconds(elapsed)
    const substeps = animationSubstepCount(catchup)
    const dt = catchup / substeps
    const dropped = elapsed > 0.05
    this.time += elapsed - catchup
    if (!this.performanceTelemetry.shouldSample()) {
      for (let step = 0; step < substeps; step += 1) {
        this.time += dt
        this.smoothDriver(dt)
        this.body.updateSprings(dt, this.layers, this.time)
      }
      this.deform()
      this.uploadGeometry()
      this.draw()
      if (dropped) this.driving.frame({ dropped: true })
      return
    }
    const work = createAnime25DFrameWork()
    const frameStarted = performance.now()
    let driverMs = 0
    let springsMs = 0
    for (let step = 0; step < substeps; step += 1) {
      this.time += dt
      const driverStarted = performance.now()
      this.smoothDriver(dt)
      const driverFinished = performance.now()
      this.body.updateSprings(dt, this.layers, this.time)
      const springsFinished = performance.now()
      driverMs += driverFinished - driverStarted
      springsMs += springsFinished - driverFinished
    }
    const springsFinished = performance.now()
    this.deform(work)
    this.uploadGeometry(work)
    const deformFinished = performance.now()
    this.draw(work)
    const drawFinished = performance.now()
    this.performanceTelemetry.record({
      ...work,
      frameCpuMs: drawFinished - frameStarted,
      driverMs,
      springsMs,
      deformMs: deformFinished - springsFinished,
      drawSubmitMs: drawFinished - deformFinished,
    })
    this.driving.frame({
      dropped,
      cpuMs: drawFinished - frameStarted,
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.atlasAbort?.abort()
    this.atlasAbort = null
    this.armVariants.dispose()
    releaseCompiledGpu(this.gl, this.layers, this.collarClip, this.atlasTexture)
    this.face.dispose()
    this.layers = []
    this.collarClip = null
    this.atlasTexture = null
    this.touchAtlas = null
    this.touchLayers = []
    this.gl.deleteProgram(this.program)
    disposeAnime25DRendererBindings(this.gl, this.rendererBindings)
    this.thinkingSticker.dispose(this.gl)
    // A canvas still in the document must keep the context
    try {
      const surface = this.gl.canvas
      if (surface instanceof HTMLCanvasElement && surface.isConnected) return
      this.gl.getExtension('WEBGL_lose_context')?.loseContext()
    } catch {
      /* ignore */
    }
  }

  /** One substep of the driver: the pose's inertia let go, the driving's step, posture, inertia again. */
  private smoothDriver(dt: number): void {
    this.thinkingSticker.update(this.time, this.driving.thinkingLevel())
    this.poseInertia.release(this.current)
    this.driving.step(dt, this.time)
    this.body.stepPosture(dt, this.time)
    this.poseInertia.step(this.current, dt, Boolean(this.body.secondaryDeformationFrame.figure?.pitch))
  }

  /**
   * Write this frame's shared deformation inputs: chest, jaw and mouth frames,
   * layer opacity, and the collar clip. Returns what changed since last frame.
   */
  private prepareDeformationFrames(work?: Anime25DFrameWork) {
    const body = this.body
    body.prepareHeadFrame(this.time)
    body.prepareChestFrame(this.time)
    const faceInput = this.faceInput
    faceInput.time = this.time
    faceInput.jawDrop = body.jawDrop()
    faceInput.jawOpen = body.jawOpen()
    faceInput.stylizedMotion = this.driving.stylizedMotion
    faceInput.sillyMouthShare = this.driving.sillyMouthShare
    const deformationChanges = this.face.prepare(faceInput, this.layers)
    this.armVariants.follow(this.current)
    this.armVariants.applyOpacity(this.time)
    const collarMotion = body.prepareCollarMotion()
    if (this.collarClip) {
      deformCollarClipMesh(this.collarClip, collarMotion, body.neckDepth)
      const neck = this.layers.find((layer) => layer.source.role === 'neck')
      carryCollarClipOnFigure(this.collarClip, neck?.secondaryDeformation, body.secondaryDeformationFrame)
      if (work) {
        work.deformedLayers += 1
        work.deformedVertices += this.collarClip.rest.length / 2
      }
    }
    return deformationChanges
  }

  private deform(work?: Anime25DFrameWork): void {
    const deformationChanges = this.prepareDeformationFrames(work)
    const e = this.current
    const t = this.time
    const secondaryDeformationFrame = this.body.secondaryDeformationFrame
    const context = this.layerContext
    context.anchors = this.playback.anchors
    context.current = e
    context.time = t
    context.deformationFrame = this.face.deformationFrame
    context.secondaryDeformationFrame = secondaryDeformationFrame
    context.headJellyElement = this.body.headJellyFor(e.phys)
    context.headStretch = this.body.headStretch()
    deformLayers(
      this.layers,
      context,
      deformationChanges,
      (layer) => (e.phys ? this.body.jellyFor(layer) : undefined),
      work,
    )
    const settledBytes = settleDependentLayers(
      this.layers,
      secondaryDeformationFrame,
      t,
      e,
    )
    this.armVariants.applyLift(t, secondaryDeformationFrame, this.renderFrame)
    if (work) work.savedUploadBytes += settledBytes
  }

  private uploadGeometry(work?: Anime25DFrameWork): void {
    const { gl } = this
    if (this.collarClip) {
      const uploadStarted = work ? performance.now() : 0
      uploadCollarClipMesh(gl, this.collarClip)
      if (work) {
        work.uploadedBytes += this.collarClip.deformed.byteLength
        work.uploadSubmitMs += performance.now() - uploadStarted
      }
    }
    for (const layer of this.layers) {
      if (!layer.geometryDirty) continue
      gl.bindBuffer(gl.ARRAY_BUFFER, layer.vertexBuffer)
      const uploadStarted = work ? performance.now() : 0
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, layer.deformed)
      layer.geometryDirty = false
      if (work) {
        work.uploadedBytes += layer.deformed.byteLength
        work.uploadSubmitMs += performance.now() - uploadStarted
      }
    }
  }

  /** What drawing the figure as it now is takes. */
  private frameNow(): DrawnFrame {
    const { renderFrame, playback: { anchors: a } } = this
    const faceWidth = a.face.x1 - a.face.x0
    const point = this.body.headPointNow(a.face.x1 - faceWidth * 0.04, a.face.y0 + (a.face.y1 - a.face.y0) * 0.08)
    return {
      layers: drawOrder(this.layers, this.body.secondaryDeformationFrame.standing),
      collarClip: this.collarClip,
      renderFrame,
      arms: this.atlasTexture ? this.armVariants.drawnArms() : [],
      sticker: this.atlasTexture
        ? this.thinkingSticker.shown(this.time, this.driving.thinkingLevel(), point.x, point.y, faceWidth * 0.155)
        : null,
    }
  }

  private draw(work?: Anime25DFrameWork): void {
    this.renderFrame.time = this.time
    this.renderFrame.eyeCry = this.current.eyeCry
    const frame = this.frameNow()
    this.drawn = frame
    drawFrame({ gl: this.gl, program: this.program, bindings: this.rendererBindings, armVariants: this.armVariants, sticker: this.thinkingSticker }, this.atlasTexture, frame, work)
    this.driving.drawn()
  }
}
