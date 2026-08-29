import type { PerformanceDirective } from '../../../services/agent/types'
import type { MeropeRigManifest } from '../rig/types'
import type { SingingSpectrumDrive } from '../singing/singingGroove'
import type {
  ChestDeformationRegion,
  ChestDynamicsTuning,
  ChestMotionGeometry,
  ChestWeightField,
} from './chestPhysics'
import type { CollarClipMesh, CollarMotionPose } from './collarRuntime'
import type { Anime25DDriver } from './driver'
import type {
  Anime25DBlinkState,
  Anime25DStylizedTargets,
} from './driverComposition'
import type { Anime25DExpressionDeformationFrame } from './expressionDeformation'
import type { Anime25DHairSpringFrame } from './hairPhysics'
import type { Anime25DGpuLayer } from './layerGpuBinding'
import type { Anime25DMouthDeformationFrame } from './mouthDeformation'
import type {
  Anime25DMouthMorphSources,
  Anime25DOpacityFrame,
  MouthMorphState,
} from './mouthRuntime'
import type { SpeechMouthMaterial } from './mouthTransition'
import type {
  Anime25DFrameWork,
  Anime25DPerformanceSnapshot,
} from './performanceTelemetry'
import type { Anime25DRendererBindings, Anime25DRenderFrame } from './renderer'
import type { Anime25DSecondaryDeformationFrame } from './secondaryDeformation'
import type { StylizedExpressionMotion } from './stylizedExpressionMotion'
import type { Anime25DPlayback } from './types'
import { currentCopy } from '../../../i18n/localeCopy'
import {
  singingDriveAmount,
  SingingGrooveController,
} from '../singing/singingGroove'
import { AmbientMotionController } from './ambientMotion'
import {
  buildChestWeightField,
  chestFollowMix,
  chestMotionTarget,
  chestProfileUsesGeometryWeights,
  chestResponseMix,
  createChestSpringState,
  resolveChestDeformationRegion,
  resolveChestDynamics,
  stepChestSpring,
  topwearMotionAtChest,
} from './chestPhysics'
import { deformRigidMlsPoint } from './collarContact'
import {
  BODY_HEAD_FOLLOW,
  deformCollarClipMesh,
  updateFrontCollarTargets,
  uploadCollarClipMesh,
} from './collarRuntime'
import { cryTearHorizontalOffset, cryTearVerticalOffset } from './cryMotion'
import { IDENTITY_DRIVER, sanitizeDriverPatch } from './driver'
import {
  applyAnime25DActionMotion,
  applyAnime25DAmbientMotion,
  applyAnime25DCryMouth,
  applyAnime25DSillyMouthOwnership,
  applyAnime25DSpeechMotion,
  applyAnime25DStylizedMotion,
  captureAnime25DSecondaryMotion,
  prepareAnime25DWorkingTarget,
  resolveAnime25DStylizedTargets,
  smoothAnime25DUnit,
  stepAnime25DBlink,
  stepAnime25DDriverResponse,
} from './driverComposition'
import { deformAnime25DExpressionPoint } from './expressionDeformation'
import { applyExpressiveMotionEnvelope } from './expressiveMotionEnvelope'
import { stepAnime25DHairLayerSprings } from './hairPhysics'
import {
  createJawMotionState,
  jawMotionTarget,
  jawTravelPixels,
  stepJawMotion,
} from './jawMotion'
import { deformAnime25DUpstreamFeaturePoint } from './layerDeformation'
import { compileAnime25DGpuLayers } from './layerGpuBinding'
import { writeAnime25DLayerGlobalTransform } from './layerTransform'
import {
  deformAnime25DFaceJawPoint,
  deformAnime25DMouthPoint,
} from './mouthDeformation'
import {
  applyMouthTransitionBridge,
  compileAnime25DMouthMorphSources,
  createAnime25DOpacityFrame,
  fadeOpacityFromFrame,
  resolveMouthMorph,
  shouldDeformLayer,
  writeAnime25DOpacityFrame,
} from './mouthRuntime'
import { MouthTransitionController } from './mouthTransition'
import { PerformanceExpressionController } from './performanceExpression'
import {
  Anime25DPerformanceTelemetry,
  createAnime25DFrameWork,
} from './performanceTelemetry'
import { RandomActionController } from './randomAction'
import { createAnime25DRendererBindings, drawAnime25DFrame } from './renderer'
import { resolveAnime25DRenderSurface } from './runtimePolicy'
import {
  deformAnime25DHairPoint,
  deformAnime25DSecondaryPoint,
} from './secondaryDeformation'
import { CoSpeechExpressionController } from './speechExpression'
import { AutoSpeechController } from './speechMotion'
import { StylizedExpressionMotionController } from './stylizedExpressionMotion'
import { ThinkingMotionController } from './thinkingMotion'
import { compileProgram, createAtlasTexture, loadImage } from './webglRuntime'

interface SecondaryMotionPose {
  angleX: number
  angleY: number
  angleZ: number
  body: number
}

export interface Anime25DDebugSnapshot {
  layerCount: number
  hairLayerCount: number
  strandCount: number
  eyeOpenLayers: number
  eyeCloseLayers: number
  eyeDizzyLayers: number
  eyeSqueezeLayers: number
  eyeCryLayers: number
  eyeSillyLayers: number
  lovestruckHeartLayers: number
  lovestruckFaceLayers: number
  lovestruckDroolLayers: number
  maniacEyeShadowLayers: number
  angerMarkLayers: number
  speechlessSweatLayers: number
  mouthOpenLayers: number
  mouthWideLayers: number
  mouthRoundLayers: number
  mouthNarrowLayers: number
  mouthCloseLayers: number
  mouthCryLayers: number
  mouthManiacLayers: number
  mouthSillyLayers: number
  canvas: { width: number; height: number }
  performance: Anime25DPerformanceSnapshot
  current: Anime25DDriver
}

export class Anime25DPlayer {
  private readonly gl: WebGL2RenderingContext
  private readonly playback: Anime25DPlayback
  private readonly program: WebGLProgram
  private readonly rendererBindings: Anime25DRendererBindings
  private readonly renderFrame: Anime25DRenderFrame = {
    viewWidth: 1,
    viewHeight: 1,
    bodyPivotX: 0,
    bodyPivotY: 0,
    bodyRotationCosine: 1,
    bodyRotationSine: 0,
    time: 0,
    eyeCry: 0,
  }

  private layers: Anime25DGpuLayer[] = []
  private atlasTexture: WebGLTexture | null = null
  private readonly performanceTelemetry = new Anime25DPerformanceTelemetry()
  private readonly current: Anime25DDriver = { ...IDENTITY_DRIVER }
  private readonly target: Anime25DDriver = { ...IDENTITY_DRIVER }
  private readonly workingTarget: Anime25DDriver = { ...IDENTITY_DRIVER }
  private readonly secondaryCurrent: SecondaryMotionPose = {
    angleX: 0,
    angleY: 0,
    angleZ: 0,
    body: 0,
  }

  private readonly secondaryTarget: SecondaryMotionPose = {
    angleX: 0,
    angleY: 0,
    angleZ: 0,
    body: 0,
  }

  private readonly mouthMorph: MouthMorphState = {
    centerX: 0,
    centerY: 0,
    width: 1,
    height: 1,
    openMix: 0,
    wide: 0,
    round: 0,
    narrow: 0,
  }

  private readonly mouthMorphSources: Anime25DMouthMorphSources
  private readonly opacityFrame: Anime25DOpacityFrame =
    createAnime25DOpacityFrame()

  private readonly deformationPoint = { x: 0, y: 0 }
  private readonly deformationFrame: Anime25DMouthDeformationFrame &
    Anime25DExpressionDeformationFrame

  private readonly secondaryDeformationFrame: Anime25DSecondaryDeformationFrame
  private readonly collarMotion: CollarMotionPose
  private readonly hairSpringFrame: Anime25DHairSpringFrame

  private readonly mouthTransition: MouthTransitionController
  private activeMouthMaterial: SpeechMouthMaterial = 'mouthClose'
  private sillyMouthShare = 1

  private time = 0
  private readonly blinkState: Anime25DBlinkState = {
    activeSeconds: -1,
    nextAtSeconds: 1.8,
  }

  private readonly ambientMotion = new AmbientMotionController()
  private readonly randomAction = new RandomActionController()
  private readonly singingGroove = new SingingGrooveController()
  private singingDrive: SingingSpectrumDrive | null = null
  private singingDeform = 0
  private readonly thinkingMotion = new ThinkingMotionController()
  private readonly stylizedExpression = new StylizedExpressionMotionController()
  private readonly stylizedTargets: Anime25DStylizedTargets = {
    anger: 0,
    speechless: 0,
    maniac: 0,
    silly: 0,
    lovestruck: 0,
  }

  private stylizedMotion: Readonly<StylizedExpressionMotion> | null = null
  private readonly performanceExpression = new PerformanceExpressionController()
  private readonly speechMotion = new AutoSpeechController()
  private readonly speechExpression = new CoSpeechExpressionController()
  private readonly cryMouth = {
    mouthOpen: 0,
    mouthForm: 0,
    mouthCY: 0,
    mouthScale: 0,
  }

  private speechActive = false
  private readonly chest = createChestSpringState()
  private readonly chestTarget = { x: 0, y: 0 }
  private readonly chestParentTarget = { x: 0, y: 0 }
  private readonly chestDynamics: ChestDynamicsTuning
  private readonly chestGeometry: ChestMotionGeometry
  private readonly chestRegion: ChestDeformationRegion
  private readonly chestWeightField: ChestWeightField | null
  private readonly jaw = createJawMotionState()
  private readonly jawTravel: number
  private readonly highCollar: boolean
  private readonly neckDepth: number
  private collarClip: CollarClipMesh | null = null
  private jawEmphasis = 0
  private readonly mouse = { x: 0, y: 0, inside: false }
  private disposed = false

  constructor(
    canvas: HTMLCanvasElement,
    playback: Anime25DPlayback,
    rigManifest?: MeropeRigManifest,
  ) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      stencil: true,
      antialias: true,
    })
    if (!gl) throw new Error(currentCopy().merope.anime25dWebglFailed)
    this.gl = gl
    this.playback = playback
    this.highCollar = playback.layers.some(
      (layer) => layer.role === 'collar-back' || layer.role === 'collar-front',
    )
    this.neckDepth =
      playback.layers.find((layer) => layer.role === 'neck')?.depth ?? 0.95
    this.mouthTransition = new MouthTransitionController(playback.mouthProfile)
    this.mouthMorphSources = compileAnime25DMouthMorphSources(playback.layers)
    this.deformationFrame = {
      mouth: playback.anchors.mouth,
      face: playback.anchors.face,
      faceScale: playback.anchors.faceScale,
      morph: this.mouthMorph,
      mouthMorph: this.mouthMorph,
      expression: this.current,
      jawDrop: 0,
      jawOpen: 0,
      time: 0,
      stylizedMotion: null,
    }
    this.jawTravel = jawTravelPixels(playback)
    this.chestDynamics = resolveChestDynamics(playback.chestProfile)
    const anchors = playback.anchors
    const faceWidth = anchors.face.x1 - anchors.face.x0
    const faceHeight = anchors.face.y1 - anchors.face.y0
    const legacyChestY = anchors.neckBottom + faceHeight * 0.6
    this.chestRegion = resolveChestDeformationRegion(playback.chestProfile, {
      faceWidth,
      faceHeight,
      neckBottom: anchors.neckBottom,
      fallbackCenterX: anchors.neckPivot.x,
      fallbackCenterY: legacyChestY,
      fallbackRadiusX: faceWidth * 0.6,
      fallbackRadiusY: faceHeight * 0.45,
    })
    this.chestGeometry = {
      faceScale: anchors.faceScale,
      faceCenterY: anchors.face.cy,
      neckX: anchors.neckPivot.x,
      neckY: anchors.neckPivot.y,
      centerX: this.chestRegion.centerX,
      centerY: this.chestRegion.centerY,
      depth:
        playback.layers.find((layer) => layer.role === 'topwear')?.depth ?? 0.9,
    }
    this.chestWeightField = chestProfileUsesGeometryWeights(
      playback.chestProfile,
    )
      ? buildChestWeightField(rigManifest)
      : null
    const neckFollowTop = Math.min(
      anchors.neckBottom - 1,
      Math.max(anchors.neckTop, anchors.face.y1 + anchors.faceScale * 5),
    )
    this.secondaryDeformationFrame = {
      expression: this.current,
      faceScale: anchors.faceScale,
      headAngleY: 0,
      headRotationCosine: 1,
      headRotationSine: 0,
      neckPivotX: anchors.neckPivot.x,
      neckPivotY: anchors.neckPivot.y,
      neckBottom: anchors.neckBottom,
      neckFollowTop,
      neckFollowSpan: Math.max(1, anchors.neckBottom - neckFollowTop),
      faceCenterY: anchors.face.cy,
      bodyBreathOffset: 0,
      headBreathOffset: 0,
      specialHeadOffset: 0,
      highCollar: this.highCollar,
      breath: 0,
      chestCenterX: this.chestRegion.centerX,
      chestRegionCenterY: this.chestRegion.centerY,
      chestMotionCenterY: this.chestRegion.centerY,
      chestRadiusY: this.chestRegion.radiusY,
      inverseChestRadiusX: 1 / this.chestRegion.radiusX,
      inverseChestRadiusY: 1 / this.chestRegion.radiusY,
      chestOffsetX: 0,
      chestOffsetY: 0,
      chestProfileSource: playback.chestProfile?.source,
    }
    this.collarMotion = {
      neckPivotX: anchors.neckPivot.x,
      neckPivotY: anchors.neckPivot.y,
      neckFollowTop,
      neckFollowSpan: Math.max(1, anchors.neckBottom - neckFollowTop),
      faceCenterY: anchors.face.cy,
      faceScale: anchors.faceScale,
      angleX: 0,
      angleY: 0,
      headRotationCosine: 1,
      headRotationSine: 0,
      bodyBreathOffset: 0,
      headBreathOffset: 0,
    }
    this.hairSpringFrame = {
      enabled: true,
      idle: true,
      angleX: 0,
      angleZ: 0,
      faceScale: anchors.faceScale,
      neckPivotY: anchors.neckPivot.y,
      faceCenterY: anchors.face.cy,
      time: 0,
    }
    this.program = compileProgram(gl)
    this.rendererBindings = createAnime25DRendererBindings(gl, this.program)
  }

  async loadAtlas(url: string): Promise<void> {
    const image = await loadImage(url)
    this.atlasTexture = createAtlasTexture(this.gl, image)
    const compiled = compileAnime25DGpuLayers(
      this.gl,
      this.program,
      this.playback,
      this.current,
      this.chestWeightField,
      image,
      this.collarClip,
    )
    this.layers = compiled.layers
    this.collarClip = compiled.collarClip
  }

  setTarget(partial: Partial<Anime25DDriver>): void {
    Object.assign(this.target, sanitizeDriverPatch(partial))
  }

  replaceTarget(driver: Anime25DDriver): void {
    Object.assign(this.target, IDENTITY_DRIVER, sanitizeDriverPatch(driver))
  }

  getTarget(): Anime25DDriver {
    return { ...this.target }
  }

  getCurrent(): Anime25DDriver {
    return { ...this.current }
  }

  blinkNow(): void {
    this.blinkState.activeSeconds = 0
    this.blinkState.nextAtSeconds = this.time + 1.6 + Math.random() * 3.8
  }

  setMouse(x: number, y: number, inside: boolean): void {
    this.mouse.x = x
    this.mouse.y = y
    this.mouse.inside = inside
  }

  setSpeechActive(active: boolean): void {
    this.speechActive = active
  }

  setSinging(active: boolean): void {
    this.target.singing = active
  }

  setSingingSpectrum(drive: SingingSpectrumDrive | null): void {
    this.singingDrive = drive
  }

  enqueueSpeechText(text: string, locale?: string): void {
    this.speechMotion.enqueueText(text, locale)
  }

  clearSpeechText(): void {
    this.speechMotion.clear(this.time)
  }

  playPerformance(
    directive: PerformanceDirective,
    cueOriginSeconds?: number,
  ): boolean {
    const now = this.performanceClockSeconds()
    return this.performanceExpression.play(
      directive,
      now,
      cueOriginSeconds ?? now,
    )
  }

  stopPerformance(): void {
    this.performanceExpression.stop(this.performanceClockSeconds())
  }

  debugSnapshot(): Anime25DDebugSnapshot {
    const layers = this.playback.layers
    return {
      layerCount: layers.length,
      hairLayerCount: layers.filter((layer) => layer.phys === 'hair').length,
      strandCount: layers.reduce((sum, layer) => sum + layer.strands.length, 0),
      eyeOpenLayers: layers.filter((layer) => layer.fade === 'eyeOpen').length,
      eyeCloseLayers: layers.filter((layer) => layer.fade === 'eyeClose')
        .length,
      eyeDizzyLayers: layers.filter((layer) => layer.fade === 'eyeDizzy')
        .length,
      eyeSqueezeLayers: layers.filter((layer) => layer.fade === 'eyeSqueeze')
        .length,
      eyeCryLayers: layers.filter((layer) => layer.fade === 'eyeCry').length,
      eyeSillyLayers: layers.filter((layer) => layer.fade === 'eyeSilly')
        .length,
      lovestruckHeartLayers: layers.filter(
        (layer) => layer.fade === 'lovestruckHeart',
      ).length,
      lovestruckFaceLayers: layers.filter(
        (layer) => layer.fade === 'lovestruckFace',
      ).length,
      lovestruckDroolLayers: layers.filter(
        (layer) => layer.fade === 'lovestruckDrool',
      ).length,
      maniacEyeShadowLayers: layers.filter(
        (layer) => layer.fade === 'maniacEyeShadow',
      ).length,
      angerMarkLayers: layers.filter((layer) => layer.fade === 'angerMark')
        .length,
      speechlessSweatLayers: layers.filter(
        (layer) => layer.fade === 'speechlessSweat',
      ).length,
      mouthOpenLayers: layers.filter((layer) => layer.fade === 'mouthOpen')
        .length,
      mouthWideLayers: layers.filter((layer) => layer.fade === 'mouthWide')
        .length,
      mouthRoundLayers: layers.filter((layer) => layer.fade === 'mouthRound')
        .length,
      mouthNarrowLayers: layers.filter((layer) => layer.fade === 'mouthNarrow')
        .length,
      mouthCloseLayers: layers.filter((layer) => layer.fade === 'mouthClose')
        .length,
      mouthCryLayers: layers.filter((layer) => layer.fade === 'mouthCry')
        .length,
      mouthManiacLayers: layers.filter((layer) => layer.fade === 'mouthManiac')
        .length,
      mouthSillyLayers: layers.filter((layer) => layer.fade === 'mouthSilly')
        .length,
      canvas: { ...this.playback.pixelCanvas },
      performance: this.performanceTelemetry.observe(),
      current: this.getCurrent(),
    }
  }

  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void {
    const { width: pixelWidth, height: pixelHeight } = this.playback.pixelCanvas
    const surface = resolveAnime25DRenderSurface({
      sourceWidth: pixelWidth,
      sourceHeight: pixelHeight,
      cssWidth,
      cssHeight,
      devicePixelRatio,
    })
    const canvas = this.gl.canvas
    if (canvas instanceof HTMLCanvasElement) {
      if (canvas.width !== surface.bufferWidth)
        canvas.width = surface.bufferWidth
      if (canvas.height !== surface.bufferHeight)
        canvas.height = surface.bufferHeight
      canvas.style.width = `${surface.displayWidth}px`
      canvas.style.height = `${surface.displayHeight}px`
    }
    this.renderFrame.viewWidth = pixelWidth
    this.renderFrame.viewHeight = pixelHeight
    this.gl.viewport(0, 0, surface.bufferWidth, surface.bufferHeight)
  }

  tick(deltaSeconds: number): void {
    if (this.disposed || this.layers.length === 0) return
    const dt = Math.min(0.05, Math.max(0.001, deltaSeconds))
    this.time += dt
    if (!this.performanceTelemetry.shouldSample()) {
      this.smoothDriver(dt)
      this.updateSprings(dt)
      this.deform()
      this.uploadGeometry()
      this.draw()
      return
    }
    const work = createAnime25DFrameWork()
    const frameStarted = performance.now()
    const phaseStarted = frameStarted
    this.smoothDriver(dt)
    const driverFinished = performance.now()
    this.updateSprings(dt)
    const springsFinished = performance.now()
    this.deform(work)
    this.uploadGeometry(work)
    const deformFinished = performance.now()
    this.draw(work)
    const drawFinished = performance.now()
    this.performanceTelemetry.record({
      ...work,
      frameCpuMs: drawFinished - frameStarted,
      driverMs: driverFinished - phaseStarted,
      springsMs: springsFinished - driverFinished,
      deformMs: deformFinished - springsFinished,
      drawSubmitMs: drawFinished - deformFinished,
    })
  }

  captureFrame(): string | null {
    const canvas = this.gl.canvas
    return canvas instanceof HTMLCanvasElement
      ? canvas.toDataURL('image/png')
      : null
  }

  dispose(): void {
    this.disposed = true
    const { gl } = this
    for (const layer of this.layers) {
      gl.deleteBuffer(layer.vertexBuffer)
      gl.deleteBuffer(layer.uvBuffer)
      gl.deleteBuffer(layer.indexBuffer)
      gl.deleteVertexArray(layer.vao)
    }
    if (this.atlasTexture) gl.deleteTexture(this.atlasTexture)
    this.atlasTexture = null
    if (this.collarClip) {
      gl.deleteBuffer(this.collarClip.vertexBuffer)
      gl.deleteBuffer(this.collarClip.uvBuffer)
      gl.deleteBuffer(this.collarClip.indexBuffer)
      gl.deleteVertexArray(this.collarClip.vao)
      this.collarClip = null
    }
    gl.deleteProgram(this.program)
    this.layers = []
  }

  private smoothDriver(dt: number): void {
    const t = this.time
    const tgt = prepareAnime25DWorkingTarget(
      this.workingTarget,
      this.target,
      this.mouse,
      t,
    )
    const semanticExpression = this.performanceExpression.sample(
      this.performanceClockSeconds(),
    )
    const stylizedTargets = resolveAnime25DStylizedTargets(
      this.stylizedTargets,
      tgt,
      semanticExpression,
    )
    const stylized = this.stylizedExpression.sample(
      t,
      stylizedTargets.anger,
      stylizedTargets.speechless,
      stylizedTargets.maniac,
      stylizedTargets.silly,
      stylizedTargets.lovestruck,
    )
    this.stylizedMotion = stylized
    const performanceMotionScale =
      this.performanceExpression.getAmbientMotionScale()
    const pointerDriven = this.target.mouse && this.mouse.inside
    const speech = this.speechMotion.sample(t, this.target.talk)
    this.jawEmphasis = speech.browAccent
    const speaking = this.speechActive || this.target.talk
    const singing = this.target.singing
    this.singingDeform +=
      ((singing ? 1 : 0) - this.singingDeform) *
      (1 - Math.exp(-(singing ? 5.5 : 1.05) * dt))
    const groove = this.singingGroove.sample(t, singing, this.singingDrive)
    // Agent speech suppresses idle actions; singing keeps them and switches
    // the catalog to an excited groove driven by the live spectrum.
    const actionBlocked =
      (this.speechActive && !singing) ||
      stylizedTargets.anger > 0.03 ||
      stylizedTargets.speechless > 0.03 ||
      stylizedTargets.maniac > 0.03 ||
      stylizedTargets.silly > 0.03 ||
      stylizedTargets.lovestruck > 0.03
    const randomAction = this.randomAction.sample(
      t,
      this.target.rand && !pointerDriven,
      actionBlocked,
      singing ? 'excited' : 'idle',
      this.singingDrive ? singingDriveAmount(this.singingDrive) : 1,
    )
    const ambient = this.ambientMotion.sample(
      t,
      this.target.rand && !pointerDriven,
    )
    const thinking = this.thinkingMotion.sample(
      t,
      this.target.thinking &&
        !pointerDriven &&
        !speaking &&
        stylizedTargets.anger <= 0.03 &&
        stylizedTargets.speechless <= 0.03 &&
        stylizedTargets.maniac <= 0.03 &&
        stylizedTargets.silly <= 0.03 &&
        stylizedTargets.lovestruck <= 0.03,
    )
    const ambientScale =
      performanceMotionScale * randomAction.ambientScale * stylized.ambientScale
    const headKeep = 1 - 0.88 * this.singingDeform
    applyAnime25DAmbientMotion(tgt, ambient, ambientScale, headKeep)
    applyAnime25DActionMotion(
      tgt,
      randomAction,
      performanceMotionScale * stylized.ambientScale,
      groove,
      this.singingDeform,
      thinking,
    )
    applyAnime25DStylizedMotion(tgt, semanticExpression, stylized, speaking)
    applyAnime25DCryMouth(tgt, this.current.eyeCry, t, dt, this.cryMouth)
    const speechExpression = this.speechExpression.sample(
      t,
      speaking,
      this.speechActive && !this.target.talk ? tgt.mouthOpen : null,
      speech.phraseActivity,
      speech.browAccent,
      speech.headAccent,
    )
    applyAnime25DSpeechMotion(tgt, speech, speechExpression)
    // The omega mouth only takes over once the character has stopped talking;
    // a cue landing mid-delivery would otherwise freeze the lip sync.
    this.sillyMouthShare +=
      ((speaking ? 0 : 1) - this.sillyMouthShare) * (1 - Math.exp(-7 * dt))
    applyAnime25DSillyMouthOwnership(
      tgt,
      smoothAnime25DUnit(stylizedTargets.silly) * this.sillyMouthShare,
    )
    captureAnime25DSecondaryMotion(this.secondaryTarget, tgt)
    applyExpressiveMotionEnvelope(tgt, semanticExpression, speechExpression)
    stepAnime25DBlink(
      tgt,
      this.blinkState,
      this.time,
      dt,
      this.target.blink,
      stylizedTargets.maniac > 0.03 || stylizedTargets.silly > 0.03,
    )
    stepAnime25DDriverResponse(
      this.current,
      this.target,
      tgt,
      this.secondaryCurrent,
      this.secondaryTarget,
      dt,
    )
  }

  private performanceClockSeconds(): number {
    return performance.now() / 1_000
  }

  private updateSprings(dt: number): void {
    const { anchors } = this.playback
    const faceScale = anchors.faceScale
    const e = this.current
    stepJawMotion(this.jaw, jawMotionTarget(e, this.jawEmphasis), dt)
    const secondary = this.secondaryCurrent
    const chestProfile = this.playback.chestProfile
    if (chestProfile?.enabled !== false) {
      const chestTarget = chestMotionTarget(e, faceScale, this.chestTarget)
      topwearMotionAtChest(e, this.chestGeometry, this.chestParentTarget)
      stepChestSpring(
        this.chest,
        chestTarget.x,
        chestTarget.y,
        dt,
        this.chestDynamics.frequencyScale,
        this.chestDynamics.dampingScale,
      )
    }
    const hairSpringFrame = this.hairSpringFrame
    hairSpringFrame.enabled = e.phys
    hairSpringFrame.idle = e.idle
    hairSpringFrame.angleX = secondary.angleX
    hairSpringFrame.angleZ = secondary.angleZ
    hairSpringFrame.time = this.time
    stepAnime25DHairLayerSprings(this.layers, hairSpringFrame, dt)
  }

  private deform(work?: Anime25DFrameWork): void {
    const A = this.playback.anchors
    const e = this.current
    const fs = A.faceScale
    const t = this.time
    const breath = 0.5 + 0.5 * Math.sin((t * Math.PI * 2) / 3.4)
    const breathHead = 0.5 + 0.5 * Math.sin((t * Math.PI * 2) / 3.4 - 0.6)
    const npx = A.neckPivot.x
    const npy = A.neckPivot.y
    const bpx = A.bodyPivot.x
    const bpy = A.bodyPivot.y
    const singingLift = this.singingDeform
    const az = e.angleZ * (0.07 + 0.38 * singingLift)
    const ay = e.angleY * (1 + 1.1 * singingLift)
    const cz = Math.cos(az)
    const sz = Math.sin(az)
    const ab = e.body * (0.028 + 0.05 * singingLift)
    const cb = Math.cos(ab)
    const sb = Math.sin(ab)
    this.renderFrame.bodyPivotX = bpx
    this.renderFrame.bodyPivotY = bpy
    this.renderFrame.bodyRotationCosine = cb
    this.renderFrame.bodyRotationSine = sb
    const chestProfile = this.playback.chestProfile
    const chestCy = this.chestRegion.centerY
    const chestRx = this.chestRegion.radiusX
    const chestRy = this.chestRegion.radiusY
    const chestMotionMix =
      chestResponseMix(e.bust, this.chestDynamics.responseScale) *
      (1 - 0.75 * singingLift)
    const chestFollow =
      chestFollowMix(e.bust, this.chestDynamics.followScale) *
      (1 - 0.7 * singingLift)
    const chestCenterY = chestProfile
      ? chestCy + (e.bustY - 1) * 70 * fs
      : chestCy + e.bustY * 70 * fs
    const chestOffsetX =
      (this.chestTarget.x - this.chestParentTarget.x) * chestFollow +
      this.chest.offsetX * chestMotionMix
    const chestOffsetY =
      (this.chestTarget.y - this.chestParentTarget.y) * chestFollow +
      this.chest.offsetY * chestMotionMix
    const inverseChestRx = 1 / chestRx
    const inverseChestRy = 1 / chestRy
    const jawDrop = this.jaw.value * this.jawTravel
    const jawOpen = Math.max(0, this.jaw.value)
    const specialHeadOffset = this.stylizedMotion
      ? (this.stylizedMotion.maniacHeadPulse * 80 +
          this.stylizedMotion.sillyHeadPulse * 8 +
          this.stylizedMotion.lovestruckHeadPulse * 5) *
        fs
      : 0
    const mouthTransition = this.mouthTransition.sample(e)
    this.activeMouthMaterial = mouthTransition.material
    resolveMouthMorph(
      this.mouthMorphSources,
      e,
      A.mouth,
      A.face,
      this.mouthMorph,
    )
    applyMouthTransitionBridge(this.mouthMorph, mouthTransition)
    const deformationFrame = this.deformationFrame
    deformationFrame.faceScale = fs
    deformationFrame.jawDrop = jawDrop
    deformationFrame.jawOpen = jawOpen
    deformationFrame.time = t
    deformationFrame.stylizedMotion = this.stylizedMotion
    const deformationPoint = this.deformationPoint
    const secondaryDeformationFrame = this.secondaryDeformationFrame
    secondaryDeformationFrame.headAngleY = ay
    secondaryDeformationFrame.headRotationCosine = cz
    secondaryDeformationFrame.headRotationSine = sz
    secondaryDeformationFrame.bodyBreathOffset = breath * 2
    secondaryDeformationFrame.headBreathOffset = breathHead * 1.6
    secondaryDeformationFrame.specialHeadOffset = specialHeadOffset
    secondaryDeformationFrame.breath = breath
    secondaryDeformationFrame.chestMotionCenterY = chestCenterY
    secondaryDeformationFrame.inverseChestRadiusX = inverseChestRx
    secondaryDeformationFrame.inverseChestRadiusY = inverseChestRy
    secondaryDeformationFrame.chestOffsetX = chestOffsetX
    secondaryDeformationFrame.chestOffsetY = chestOffsetY
    writeAnime25DOpacityFrame(
      this.opacityFrame,
      e,
      this.activeMouthMaterial,
      this.sillyMouthShare,
    )
    for (const layer of this.layers) {
      layer.frameOpacity = fadeOpacityFromFrame(layer.source, this.opacityFrame)
    }
    const collarMotion = this.collarMotion
    collarMotion.angleX = e.angleX
    collarMotion.angleY = e.angleY
    collarMotion.headRotationCosine = cz
    collarMotion.headRotationSine = sz
    collarMotion.bodyBreathOffset = secondaryDeformationFrame.bodyBreathOffset
    collarMotion.headBreathOffset = secondaryDeformationFrame.headBreathOffset
    if (this.collarClip) {
      deformCollarClipMesh(this.collarClip, collarMotion, this.neckDepth)
      if (work) {
        work.deformedLayers += 1
        work.deformedVertices += this.collarClip.rest.length / 2
      }
    }
    for (const layer of this.layers) {
      if (!shouldDeformLayer(layer.source, layer.frameOpacity)) continue
      const rest = layer.rest
      const deformed = layer.deformed
      const vertexCount = rest.length / 2
      const source = layer.source
      const bn = layer.baseRole
      const isHead = source.group === 'head'
      if (layer.shaderGlobalTransform) {
        writeAnime25DLayerGlobalTransform(
          {
            headFollow: isHead
              ? 1
              : source.group === 'body'
                ? BODY_HEAD_FOLLOW
                : 0,
            headRotationCosine: cz,
            headRotationSine: sz,
            neckPivotX: npx,
            neckPivotY: npy,
            faceScale: fs,
            angleX: e.angleX,
            angleY: ay,
            depthOffset: source.depth - 1,
            faceCenterY: A.face.cy,
            specialOffsetY: isHead ? specialHeadOffset : 0,
            breathOffset: isHead
              ? secondaryDeformationFrame.headBreathOffset
              : secondaryDeformationFrame.bodyBreathOffset,
          },
          layer.layerTransform,
        )
      }
      if (!layer.localDynamic) {
        if (work) {
          work.shaderOnlyLayers += 1
          work.skippedVertices += vertexCount
          work.savedUploadBytes += deformed.byteLength
        }
        continue
      }
      if (work) {
        work.deformedLayers += 1
        work.deformedVertices += vertexCount
      }
      const upstreamFeature = layer.upstreamFeature
      const cryLayer = source.fade === 'eyeCry'
      const tearVertical = cryLayer
        ? cryTearVerticalOffset(t, source.side, e.eyeCry, fs)
        : 0
      const tearHorizontal = cryLayer
        ? cryTearHorizontalOffset(t, source.side, e.eyeCry, fs)
        : 0
      const mouthDeformation = layer.mouthDeformation
      if (layer.collarContact) {
        updateFrontCollarTargets(
          layer.collarContact,
          source.depth,
          this.neckDepth,
          collarMotion,
        )
      }
      let geometryChanged = false
      for (let vertex = 0; vertex < vertexCount; vertex += 1) {
        const index = vertex * 2
        const previousX = deformed[index]
        const previousY = deformed[index + 1]
        let x = rest[index]
        let y = rest[index + 1]
        if (upstreamFeature) {
          deformationPoint.x = x
          deformationPoint.y = y
          deformAnime25DUpstreamFeaturePoint(deformationPoint, upstreamFeature)
          x = deformationPoint.x
          y = deformationPoint.y
        }
        if (layer.expressionDeformation) {
          deformationPoint.x = x
          deformationPoint.y = y
          deformAnime25DExpressionPoint(
            deformationPoint,
            rest[index + 1],
            layer.expressionDeformation,
            tearHorizontal,
            tearVertical,
            deformationFrame,
          )
          x = deformationPoint.x
          y = deformationPoint.y
        }
        if (mouthDeformation) {
          deformationPoint.x = x
          deformationPoint.y = y
          deformAnime25DMouthPoint(
            deformationPoint,
            rest[index],
            rest[index + 1],
            source,
            deformationFrame,
            mouthDeformation,
          )
          x = deformationPoint.x
          y = deformationPoint.y
        }
        if (bn === 'face') {
          deformationPoint.x = x
          deformationPoint.y = y
          deformAnime25DFaceJawPoint(
            deformationPoint,
            rest[index + 1],
            deformationFrame,
          )
          x = deformationPoint.x
          y = deformationPoint.y
        }
        if (layer.collarContact) {
          deformRigidMlsPoint(
            rest[index],
            rest[index + 1],
            layer.collarContact.handles,
            layer.collarContact.targets,
            deformed,
            index,
          )
          x = deformed[index]
          y = deformed[index + 1]
        }
        deformationPoint.x = x
        deformationPoint.y = y
        deformAnime25DSecondaryPoint(
          deformationPoint,
          rest[index],
          rest[index + 1],
          vertex,
          layer.secondaryDeformation,
          secondaryDeformationFrame,
        )
        deformAnime25DHairPoint(
          deformationPoint,
          vertex,
          layer.secondaryDeformation,
          secondaryDeformationFrame,
        )
        x = deformationPoint.x
        y = deformationPoint.y
        if (x !== previousX || y !== previousY) {
          geometryChanged = true
          deformed[index] = x
          deformed[index + 1] = y
        }
      }
      if (!geometryChanged) {
        layer.geometryDirty = false
        if (work) work.savedUploadBytes += deformed.byteLength
        continue
      }
      layer.geometryDirty = true
    }
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

  private draw(work?: Anime25DFrameWork): void {
    this.renderFrame.time = this.time
    this.renderFrame.eyeCry = this.current.eyeCry
    drawAnime25DFrame(
      this.gl,
      this.program,
      this.rendererBindings,
      this.layers,
      this.atlasTexture,
      this.collarClip,
      this.renderFrame,
      work,
    )
  }
}
