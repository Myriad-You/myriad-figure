import type { PerformanceDirective } from '../../../services/agent/types'
import type { MeropeRigManifest } from '../rig/types'
import type { SingingSpectrumDrive } from '../singing/singingGroove'
import type {
  ChestDeformationRegion,
  ChestDynamicsTuning,
  ChestMotionGeometry,
  ChestWeightField,
} from './chestPhysics'
import type { FrontCollarContactModel } from './collarContact'
import type { CollarClipMesh, CollarMotionPose } from './collarRuntime'
import type { Anime25DDriver } from './driver'
import type {
  Anime25DBlinkState,
  Anime25DStylizedTargets,
} from './driverComposition'
import type {
  Anime25DExpressionDeformationBinding,
  Anime25DExpressionDeformationFrame,
} from './expressionDeformation'
import type { Anime25DHairSpringFrame } from './hairPhysics'
import type { Anime25DLayerSpringBinding } from './layerBinding'
import type { Anime25DUpstreamFeatureInput } from './layerDeformation'
import type { Anime25DLayerDeformationExtension } from './layerDeformationPolicy'
import type {
  Anime25DMouthDeformationFrame,
  Anime25DMouthDeformationKind,
} from './mouthDeformation'
import type { MouthMorphState } from './mouthRuntime'
import type { SpeechMouthMaterial } from './mouthTransition'
import type {
  Anime25DFrameWork,
  Anime25DPerformanceSnapshot,
} from './performanceTelemetry'
import type {
  Anime25DSecondaryDeformationBinding,
  Anime25DSecondaryDeformationFrame,
} from './secondaryDeformation'
import type { StylizedExpressionMotion } from './stylizedExpressionMotion'
import type { Anime25DPlayback, Anime25DPlaybackLayer } from './types'
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
  sampleChestWeight,
  stepChestSpring,
  topwearMotionAtChest,
} from './chestPhysics'
import {
  buildFrontCollarContactModel,
  deformRigidMlsPoint,
} from './collarContact'
import {
  BODY_HEAD_FOLLOW,
  createCollarClipMesh,
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
import {
  deformAnime25DExpressionPoint,
  resolveAnime25DExpressionDeformation,
} from './expressionDeformation'
import { applyExpressiveMotionEnvelope } from './expressiveMotionEnvelope'
import { stepAnime25DHairLayerSprings } from './hairPhysics'
import {
  createJawMotionState,
  jawMotionTarget,
  jawTravelPixels,
  stepJawMotion,
} from './jawMotion'
import { buildAnime25DLayerBinding } from './layerBinding'
import {
  bindAnime25DUpstreamFeature,
  deformAnime25DUpstreamFeaturePoint,
} from './layerDeformation'
import { resolveAnime25DLayerDeformationPolicy } from './layerDeformationPolicy'
import {
  writeAnime25DLayerGlobalTransform,
  writeIdentityLayerTransform,
} from './layerTransform'
import {
  deformAnime25DFaceJawPoint,
  deformAnime25DMouthPoint,
  resolveAnime25DMouthDeformation,
} from './mouthDeformation'
import {
  applyMouthTransitionBridge,
  fadeOpacity,
  resolveMouthMorph,
  shouldDeformLayer,
} from './mouthRuntime'
import { MouthTransitionController } from './mouthTransition'
import { PerformanceExpressionController } from './performanceExpression'
import {
  Anime25DPerformanceTelemetry,
  createAnime25DFrameWork,
} from './performanceTelemetry'
import { RandomActionController } from './randomAction'
import { resolveAnime25DRenderSurface } from './runtimePolicy'
import {
  createAnime25DSecondaryDeformationBinding,
  deformAnime25DHairPoint,
  deformAnime25DSecondaryPoint,
} from './secondaryDeformation'
import { CoSpeechExpressionController } from './speechExpression'
import { AutoSpeechController } from './speechMotion'
import { StylizedExpressionMotionController } from './stylizedExpressionMotion'
import { ThinkingMotionController } from './thinkingMotion'
import {
  compileProgram,
  createAtlasTexture,
  createIndexedDeformableMesh,
  loadImage,
  readLayerPixels,
  requiredUniform,
} from './webglRuntime'

interface SecondaryMotionPose {
  angleX: number
  angleY: number
  angleZ: number
  body: number
}

interface GpuLayer {
  source: Anime25DPlaybackLayer
  rest: Float32Array
  deformed: Float32Array
  cols: number
  rows: number
  vao: WebGLVertexArrayObject
  vertexBuffer: WebGLBuffer
  uvBuffer: WebGLBuffer
  indexBuffer: WebGLBuffer
  indexCount: number
  layerTransform: Float32Array
  shaderGlobalTransform: boolean
  localDynamic: boolean
  deformationExtensions: Anime25DLayerDeformationExtension[]
  upstreamFeature: Anime25DUpstreamFeatureInput | null
  mouthDeformation: Anime25DMouthDeformationKind | null
  expressionDeformation: Anime25DExpressionDeformationBinding | null
  secondaryDeformation: Anime25DSecondaryDeformationBinding
  frameOpacity: number
  chestWeights: Float32Array | null
  frontHair: boolean
  frontHairParallaxScale: Float32Array | null
  strandWeights: Float32Array | null
  alongStrand: Float32Array | null
  bangWeights: Float32Array | null
  springs: Anime25DLayerSpringBinding[] | null
  collarContact: FrontCollarContactModel | null
  geometryDirty: boolean
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
  private readonly viewLocation: WebGLUniformLocation
  private readonly layerTransformLocation: WebGLUniformLocation
  private readonly bodyTransformLocation: WebGLUniformLocation
  private readonly opacityLocation: WebGLUniformLocation
  private readonly cutLocation: WebGLUniformLocation
  private readonly cryTimeLocation: WebGLUniformLocation
  private readonly cryLocation: WebGLUniformLocation
  private readonly atlasRectLocation: WebGLUniformLocation
  private layers: GpuLayer[] = []
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
  private viewWidth = 1
  private viewHeight = 1
  private bodyPivotX = 0
  private bodyPivotY = 0
  private bodyRotationCosine = 1
  private bodyRotationSine = 0

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
    this.viewLocation = requiredUniform(gl, this.program, 'u_view')
    this.layerTransformLocation = requiredUniform(
      gl,
      this.program,
      'u_layer_transform',
    )
    this.bodyTransformLocation = requiredUniform(
      gl,
      this.program,
      'u_body_transform',
    )
    this.opacityLocation = requiredUniform(gl, this.program, 'u_opacity')
    this.cutLocation = requiredUniform(gl, this.program, 'u_cut')
    this.cryTimeLocation = requiredUniform(gl, this.program, 'u_cry_time')
    this.cryLocation = requiredUniform(gl, this.program, 'u_cry')
    this.atlasRectLocation = requiredUniform(gl, this.program, 'u_atlas_rect')
    gl.useProgram(this.program)
    gl.uniform1i(requiredUniform(gl, this.program, 'u_texture'), 0)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1)
  }

  async loadAtlas(url: string): Promise<void> {
    const image = await loadImage(url)
    this.atlasTexture = createAtlasTexture(this.gl, image)
    this.layers = this.playback.layers.map((layer, index) =>
      this.createLayer(layer, image, index),
    )
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
    this.viewWidth = pixelWidth
    this.viewHeight = pixelHeight
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
    this.bodyPivotX = bpx
    this.bodyPivotY = bpy
    this.bodyRotationCosine = cb
    this.bodyRotationSine = sb
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
    resolveMouthMorph(this.layers, e, A.mouth, A.face, this.mouthMorph)
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
    for (const layer of this.layers) {
      layer.frameOpacity = fadeOpacity(
        layer.source,
        e,
        this.activeMouthMaterial,
        this.sillyMouthShare,
      )
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
      const bn = layerBaseName(source.role)
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
    const { gl } = this
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT)
    gl.useProgram(this.program)
    gl.uniform2f(this.viewLocation, this.viewWidth, this.viewHeight)
    gl.uniform4f(
      this.bodyTransformLocation,
      this.bodyPivotX,
      this.bodyPivotY,
      this.bodyRotationCosine,
      this.bodyRotationSine,
    )
    gl.uniform1f(this.cryTimeLocation, this.time)
    gl.activeTexture(gl.TEXTURE0)
    if (!this.atlasTexture) return
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture)
    for (const layer of this.layers) {
      const opacity = layer.frameOpacity
      const eyewhite =
        layer.source.name.startsWith('eyewhite') ||
        layer.source.role === 'eye-silly-white'
      const iris =
        layer.source.name.startsWith('irides') ||
        layer.source.role === 'iris-silly' ||
        layer.source.role === 'lovestruck-heart'
      // Only the authored sclera has to keep defining the iris clip while it
      // is invisible; the silly frame costs a draw and a stencil write, so it
      // leaves the buffer alone whenever the expression is down.
      if (opacity < 0.004 && !layer.source.name.startsWith('eyewhite')) continue
      if (work) {
        work.drawnLayers += 1
        work.drawCalls +=
          layer.source.role === 'neck' && this.collarClip ? 2 : 1
      }
      gl.uniformMatrix3fv(
        this.layerTransformLocation,
        false,
        layer.layerTransform,
      )
      const crying = layer.source.fade === 'eyeCry'
      const crySide = layer.source.side === 'L' ? -1 : 1
      gl.uniform1f(this.opacityLocation, opacity)
      gl.uniform1f(this.cryLocation, crying ? crySide * this.current.eyeCry : 0)
      gl.uniform4f(
        this.atlasRectLocation,
        layer.source.atlas.x,
        layer.source.atlas.y,
        layer.source.atlas.w,
        layer.source.atlas.h,
      )
      gl.bindVertexArray(layer.vao)
      if (layer.source.role === 'neck' && this.collarClip) {
        gl.enable(gl.STENCIL_TEST)
        gl.stencilMask(255)
        gl.stencilFunc(gl.ALWAYS, 1, 255)
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE)
        gl.colorMask(false, false, false, false)
        gl.uniform1f(this.opacityLocation, 1)
        gl.uniform1f(this.cryLocation, 0)
        gl.uniform1f(this.cutLocation, 0)
        gl.bindVertexArray(this.collarClip.vao)
        gl.drawElements(
          gl.TRIANGLES,
          this.collarClip.indexCount,
          gl.UNSIGNED_SHORT,
          0,
        )
        gl.colorMask(true, true, true, true)
        gl.stencilMask(0)
        gl.stencilFunc(gl.EQUAL, 1, 255)
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP)
        gl.uniform1f(this.opacityLocation, opacity)
        gl.bindVertexArray(layer.vao)
        gl.drawElements(gl.TRIANGLES, layer.indexCount, gl.UNSIGNED_SHORT, 0)
        gl.stencilMask(255)
        gl.disable(gl.STENCIL_TEST)
      } else if (eyewhite) {
        gl.enable(gl.STENCIL_TEST)
        gl.stencilFunc(gl.ALWAYS, 1, 255)
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE)
        gl.uniform1f(this.cutLocation, 0.25)
        gl.drawElements(gl.TRIANGLES, layer.indexCount, gl.UNSIGNED_SHORT, 0)
        gl.disable(gl.STENCIL_TEST)
        gl.uniform1f(this.cutLocation, 0)
      } else if (iris) {
        gl.enable(gl.STENCIL_TEST)
        gl.stencilFunc(gl.EQUAL, 1, 255)
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP)
        gl.uniform1f(this.cutLocation, 0)
        gl.drawElements(gl.TRIANGLES, layer.indexCount, gl.UNSIGNED_SHORT, 0)
        gl.disable(gl.STENCIL_TEST)
      } else {
        gl.uniform1f(this.cutLocation, 0)
        gl.drawElements(gl.TRIANGLES, layer.indexCount, gl.UNSIGNED_SHORT, 0)
      }
    }
    gl.bindVertexArray(null)
  }

  private createLayer(
    source: Anime25DPlaybackLayer,
    atlasImage: HTMLImageElement,
    layerIndex: number,
  ): GpuLayer {
    const cropped =
      source.role === 'collar-front'
        ? readLayerPixels(atlasImage, source)
        : null
    const collarContact = cropped?.pixels
      ? buildFrontCollarContactModel(
          cropped.pixels,
          cropped.width,
          cropped.height,
          source,
          this.playback.anchors.neckPivot.x,
        )
      : null
    const binding = buildAnime25DLayerBinding({
      source,
      canvasWidth: this.playback.pixelCanvas.width,
      face: this.playback.anchors.face,
      layerZ:
        typeof source.z === 'number' && Number.isFinite(source.z)
          ? source.z
          : layerIndex,
      extraGridX: collarContact?.gridX,
      extraGridY: collarContact?.gridY,
    })
    const {
      rest,
      atlasUvs,
      indices,
      cols,
      rows,
      extensions: _extensions,
      ...hair
    } = binding
    const { gl } = this
    const mesh = createIndexedDeformableMesh(
      gl,
      this.program,
      rest,
      atlasUvs,
      indices,
    )
    const chestWeights =
      source.role === 'topwear' && this.chestWeightField
        ? samplePlaybackChestWeights(
            this.chestWeightField,
            rest,
            this.playback.pixelCanvas.width,
          )
        : null
    const baseRole = layerBaseName(source.role)
    const deformationPolicy = resolveAnime25DLayerDeformationPolicy({
      baseRole,
      fade: source.fade,
      hairPhysics: source.phys === 'hair',
      hasBangWeights: Boolean(hair.bangWeights),
      hasFrontHairParallax: Boolean(hair.frontHairParallaxScale),
      hasCollarContact: Boolean(collarContact),
    })
    const eye =
      source.side === 'L'
        ? this.playback.anchors.eyeL
        : source.side === 'R'
          ? this.playback.anchors.eyeR
          : undefined
    const expressionDeformationKind = resolveAnime25DExpressionDeformation(
      source,
      Boolean(eye),
    )
    const expressionDeformation = expressionDeformationKind
      ? {
          kind: expressionDeformationKind,
          source,
          eye,
          centerX: source.x + source.w / 2,
          centerY: source.y + source.h / 2,
        }
      : null
    const secondaryDeformation = createAnime25DSecondaryDeformationBinding({
      source,
      baseRole,
      shaderGlobalTransform: deformationPolicy.shaderGlobalTransform,
      collarContact: Boolean(collarContact),
      frontHair: hair.frontHair,
      frontHairParallaxScale: hair.frontHairParallaxScale,
      chestWeights,
      bangWeights: hair.bangWeights,
      strandWeights: hair.strandWeights,
      alongStrand: hair.alongStrand,
      springs: hair.springs,
    })
    const layerTransform = new Float32Array(9)
    writeIdentityLayerTransform(layerTransform)
    if (collarContact && !this.collarClip) {
      const neck = this.playback.layers.find((layer) => layer.role === 'neck')
      if (neck) {
        this.collarClip = createCollarClipMesh(
          gl,
          this.program,
          collarContact,
          neck,
          source,
        )
      }
    }
    return {
      source,
      rest,
      deformed: deformationPolicy.localDynamic ? rest.slice() : rest,
      cols,
      rows,
      vao: mesh.vao,
      vertexBuffer: mesh.positionBuffer,
      uvBuffer: mesh.uvBuffer,
      indexBuffer: mesh.indexBuffer,
      indexCount: indices.length,
      layerTransform,
      ...deformationPolicy,
      upstreamFeature: bindAnime25DUpstreamFeature(
        source,
        eye,
        this.playback.anchors.faceScale,
        this.current,
      ),
      mouthDeformation: resolveAnime25DMouthDeformation(source.fade),
      expressionDeformation,
      secondaryDeformation,
      frameOpacity: source.fade ? 0 : 1,
      chestWeights,
      ...hair,
      collarContact,
      geometryDirty: false,
    }
  }
}

function samplePlaybackChestWeights(
  field: ChestWeightField,
  rest: Float32Array,
  frameWidth: number,
): Float32Array {
  const scale = Math.max(1, frameWidth)
  const weights = new Float32Array(rest.length / 2)
  for (let vertex = 0; vertex < weights.length; vertex += 1) {
    weights[vertex] = sampleChestWeight(
      field,
      rest[vertex * 2] / scale,
      rest[vertex * 2 + 1] / scale,
    )
  }
  return weights
}

function layerBaseName(role: string): string {
  if (role === 'front-hair') return 'front hair'
  if (role === 'back-hair') return 'back hair'
  return role.replace(/-/g, '_')
}
