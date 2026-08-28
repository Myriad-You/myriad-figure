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
import type { HairSpringState } from './hairPhysics'
import type { MouthMorphState } from './mouthRuntime'
import type { SpeechMouthMaterial } from './mouthTransition'
import type { StylizedExpressionMotion } from './stylizedExpressionMotion'
import type { Anime25DPlayback, Anime25DPlaybackLayer } from './types'
import { currentCopy } from '../../../i18n/localeCopy'
import { cryEyeDisplayScale } from '../rig/cryEye'
import { dizzyEyeDisplayScale } from '../rig/dizzyEye'
import { squeezeEyeDisplayScale } from '../rig/squeezeEye'
import {
  applySingingGroove,
  singingDriveAmount,
  SingingGrooveController,
} from '../singing/singingGroove'
import { AmbientMotionController } from './ambientMotion'
import { localToAtlasUv } from './atlasUv'
import {
  buildChestWeightField,
  chestDeformationWeight,
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
  FRONT_COLLAR_FLEX_REGION,
  FRONT_COLLAR_HEAD_FOLLOW,
  FRONT_COLLAR_INNER_REGION,
  HIGH_COLLAR_NECK_FOLLOW_POWER,
  updateCollarClipMesh,
  updateFrontCollarTargets,
} from './collarRuntime'
import {
  cryTearHorizontalOffset,
  cryTearVerticalOffset,
  sampleCryMouthMotion,
} from './cryMotion'
import { IDENTITY_DRIVER, sanitizeDriverPatch } from './driver'
import { applyExpressiveMotionEnvelope } from './expressiveMotionEnvelope'
import {
  frontHairUpperParallaxScale,
  hairStrandDynamics,
  stepHairSpring,
} from './hairPhysics'
import {
  createJawMotionState,
  jawMotionTarget,
  jawTravelPixels,
  stepJawMotion,
} from './jawMotion'
import {
  applyMouthTransitionBridge,
  fadeOpacity,
  resolveMouthMorph,
  shouldDeformLayer,
} from './mouthRuntime'
import { MouthTransitionController } from './mouthTransition'
import {
  applyPerformanceExpressionOffset,
  mixBoundedExpressionChannel,
  mixEyeOpen,
  PerformanceExpressionController,
} from './performanceExpression'
import { applyRandomActionFrame, RandomActionController } from './randomAction'
import { CoSpeechExpressionController } from './speechExpression'
import { AutoSpeechController } from './speechMotion'
import {
  stepMouthForm,
  stepMouthOpen,
  stepMouthSeal,
  stepMouthShape,
} from './speechResponse'
import { StylizedExpressionMotionController } from './stylizedExpressionMotion'
import { ThinkingMotionController } from './thinkingMotion'
import { createPackedVertices, packVerticesInto } from './vertexPacking'
import {
  compileProgram,
  createAtlasTexture,
  loadImage,
  readLayerPixels,
  requiredUniform,
} from './webglRuntime'

const NECK_MESH_CELL = 28
const FRONT_COLLAR_MESH_CELL = 22

interface HairStrandSpring {
  stiff: HairSpringState
  soft: HairSpringState
  phase: number
  stiffnessScale: number
  dampingScale: number
}

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
  uvs: Float32Array
  packedVertices: Float32Array
  indices: Uint16Array
  cols: number
  rows: number
  vao: WebGLVertexArrayObject
  vertexBuffer: WebGLBuffer
  indexBuffer: WebGLBuffer
  indexCount: number
  frameOpacity: number
  chestWeights: Float32Array | null
  frontHair: boolean
  frontHairParallaxScale: Float32Array | null
  strandWeights: Float32Array | null
  alongStrand: Float32Array | null
  bangWeights: Float32Array | null
  springs: HairStrandSpring[] | null
  collarContact: FrontCollarContactModel | null
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
  current: Anime25DDriver
}

export class Anime25DPlayer {
  private readonly gl: WebGL2RenderingContext
  private readonly playback: Anime25DPlayback
  private readonly program: WebGLProgram
  private readonly viewLocation: WebGLUniformLocation
  private readonly opacityLocation: WebGLUniformLocation
  private readonly cutLocation: WebGLUniformLocation
  private readonly cryTimeLocation: WebGLUniformLocation
  private readonly cryLocation: WebGLUniformLocation
  private readonly atlasRectLocation: WebGLUniformLocation
  private layers: GpuLayer[] = []
  private atlasTexture: WebGLTexture | null = null
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

  private readonly mouthTransition: MouthTransitionController
  private activeMouthMaterial: SpeechMouthMaterial = 'mouthClose'
  private sillyMouthShare = 1

  private time = 0
  private blinkT = -1
  private nextBlink = 1.8
  private readonly ambientMotion = new AmbientMotionController()
  private readonly randomAction = new RandomActionController()
  private readonly singingGroove = new SingingGrooveController()
  private singingDrive: SingingSpectrumDrive | null = null
  private singingDeform = 0
  private readonly thinkingMotion = new ThinkingMotionController()
  private readonly stylizedExpression = new StylizedExpressionMotionController()
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
    this.program = compileProgram(gl)
    this.viewLocation = requiredUniform(gl, this.program, 'u_view')
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
    this.blinkT = 0
    this.nextBlink = this.time + 1.6 + Math.random() * 3.8
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
      current: this.getCurrent(),
    }
  }

  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void {
    const dpr = Math.max(1, Math.min(2, devicePixelRatio))
    const { width: pixelWidth, height: pixelHeight } = this.playback.pixelCanvas
    const canvas = this.gl.canvas
    const bufferWidth = Math.max(1, Math.round(pixelWidth * dpr))
    const bufferHeight = Math.max(1, Math.round(pixelHeight * dpr))
    if (canvas instanceof HTMLCanvasElement) {
      canvas.width = bufferWidth
      canvas.height = bufferHeight
      const scale = Math.min(
        Math.max(1, cssWidth) / pixelWidth,
        Math.max(1, cssHeight) / pixelHeight,
      )
      canvas.style.width = `${pixelWidth * scale}px`
      canvas.style.height = `${pixelHeight * scale}px`
    }
    this.viewWidth = pixelWidth
    this.viewHeight = pixelHeight
    this.gl.viewport(0, 0, bufferWidth, bufferHeight)
  }

  tick(deltaSeconds: number): void {
    if (this.disposed || this.layers.length === 0) return
    const dt = Math.min(0.05, Math.max(0.001, deltaSeconds))
    this.time += dt
    this.smoothDriver(dt)
    this.updateSprings(dt)
    this.deform()
    this.draw()
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
      gl.deleteBuffer(layer.indexBuffer)
      gl.deleteVertexArray(layer.vao)
    }
    if (this.atlasTexture) gl.deleteTexture(this.atlasTexture)
    this.atlasTexture = null
    if (this.collarClip) {
      gl.deleteBuffer(this.collarClip.vertexBuffer)
      gl.deleteBuffer(this.collarClip.indexBuffer)
      gl.deleteVertexArray(this.collarClip.vao)
      this.collarClip = null
    }
    gl.deleteProgram(this.program)
    this.layers = []
  }

  private smoothDriver(dt: number): void {
    const t = this.time
    const tgt = Object.assign(this.workingTarget, this.target)
    if (this.target.mouse && this.mouse.inside) {
      tgt.angleX = clamp(this.mouse.x * 0.9, -1, 1)
      tgt.angleY = clamp(-this.mouse.y * 0.7, -1, 1)
      tgt.eyeX = clamp(this.mouse.x * 1.2, -1, 1)
      tgt.eyeY = clamp(-this.mouse.y * 0.8, -1, 1)
    }
    if (this.target.idle) {
      tgt.angleX += 0.13 * Math.sin(t * 0.42) + 0.05 * Math.sin(t * 1.13)
      tgt.angleY += 0.08 * Math.sin(t * 0.31 + 1.7)
      tgt.angleZ += 0.07 * Math.sin(t * 0.23 + 0.5)
      tgt.body += 0.1 * Math.sin(t * 0.19 + 2.1)
    }
    const semanticExpression = this.performanceExpression.sample(
      this.performanceClockSeconds(),
    )
    const specialEyeBlocker =
      1 -
      Math.max(
        mixBoundedExpressionChannel(
          tgt.eyeDizzy,
          semanticExpression.eyeDizzy,
          0,
          1,
          0,
        ),
        mixBoundedExpressionChannel(
          tgt.eyeSqueeze,
          semanticExpression.eyeSqueeze,
          0,
          1,
          0,
        ),
        mixBoundedExpressionChannel(
          tgt.eyeCry,
          semanticExpression.eyeCry,
          0,
          1,
          0,
        ),
      )
    const angerTarget =
      mixBoundedExpressionChannel(
        tgt.anger,
        semanticExpression.anger ?? 0,
        0,
        1,
        0,
      ) * specialEyeBlocker
    const speechlessTarget =
      mixBoundedExpressionChannel(
        tgt.speechless,
        semanticExpression.speechless ?? 0,
        0,
        1,
        0,
      ) * specialEyeBlocker
    const maniacTarget =
      mixBoundedExpressionChannel(
        tgt.maniac,
        semanticExpression.maniac ?? 0,
        0,
        1,
        0,
      ) * specialEyeBlocker
    const sillyTarget =
      mixBoundedExpressionChannel(
        tgt.silly,
        semanticExpression.silly ?? 0,
        0,
        1,
        0,
      ) * specialEyeBlocker
    const lovestruckTarget =
      mixBoundedExpressionChannel(
        tgt.lovestruck,
        semanticExpression.lovestruck ?? 0,
        0,
        1,
        0,
      ) * specialEyeBlocker
    const stylized = this.stylizedExpression.sample(
      t,
      angerTarget,
      speechlessTarget,
      maniacTarget,
      sillyTarget,
      lovestruckTarget,
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
      angerTarget > 0.03 ||
      speechlessTarget > 0.03 ||
      maniacTarget > 0.03 ||
      sillyTarget > 0.03 ||
      lovestruckTarget > 0.03
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
        angerTarget <= 0.03 &&
        speechlessTarget <= 0.03 &&
        maniacTarget <= 0.03 &&
        sillyTarget <= 0.03 &&
        lovestruckTarget <= 0.03,
    )
    const ambientScale =
      performanceMotionScale * randomAction.ambientScale * stylized.ambientScale
    const headKeep = 1 - 0.88 * this.singingDeform
    tgt.angleX = clamp(
      tgt.angleX + ambient.angleX * ambientScale * headKeep,
      -1,
      1,
    )
    tgt.angleY = clamp(
      tgt.angleY + ambient.angleY * ambientScale * headKeep,
      -1,
      1,
    )
    tgt.angleZ = clamp(
      tgt.angleZ + ambient.angleZ * ambientScale * headKeep,
      -1,
      1,
    )
    tgt.body = clamp(tgt.body + ambient.body * ambientScale * headKeep, -1, 1)
    tgt.eyeX = clamp(tgt.eyeX + ambient.eyeX * ambientScale, -1, 1)
    tgt.eyeY = clamp(tgt.eyeY + ambient.eyeY * ambientScale, -1, 1)
    applyRandomActionFrame(
      tgt,
      randomAction,
      performanceMotionScale * stylized.ambientScale,
    )
    applySingingGroove(tgt, groove, this.singingDeform)
    tgt.angleX = mixBoundedExpressionChannel(
      tgt.angleX,
      thinking.angleX,
      -1,
      1,
      0,
    )
    tgt.angleY = mixBoundedExpressionChannel(
      tgt.angleY,
      thinking.angleY,
      -1,
      1,
      0,
    )
    tgt.angleZ = mixBoundedExpressionChannel(
      tgt.angleZ,
      thinking.angleZ,
      -1,
      1,
      0,
    )
    tgt.eyeX = mixBoundedExpressionChannel(tgt.eyeX, thinking.eyeX, -1, 1, 0)
    tgt.eyeY = mixBoundedExpressionChannel(tgt.eyeY, thinking.eyeY, -1, 1, 0)
    tgt.brow = mixBoundedExpressionChannel(tgt.brow, thinking.brow, -1, 1, 0)
    tgt.mouthCY = mixBoundedExpressionChannel(
      tgt.mouthCY,
      thinking.mouthCY,
      -1,
      1,
      0,
    )
    tgt.mouthCAng = mixBoundedExpressionChannel(
      tgt.mouthCAng,
      thinking.mouthCAng,
      -1,
      1,
      0,
    )
    tgt.mouthScale = mixBoundedExpressionChannel(
      tgt.mouthScale,
      thinking.mouthScale,
      0.5,
      1.5,
      1,
    )
    applyPerformanceExpressionOffset(tgt, semanticExpression)
    tgt.brow = mixBoundedExpressionChannel(tgt.brow, stylized.brow, -1, 1, 0)
    tgt.browAngL = mixBoundedExpressionChannel(
      tgt.browAngL,
      stylized.browAngL,
      -1,
      1,
      0,
    )
    tgt.browAngR = mixBoundedExpressionChannel(
      tgt.browAngR,
      stylized.browAngR,
      -1,
      1,
      0,
    )
    tgt.browAngSym = mixBoundedExpressionChannel(
      tgt.browAngSym,
      stylized.browAngSym,
      -1,
      1,
      0,
    )
    tgt.eyeOpenL = mixEyeOpen(tgt.eyeOpenL, stylized.eyeOpen)
    tgt.eyeOpenR = mixEyeOpen(tgt.eyeOpenR, stylized.eyeOpen)
    tgt.eyeX = mixBoundedExpressionChannel(tgt.eyeX, stylized.eyeX, -1, 1, 0)
    tgt.eyeY = mixBoundedExpressionChannel(tgt.eyeY, stylized.eyeY, -1, 1, 0)
    tgt.irisScale = mixBoundedExpressionChannel(
      tgt.irisScale,
      stylized.irisScale,
      0.5,
      1.3,
      1,
    )
    tgt.mouthForm = mixBoundedExpressionChannel(
      tgt.mouthForm,
      stylized.mouthForm,
      -1,
      1,
      0,
    )
    tgt.mouthOpen = Math.max(tgt.mouthOpen, stylized.mouthOpen)
    const lovestruckMouthShare = speaking ? 0.18 : 1
    tgt.mouthOpen = Math.max(
      tgt.mouthOpen,
      stylized.lovestruckMouthOpen * lovestruckMouthShare,
    )
    tgt.mouthRound = Math.max(
      tgt.mouthRound,
      stylized.lovestruckMouthRound * lovestruckMouthShare,
    )
    tgt.mouthCY = mixBoundedExpressionChannel(
      tgt.mouthCY,
      stylized.mouthCY,
      -1,
      1,
      0,
    )
    tgt.mouthCAng = mixBoundedExpressionChannel(
      tgt.mouthCAng,
      stylized.mouthCAng,
      -1,
      1,
      0,
    )
    tgt.mouthScale = mixBoundedExpressionChannel(
      tgt.mouthScale,
      stylized.mouthScale +
        stylized.lovestruckMouthScale * lovestruckMouthShare,
      0.5,
      1.5,
      1,
    )
    tgt.angleX = mixBoundedExpressionChannel(
      tgt.angleX,
      stylized.angleX,
      -1,
      1,
      0,
    )
    tgt.angleY = mixBoundedExpressionChannel(
      tgt.angleY,
      stylized.angleY,
      -1,
      1,
      0,
    )
    tgt.angleZ = mixBoundedExpressionChannel(
      tgt.angleZ,
      stylized.angleZ,
      -1,
      1,
      0,
    )
    tgt.body = mixBoundedExpressionChannel(tgt.body, stylized.body, -1, 1, 0)
    const cryResponseRate = tgt.eyeCry > this.current.eyeCry ? 6 : 4.5
    const cryAmount = clamp(
      this.current.eyeCry +
        (tgt.eyeCry - this.current.eyeCry) *
          (1 - Math.exp(-cryResponseRate * dt)),
      0,
      1,
    )
    sampleCryMouthMotion(cryAmount, t, this.cryMouth)
    tgt.mouthOpen = Math.max(tgt.mouthOpen, this.cryMouth.mouthOpen)
    tgt.mouthForm = mixBoundedExpressionChannel(
      tgt.mouthForm,
      this.cryMouth.mouthForm,
      -1,
      1,
      0,
    )
    tgt.mouthCY = mixBoundedExpressionChannel(
      tgt.mouthCY,
      this.cryMouth.mouthCY,
      -1,
      1,
      0,
    )
    tgt.mouthScale = mixBoundedExpressionChannel(
      tgt.mouthScale,
      this.cryMouth.mouthScale,
      0.5,
      1.5,
      1,
    )
    if (
      speech.mouthOpen > 0 ||
      speech.mouthWide > 0 ||
      speech.mouthRound > 0 ||
      speech.mouthNarrow > 0 ||
      speech.mouthSeal > 0
    ) {
      tgt.mouthOpen = Math.max(tgt.mouthOpen, speech.mouthOpen)
      tgt.mouthWide = Math.max(tgt.mouthWide, speech.mouthWide)
      tgt.mouthRound = Math.max(tgt.mouthRound, speech.mouthRound)
      tgt.mouthNarrow = Math.max(tgt.mouthNarrow, speech.mouthNarrow)
      tgt.mouthSeal = Math.max(tgt.mouthSeal, speech.mouthSeal)
    }
    const speechExpression = this.speechExpression.sample(
      t,
      speaking,
      this.speechActive && !this.target.talk ? tgt.mouthOpen : null,
      speech.phraseActivity,
      speech.browAccent,
      speech.headAccent,
    )
    tgt.brow = mixBoundedExpressionChannel(
      tgt.brow,
      speechExpression.brow,
      -1,
      1,
      0,
    )
    tgt.eyeOpenL = mixEyeOpen(tgt.eyeOpenL, speechExpression.eyeOpen)
    tgt.eyeOpenR = mixEyeOpen(tgt.eyeOpenR, speechExpression.eyeOpen)
    tgt.angleY = mixBoundedExpressionChannel(
      tgt.angleY,
      speechExpression.angleY,
      -1,
      1,
      0,
    )
    // The omega mouth only takes over once the character has stopped talking;
    // a cue landing mid-delivery would otherwise freeze the lip sync.
    this.sillyMouthShare +=
      ((speaking ? 0 : 1) - this.sillyMouthShare) * (1 - Math.exp(-7 * dt))
    const sillyMouthOwnership = smoothstep(sillyTarget) * this.sillyMouthShare
    if (sillyMouthOwnership > 0) {
      const retained = 1 - sillyMouthOwnership
      tgt.mouthOpen *= retained
      tgt.mouthWide *= retained
      tgt.mouthRound *= retained
      tgt.mouthNarrow *= retained
      tgt.mouthSeal *= retained
    }
    this.secondaryTarget.angleX = tgt.angleX
    this.secondaryTarget.angleY = tgt.angleY
    this.secondaryTarget.angleZ = tgt.angleZ
    this.secondaryTarget.body = tgt.body
    applyExpressiveMotionEnvelope(tgt, semanticExpression, speechExpression)
    if (maniacTarget > 0.03 || sillyTarget > 0.03) {
      this.blinkT = -1
      this.nextBlink = this.time + 1.8
    } else if (this.target.blink) {
      if (this.blinkT < 0 && this.time > this.nextBlink) {
        this.blinkT = 0
        this.nextBlink = this.time + 1.6 + Math.random() * 3.8
        if (Math.random() < 0.18) this.nextBlink = this.time + 0.28
      }
      if (this.blinkT >= 0) {
        this.blinkT += dt
        const elapsed = this.blinkT
        let open = 1
        if (elapsed < 0.08) {
          open = 1 - elapsed / 0.08
        } else if (elapsed < 0.42) {
          open = 0
        } else if (elapsed < 0.58) {
          open = (elapsed - 0.42) / 0.16
        } else {
          open = 1
          this.blinkT = -1
        }
        tgt.eyeOpenL = Math.min(tgt.eyeOpenL, open)
        tgt.eyeOpenR = Math.min(tgt.eyeOpenR, open)
      }
    }
    const rate = Math.min(1, dt * 14)
    const flags = [
      'idle',
      'blink',
      'rand',
      'thinking',
      'singing',
      'talk',
      'mouse',
      'phys',
    ] as const
    for (const key of Object.keys(IDENTITY_DRIVER) as Array<
      keyof Anime25DDriver
    >) {
      if (flags.includes(key as (typeof flags)[number])) {
        this.current[key] = this.target[key] as never
        continue
      }
      const from = this.current[key] as number
      const to = tgt[key] as number
      if (key === 'mouthOpen') {
        this.current.mouthOpen = stepMouthOpen(from, to, dt)
        continue
      }
      if (key === 'mouthForm') {
        this.current.mouthForm = stepMouthForm(from, to, dt)
        continue
      }
      if (key === 'mouthSeal') {
        this.current.mouthSeal = stepMouthSeal(from, to, dt)
        continue
      }
      if (
        key === 'mouthWide' ||
        key === 'mouthRound' ||
        key === 'mouthNarrow'
      ) {
        this.current[key] = stepMouthShape(from, to, dt)
        continue
      }
      if (key === 'eyeCry') {
        const response = to > from ? 6 : 4.5
        this.current.eyeCry =
          from + (to - from) * (1 - Math.exp(-response * dt))
        continue
      }
      if (key === 'maniac') {
        const response = to > from ? 7.2 : 4.4
        this.current.maniac =
          from + (to - from) * (1 - Math.exp(-response * dt))
        continue
      }
      if (key === 'silly') {
        const response = to > from ? 7 : 4.2
        this.current.silly = from + (to - from) * (1 - Math.exp(-response * dt))
        continue
      }
      if (key === 'lovestruck') {
        const response = to > from ? 6.6 : 3.8
        this.current.lovestruck =
          from + (to - from) * (1 - Math.exp(-response * dt))
        continue
      }
      ;(this.current[key] as number) = from + (to - from) * rate
    }
    this.secondaryCurrent.angleX +=
      (this.secondaryTarget.angleX - this.secondaryCurrent.angleX) * rate
    this.secondaryCurrent.angleY +=
      (this.secondaryTarget.angleY - this.secondaryCurrent.angleY) * rate
    this.secondaryCurrent.angleZ +=
      (this.secondaryTarget.angleZ - this.secondaryCurrent.angleZ) * rate
    this.secondaryCurrent.body +=
      (this.secondaryTarget.body - this.secondaryCurrent.body) * rate
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
    if (!e.phys) return
    const headDX =
      (secondary.angleX * 14 +
        secondary.angleZ * 0.07 * (anchors.neckPivot.y - anchors.face.cy)) *
      faceScale
    const time = this.time
    const windAmp = e.idle ? 1 : 0
    for (const layer of this.layers) {
      if (!layer.springs) continue
      for (const spring of layer.springs) {
        const wind =
          windAmp *
          (1.8 * Math.sin(time * 0.8 + spring.phase) +
            1.0 * Math.sin(time * 1.9 + spring.phase * 2.3))
        const target = headDX + wind * faceScale
        stepHairSpring(
          spring.stiff,
          target,
          70 * spring.stiffnessScale,
          9 * spring.dampingScale,
          2.2,
          dt,
        )
        stepHairSpring(
          spring.soft,
          target,
          16 * spring.stiffnessScale,
          1.3 * spring.dampingScale,
          3,
          dt,
        )
      }
    }
  }

  private deform(): void {
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
    const chestProfile = this.playback.chestProfile
    const chestCx = this.chestRegion.centerX
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
    const mHalfW = (A.mouth.x1 - A.mouth.x0) / 2
    const mouthTransition = this.mouthTransition.sample(e)
    this.activeMouthMaterial = mouthTransition.material
    resolveMouthMorph(this.layers, e, A.mouth, A.face, this.mouthMorph)
    applyMouthTransitionBridge(this.mouthMorph, mouthTransition)
    const mouthMorph = this.mouthMorph
    for (const layer of this.layers) {
      layer.frameOpacity = fadeOpacity(
        layer.source,
        e,
        this.activeMouthMaterial,
        this.sillyMouthShare,
      )
    }
    const neckFollowTop = Math.min(
      A.neckBottom - 1,
      Math.max(A.neckTop, A.face.y1 + fs * 5),
    )
    const neckFollowSpan = Math.max(1, A.neckBottom - neckFollowTop)
    const bodyBreathOffset = breath * 2.0
    const headBreathOffset = breathHead * 1.6
    const collarMotion: CollarMotionPose = {
      neckPivotX: npx,
      neckPivotY: npy,
      neckFollowTop,
      neckFollowSpan,
      faceCenterY: A.face.cy,
      faceScale: fs,
      angleX: e.angleX,
      angleY: e.angleY,
      headRotationCosine: cz,
      headRotationSine: sz,
      bodyBreathOffset,
      headBreathOffset,
    }
    if (this.collarClip) {
      updateCollarClipMesh(
        this.gl,
        this.collarClip,
        collarMotion,
        this.neckDepth,
        bpx,
        bpy,
        cb,
        sb,
      )
    }
    for (const layer of this.layers) {
      if (!shouldDeformLayer(layer.source, layer.frameOpacity)) continue
      const rest = layer.rest
      const deformed = layer.deformed
      const vertexCount = rest.length / 2
      const source = layer.source
      const bn = layerBaseName(source.role)
      const isTopwear = bn === 'topwear'
      const isFrontCollar = bn === 'collar_front'
      const eye =
        source.side === 'L' ? A.eyeL : source.side === 'R' ? A.eyeR : undefined
      const vOpen = source.side === 'L' ? e.eyeOpenL : e.eyeOpenR
      const bcx = source.x + source.w / 2
      const bcy = source.y + source.h / 2
      const cryLayer = source.fade === 'eyeCry'
      const tearVertical = cryLayer
        ? cryTearVerticalOffset(t, source.side, e.eyeCry, fs)
        : 0
      const tearHorizontal = cryLayer
        ? cryTearHorizontalOffset(t, source.side, e.eyeCry, fs)
        : 0
      const isHead = source.group === 'head'
      const nS = layer.springs?.length ?? 0
      const morphingMouth =
        source.fade === 'mouthOpen' ||
        source.fade === 'mouthWide' ||
        source.fade === 'mouthRound' ||
        source.fade === 'mouthNarrow' ||
        source.fade === 'mouthClose' ||
        source.fade === 'mouthManiac' ||
        source.fade === 'mouthSilly'
      if (layer.collarContact) {
        updateFrontCollarTargets(
          layer.collarContact,
          source.depth,
          this.neckDepth,
          collarMotion,
        )
      }
      for (let vertex = 0; vertex < vertexCount; vertex += 1) {
        const index = vertex * 2
        let x = rest[index]
        let y = rest[index + 1]
        if (eye && bn === 'eye_close') {
          const scale = source.side === 'L' ? e.eyeScaleL : e.eyeScaleR
          if (scale !== 1) {
            const cxE = (eye.x0 + eye.x1) / 2
            const cyE = (eye.y0 + eye.y1) / 2
            x = cxE + (x - cxE) * scale
            y = cyE + (y - cyE) * scale
          }
        }
        if (eye && (bn === 'eye_dizzy' || source.fade === 'eyeDizzy')) {
          const scale = dizzyEyeDisplayScale(source.w, source.h, eye)
          if (scale !== 1) {
            x = eye.icx + (x - eye.icx) * scale
            y = eye.icy + (y - eye.icy) * scale
          }
        }
        if (eye && (bn === 'eye_squeeze' || source.fade === 'eyeSqueeze')) {
          const scale = squeezeEyeDisplayScale(source.w, eye)
          if (scale !== 1) {
            x = bcx + (x - bcx) * scale
            y = bcy + (y - bcy) * scale
          }
        }
        if (eye && (bn === 'eye_cry' || source.fade === 'eyeCry')) {
          const scale = cryEyeDisplayScale(source.w, eye)
          if (scale !== 1) {
            x = bcx + (x - bcx) * scale
            y = bcy + (y - bcy) * scale
          }
          const localY = (rest[index + 1] - source.y) / Math.max(1, source.h)
          const flowWeight = smoothstep((localY - 0.31) / 0.62)
          x += tearHorizontal * flowWeight
          y += tearVertical * flowWeight
        }
        if (eye && source.fade === 'eyeSilly' && this.stylizedMotion) {
          const scale = 0.84 + this.stylizedMotion.sillyEyeScale * 0.16
          x = eye.icx + (x - eye.icx) * scale
          y = eye.icy + (y - eye.icy) * scale
          if (source.role === 'iris-silly') {
            const irisOffsetX =
              source.side === 'L'
                ? this.stylizedMotion.sillyIrisOffsetXL
                : this.stylizedMotion.sillyIrisOffsetXR
            const irisOffsetY =
              source.side === 'L'
                ? this.stylizedMotion.sillyIrisOffsetYL
                : this.stylizedMotion.sillyIrisOffsetYR
            x += irisOffsetX * Math.max(1, eye.x1 - eye.x0)
            y += irisOffsetY * Math.max(1, eye.y1 - eye.y0)
          }
        }
        if (eye && source.fade === 'lovestruckHeart' && this.stylizedMotion) {
          x = eye.icx + (x - eye.icx) * e.irisScale
          y = eye.icy + (y - eye.icy) * e.irisScale
          x += e.eyeX * 11 * fs
          y += e.eyeY * 6 * fs
          const lidClose = smoothstep((0.32 - vOpen) / 0.32)
          y = eye.closeY + (y - eye.closeY) * (1 - 0.8 * lidClose)
          const scale = this.stylizedMotion.lovestruckHeartScale
          x = bcx + (x - bcx) * scale
          y = bcy + (y - bcy) * scale
        }
        if (this.stylizedMotion && source.fade === 'lovestruckFace') {
          const scale = this.stylizedMotion.lovestruckFaceScale
          x = bcx + (x - bcx) * scale
          y = bcy + (y - bcy) * scale
        }
        if (this.stylizedMotion && source.fade === 'lovestruckDrool') {
          const desiredX = mouthMorph.centerX + mouthMorph.width * 0.48
          const desiredY = mouthMorph.centerY + mouthMorph.height * 0.18
          x += desiredX - bcx
          y += desiredY - bcy + this.stylizedMotion.lovestruckDroolOffsetY * fs
        }
        if (
          this.stylizedMotion &&
          (source.fade === 'angerMark' || source.fade === 'speechlessSweat')
        ) {
          const angerMark = source.fade === 'angerMark'
          const scale = angerMark
            ? this.stylizedMotion.angerMarkScale
            : this.stylizedMotion.speechlessSweatScale
          const rotation = angerMark
            ? this.stylizedMotion.angerMarkRotation
            : this.stylizedMotion.speechlessSweatRotation
          const offsetX = angerMark
            ? 0
            : this.stylizedMotion.speechlessSweatOffsetX * fs
          const offsetY =
            (angerMark
              ? this.stylizedMotion.angerMarkOffsetY
              : this.stylizedMotion.speechlessSweatOffsetY) * fs
          const cosine = Math.cos(rotation)
          const sine = Math.sin(rotation)
          const localX = (x - bcx) * scale
          const localY = (y - bcy) * scale
          x = bcx + localX * cosine - localY * sine + offsetX
          y = bcy + localX * sine + localY * cosine + offsetY
        }
        if (morphingMouth) {
          const localX =
            (rest[index] - (source.x + source.w / 2)) /
            Math.max(1, source.w / 2)
          const localY =
            (rest[index + 1] - (source.y + source.h / 2)) /
            Math.max(1, source.h / 2)
          const xMagnitude = Math.min(1, Math.abs(localX))
          const yMagnitude = Math.min(1, Math.abs(localY))
          const ovalPinch =
            1 -
            mouthMorph.round * 0.13 * (0.28 + yMagnitude ** 1.35) +
            mouthMorph.wide * 0.035 * (1 - yMagnitude)
          x = mouthMorph.centerX + localX * (mouthMorph.width / 2) * ovalPinch
          const cornerCurve =
            (0.075 + mouthMorph.round * 0.14 - mouthMorph.wide * 0.025) *
            xMagnitude ** 1.65
          const cupidBow =
            mouthMorph.openMix *
            mouthMorph.height *
            0.034 *
            (1 - xMagnitude) ** 2
          const lowerFullness =
            mouthMorph.height *
            (0.018 + mouthMorph.openMix * 0.018) *
            (1 - xMagnitude ** 1.7)
          const upperRail =
            mouthMorph.centerY -
            mouthMorph.height / 2 +
            mouthMorph.height * cornerCurve -
            cupidBow
          const lowerRail =
            mouthMorph.centerY +
            mouthMorph.height / 2 -
            mouthMorph.height * cornerCurve * 0.82 +
            lowerFullness
          const verticalProgress = clamp((localY + 1) / 2, 0, 1)
          const upperAnchoredProgress =
            verticalProgress ** (1 + mouthMorph.openMix * 0.12)
          const trackedY =
            upperRail + (lowerRail - upperRail) * upperAnchoredProgress
          const restingY = mouthMorph.centerY + localY * (mouthMorph.height / 2)
          const railInfluence = smoothstep(mouthMorph.openMix)
          y = restingY + (trackedY - restingY) * railInfluence
        }
        if (
          (morphingMouth || source.fade === 'mouthCry') &&
          source.fade !== 'mouthSilly' &&
          e.mouthScale !== 1
        ) {
          x = A.mouth.cx + (x - A.mouth.cx) * e.mouthScale
          y = A.mouth.cy + (y - A.mouth.cy) * e.mouthScale
        }
        if (
          (morphingMouth || source.fade === 'mouthCry') &&
          source.fade !== 'mouthSilly'
        ) {
          const localJawY = clamp(
            (rest[index + 1] - source.y) / Math.max(1, source.h),
            0,
            1,
          )
          const lipJawWeight =
            0.08 + smoothstep((localJawY - 0.18) / 0.82) * 0.72
          y += jawDrop * lipJawWeight
        }
        if (source.fade === 'eyeOpen' && eye) {
          if (bn === 'irides') {
            x = eye.icx + (x - eye.icx) * e.irisScale
            y = eye.icy + (y - eye.icy) * e.irisScale
            x += e.eyeX * 11 * fs
            y += e.eyeY * 6 * fs
            const tl = smoothstep((0.32 - vOpen) / 0.32)
            y = eye.closeY + (y - eye.closeY) * (1 - 0.8 * tl)
          } else {
            y = eye.closeY + (y - eye.closeY) * (1 - 0.85 * (1 - vOpen))
          }
        }
        if (source.fade === 'eyeClose' && eye) {
          y -= vOpen * 3
          y += e.eyeCY * 14 * fs
          const thE = e.eyeCAng * 0.3 * (source.side === 'L' ? 1 : -1)
          if (thE) {
            const ct = Math.cos(thE)
            const st = Math.sin(thE)
            const rx = x - bcx
            const ry = y - bcy
            x = bcx + rx * ct - ry * st
            y = bcy + rx * st + ry * ct
          }
        }
        if (bn === 'eyebrow') {
          y += (-e.brow * 9 + (1 - vOpen) * 3.5) * fs
          const th =
            (source.side === 'L'
              ? e.browAngL + e.browAngSym
              : e.browAngR - e.browAngSym) * 0.3
          if (th) {
            const ct = Math.cos(th)
            const st = Math.sin(th)
            const rx = x - bcx
            const ry = y - bcy
            x = bcx + rx * ct - ry * st
            y = bcy + rx * st + ry * ct
          }
        }
        if (
          source.fade === 'mouthOpen' ||
          source.fade === 'mouthWide' ||
          source.fade === 'mouthRound' ||
          source.fade === 'mouthNarrow' ||
          source.fade === 'mouthClose' ||
          source.fade === 'mouthManiac'
        ) {
          const q = Math.abs(x - A.mouth.cx) / (mHalfW + 4)
          let formScale = 1
          if (source.fade === 'mouthRound') formScale = 0.35
          else if (source.fade === 'mouthNarrow') formScale = 0.7
          else if (source.fade === 'mouthOpen') formScale = 0.8
          else if (source.fade === 'mouthClose') formScale = 0.65
          else if (source.fade === 'mouthManiac') formScale = 0.28
          y -= e.mouthForm * formScale * 6 * fs * (q ** 1.5 - 0.35)
        }
        if (source.fade === 'mouthCry') {
          const localX = Math.abs(rest[index] - A.mouth.cx) / (mHalfW + 4)
          const sob = Math.sin(t * 2.55 + 0.35)
          y += e.mouthCY * 14 * fs
          y +=
            smoothstep(e.eyeCry) *
            sob *
            0.42 *
            fs *
            (0.45 + 0.55 * (1 - Math.min(1, localX)))
        }
        if (source.fade === 'mouthManiac') {
          y += e.mouthCY * 14 * fs
          if (this.stylizedMotion) {
            const localY = clamp(
              (rest[index + 1] - source.y) / Math.max(1, source.h),
              0,
              1,
            )
            const upperMouthPulse = this.stylizedMotion.maniacUpperMouthPulse
            const tongueRootAnchor =
              mouthMorph.centerY - mouthMorph.height * 0.045
            const scaledX =
              mouthMorph.centerX +
              (x - mouthMorph.centerX) * (1 - upperMouthPulse * 0.5)
            const scaledY =
              tongueRootAnchor +
              (y - tongueRootAnchor) * (1 + upperMouthPulse * 3.4)
            // The reference holds the tongue and lower lip nearly still. The
            // upper lip opens around the tongue root, while the face-locked
            // corner shadows move only with the delayed head follow.
            const upperMouthWeight = 1 - smoothstep((localY - 0.16) / 0.31)
            x += (scaledX - x) * upperMouthWeight
            y += (scaledY - y) * upperMouthWeight
          }
          const thM = e.mouthCAng * 0.24
          if (thM) {
            const ct = Math.cos(thM)
            const st = Math.sin(thM)
            const rx = x - A.mouth.cx
            const ry = y - A.mouth.cy
            x = A.mouth.cx + rx * ct - ry * st
            y = A.mouth.cy + rx * st + ry * ct
          }
        }
        if (source.fade === 'mouthSilly' && this.stylizedMotion) {
          const localX = clamp(
            (rest[index] - (source.x + source.w / 2)) /
              Math.max(1, source.w / 2),
            -1,
            1,
          )
          const localY = clamp(
            (rest[index + 1] - (source.y + source.h / 2)) /
              Math.max(1, source.h / 2),
            -1,
            1,
          )
          const opening = clamp(this.stylizedMotion.sillyMouthOpen, 0, 1)
          const omegaLobe = Math.sin(Math.PI * Math.abs(localX))
          // Scaled by this mouth's own drawing. `mouthMorph` collapses onto the
          // closed speaking silhouette here, which is far too small to carry a
          // readable omega.
          const omegaScale = Math.max(1, source.h)
          const closedX = mouthMorph.centerX + (x - mouthMorph.centerX) * 0.88
          const closedY =
            mouthMorph.centerY -
            omegaScale * 0.04 +
            omegaLobe * omegaScale * 0.12 +
            localY * omegaScale * 0.025
          x = closedX + (x - closedX) * opening
          y = closedY + (y - closedY) * opening
        }
        if (source.fade === 'mouthClose') {
          y += e.mouthCY * 14 * fs
          const thM = e.mouthCAng * 0.35
          if (thM) {
            const ct = Math.cos(thM)
            const st = Math.sin(thM)
            const rx = x - A.mouth.cx
            const ry = y - A.mouth.cy
            x = A.mouth.cx + rx * ct - ry * st
            y = A.mouth.cy + rx * st + ry * ct
          }
        }
        if (bn === 'face') {
          const jawStartY = A.mouth.cy - (A.face.y1 - A.face.y0) * 0.025
          const jawWeight = smoothstep(
            (rest[index + 1] - jawStartY) / Math.max(1, A.face.y1 - jawStartY),
          )
          y += jawDrop * jawWeight
          x += (A.face.cx - x) * jawOpen * 0.006 * jawWeight * jawWeight
        }
        if (bn === 'nose' && this.stylizedMotion) {
          // The reference's manic look lifts the nose slightly with the grin;
          // keep it local so ordinary expressions and the face anchor remain
          // unchanged.
          const noseLift = this.stylizedMotion.maniac * 10 * fs
          const noseWeight = smoothstep(
            (rest[index + 1] - source.y) / Math.max(1, source.h),
          )
          y -= noseLift * noseWeight
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
        const neckFollowProgress =
          bn === 'neck'
            ? clamp((A.neckBottom - rest[index + 1]) / neckFollowSpan, 0, 1)
            : 0
        const neckFollowInput = this.highCollar
          ? neckFollowProgress ** HIGH_COLLAR_NECK_FOLLOW_POWER
          : neckFollowProgress
        const neckHeadBlend = bn === 'neck' ? smoothstep(neckFollowInput) : 0
        const frontCollarProgress =
          isFrontCollar && !layer.collarContact
            ? clamp(
                1 -
                  (rest[index + 1] - source.y) /
                    Math.max(1, source.h * FRONT_COLLAR_FLEX_REGION),
                0,
                1,
              )
            : 0
        const frontCollarLocalX =
          isFrontCollar && !layer.collarContact
            ? Math.abs(
                (rest[index] - (source.x + source.w / 2)) /
                  Math.max(1, source.w / 2),
              )
            : 1
        const frontCollarInnerWeight =
          isFrontCollar && !layer.collarContact
            ? smoothstep((1 - frontCollarLocalX) / FRONT_COLLAR_INNER_REGION)
            : 0
        const frontCollarHeadBlend =
          smoothstep(frontCollarProgress) *
          frontCollarInnerWeight *
          FRONT_COLLAR_HEAD_FOLLOW
        let hw = isHead ? 1 : source.group === 'body' ? BODY_HEAD_FOLLOW : 0
        if (bn === 'neck') {
          hw = BODY_HEAD_FOLLOW + (1 - BODY_HEAD_FOLLOW) * neckHeadBlend
        } else if (isFrontCollar && !layer.collarContact) {
          hw = BODY_HEAD_FOLLOW + (1 - BODY_HEAD_FOLLOW) * frontCollarHeadBlend
        }
        if (!layer.collarContact && hw > 0) {
          const rx = x - npx
          const ry = y - npy
          const rx2 = rx * cz - ry * sz
          const ry2 = rx * sz + ry * cz
          x += (rx2 - rx) * hw
          y += (ry2 - ry) * hw
          let depthOffset =
            (source.depth - 1) * (layer.frontHairParallaxScale?.[vertex] ?? 1)
          if (bn === 'neck') depthOffset *= 1 - neckHeadBlend
          else if (isFrontCollar) depthOffset *= 1 - frontCollarHeadBlend
          x +=
            hw *
            fs *
            (e.angleX * (14 + 40 * depthOffset) + e.angleX * (npy - y) * 0.028)
          y +=
            hw *
            fs *
            (-ay * (9 + 30 * depthOffset) -
              ay * depthOffset * (y - A.face.cy) * 0.05)
        }
        if (!layer.collarContact && specialHeadOffset !== 0) {
          const specialHeadFollow = isHead
            ? 1
            : bn === 'neck'
              ? neckHeadBlend
              : isFrontCollar
                ? frontCollarHeadBlend
                : 0
          y += specialHeadOffset * specialHeadFollow
        }
        if (!layer.collarContact) {
          const breathOffset = isHead
            ? headBreathOffset
            : bn === 'neck'
              ? bodyBreathOffset +
                (headBreathOffset - bodyBreathOffset) * neckHeadBlend
              : isFrontCollar
                ? bodyBreathOffset +
                  (headBreathOffset - bodyBreathOffset) * frontCollarHeadBlend
                : bodyBreathOffset
          y -= breathOffset * fs
        }
        if (isTopwear && y < chestCy) {
          y -= breath * 2.2 * fs * smoothstep((chestCy - y) / (chestRy * 2))
        }
        if (isTopwear) x = npx + (x - npx) * (1 + breath * 0.003)
        if (isTopwear && (chestOffsetX !== 0 || chestOffsetY !== 0)) {
          const gx = (rest[index] - chestCx) * inverseChestRx
          const gy = (rest[index + 1] - chestCenterY) * inverseChestRy
          const skinWeight = layer.chestWeights?.[vertex] ?? 1
          const chestWeight = chestDeformationWeight(
            chestProfile?.source,
            gx,
            gy,
            skinWeight,
          )
          x += chestOffsetX * chestWeight
          y += chestOffsetY * chestWeight
        }
        if (bn === 'handwear') {
          const w = smoothstep(((y - source.y) / source.h) * 1.15)
          y -= e.armY * 30 * fs * w
          y += e.armPos * 40 * fs
          x += e.armY * 6 * fs * w * (x < npx ? 1 : -1)
        }
        if (layer.bangWeights && layer.alongStrand) {
          const along = layer.alongStrand[vertex]
          const m = along ** 1.4 * 22 * fs
          x +=
            (e.bangL * layer.bangWeights[vertex * 3] +
              e.bangC * layer.bangWeights[vertex * 3 + 1] +
              e.bangR * layer.bangWeights[vertex * 3 + 2]) *
            m
        }
        if (
          nS &&
          layer.springs &&
          layer.strandWeights &&
          layer.alongStrand &&
          e.phys
        ) {
          const along = layer.alongStrand[vertex]
          const front = layer.frontHair
          const u = front ? Math.min(1, along * 1.6) : along
          const amp = u ** (front ? 1.8 : 2.1) * (front ? e.fhAmp : e.physAmp)
          const softMix = u ** 1.2 * (front ? e.fhSoft : e.soft)
          let dx = 0
          for (let strand = 0; strand < nS; strand += 1) {
            const weight = layer.strandWeights[vertex * nS + strand]
            if (weight < 0.001) continue
            const spring = layer.springs[strand]
            dx +=
              weight *
              (spring.stiff.dx * (1 - softMix) + spring.soft.dx * softMix)
          }
          const offset = dx * amp
          x += offset
          y += Math.abs(offset) * 0.12
        }
        deformed[index] = x
        deformed[index + 1] = y
      }
      if (Math.abs(ab) > 1e-4) {
        for (let index = 0; index < deformed.length; index += 2) {
          const rx = deformed[index] - bpx
          const ry = deformed[index + 1] - bpy
          deformed[index] = bpx + rx * cb - ry * sb
          deformed[index + 1] = bpy + rx * sb + ry * cb
        }
      }
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, layer.vertexBuffer)
      this.gl.bufferSubData(
        this.gl.ARRAY_BUFFER,
        0,
        packVerticesInto(deformed, layer.uvs, layer.packedVertices),
      )
    }
  }

  private draw(): void {
    const { gl } = this
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT)
    gl.useProgram(this.program)
    gl.uniform2f(this.viewLocation, this.viewWidth, this.viewHeight)
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
    const flexibleCell =
      source.role === 'neck'
        ? NECK_MESH_CELL
        : source.role === 'collar-front'
          ? FRONT_COLLAR_MESH_CELL
          : null
    const cell =
      (flexibleCell ?? (source.phys ? 30 : 42)) *
      Math.max(0.6, this.playback.pixelCanvas.width / 768)
    const morphingMouth =
      source.fade === 'mouthOpen' ||
      source.fade === 'mouthWide' ||
      source.fade === 'mouthRound' ||
      source.fade === 'mouthNarrow' ||
      source.fade === 'mouthClose' ||
      source.fade === 'mouthManiac' ||
      source.fade === 'mouthSilly'
    const maniacMouthMesh = source.fade === 'mouthManiac'
    const sillyMouthMesh = source.fade === 'mouthSilly'
    const baseCols = Math.max(
      maniacMouthMesh ? 14 : sillyMouthMesh ? 10 : morphingMouth ? 6 : 2,
      Math.round(source.w / cell),
    )
    const baseRows = Math.max(
      maniacMouthMesh
        ? 10
        : sillyMouthMesh
          ? 8
          : morphingMouth
            ? 4
            : source.role === 'eye-cry'
              ? 3
              : 2,
      Math.round(source.h / cell),
    )
    const xCoordinates = layerGridAxis(
      source.x,
      source.w,
      baseCols,
      collarContact?.gridX,
    )
    const yCoordinates = layerGridAxis(
      source.y,
      source.h,
      baseRows,
      collarContact?.gridY,
    )
    const cols = xCoordinates.length - 1
    const rows = yCoordinates.length - 1
    const rest = new Float32Array((cols + 1) * (rows + 1) * 2)
    const uvs = new Float32Array(rest.length)
    let cursor = 0
    for (let row = 0; row <= rows; row += 1) {
      const y = yCoordinates[row]
      const localV = (y - source.y) / Math.max(1, source.h)
      for (let col = 0; col <= cols; col += 1) {
        const x = xCoordinates[col]
        const localU = (x - source.x) / Math.max(1, source.w)
        const [u, v] = localToAtlasUv(source.atlas, localU, localV)
        rest[cursor] = x
        rest[cursor + 1] = y
        uvs[cursor] = u
        uvs[cursor + 1] = v
        cursor += 2
      }
    }
    const indices = new Uint16Array(cols * rows * 6)
    let write = 0
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const topLeft = row * (cols + 1) + col
        const topRight = topLeft + 1
        const bottomLeft = topLeft + cols + 1
        const bottomRight = bottomLeft + 1
        indices.set(
          [topLeft, topRight, bottomLeft, topRight, bottomRight, bottomLeft],
          write,
        )
        write += 6
      }
    }
    const packed = createPackedVertices(rest, uvs)
    const { gl } = this
    const vao = gl.createVertexArray()
    const vertexBuffer = gl.createBuffer()
    const indexBuffer = gl.createBuffer()
    if (!vao || !vertexBuffer || !indexBuffer) {
      throw new Error(currentCopy().merope.anime25dPlaybackFailed)
    }
    const position = gl.getAttribLocation(this.program, 'a_pos')
    const uv = gl.getAttribLocation(this.program, 'a_uv')
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, packed, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0)
    gl.enableVertexAttribArray(uv)
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)
    gl.bindVertexArray(null)
    const vertexCount = (cols + 1) * (rows + 1)
    const chestWeights =
      source.role === 'topwear' && this.chestWeightField
        ? samplePlaybackChestWeights(
            this.chestWeightField,
            rest,
            this.playback.pixelCanvas.width,
          )
        : null
    const hair = attachHairPhysics(
      source,
      rest,
      vertexCount,
      this.playback.anchors.face,
      typeof source.z === 'number' && Number.isFinite(source.z)
        ? source.z
        : layerIndex,
    )
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
      deformed: rest.slice(),
      uvs,
      packedVertices: packed,
      indices,
      cols,
      rows,
      vao,
      vertexBuffer,
      indexBuffer,
      indexCount: indices.length,
      frameOpacity: source.fade ? 0 : 1,
      chestWeights,
      ...hair,
      collarContact,
    }
  }
}

function layerGridAxis(
  origin: number,
  length: number,
  segmentCount: number,
  extraCoordinates?: readonly number[],
): number[] {
  const coordinates: number[] = []
  for (let segment = 0; segment <= segmentCount; segment += 1) {
    coordinates.push(origin + (length * segment) / segmentCount)
  }
  for (const coordinate of extraCoordinates ?? []) {
    if (coordinate >= origin && coordinate <= origin + length) {
      coordinates.push(coordinate)
    }
  }
  coordinates.sort((left, right) => left - right)
  const unique: number[] = []
  for (const coordinate of coordinates) {
    if (
      unique.length === 0 ||
      Math.abs(coordinate - unique[unique.length - 1]) > 0.05
    ) {
      unique.push(coordinate)
    }
  }
  return unique
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

function attachHairPhysics(
  source: Anime25DPlaybackLayer,
  rest: Float32Array,
  vertexCount: number,
  face: Anime25DPlayback['anchors']['face'],
  layerZ: number,
): Pick<
  GpuLayer,
  | 'frontHair'
  | 'frontHairParallaxScale'
  | 'strandWeights'
  | 'alongStrand'
  | 'bangWeights'
  | 'springs'
> {
  const frontHair = source.role === 'front-hair'
  const strands = source.strands
  if (strands.length === 0) {
    return {
      frontHair,
      frontHairParallaxScale: null,
      strandWeights: null,
      alongStrand: null,
      bangWeights: null,
      springs: null,
    }
  }
  const strandCount = strands.length
  let spacing = 120
  if (strandCount > 1) {
    const gaps = []
    for (let index = 1; index < strandCount; index += 1) {
      gaps.push(strands[index].x - strands[index - 1].x)
    }
    gaps.sort((left, right) => left - right)
    spacing = gaps[gaps.length >> 1]
  }
  const sigma = spacing * 0.6
  const referenceHeight = Math.max(1, face.y1 - face.y0)
  const dynamics = strands.map((strand) =>
    hairStrandDynamics(strand.rootY, strand.tipY, referenceHeight),
  )
  const frontHairParallaxScale = frontHair
    ? new Float32Array(vertexCount)
    : null
  const strandWeights = new Float32Array(vertexCount * strandCount)
  const alongStrand = new Float32Array(vertexCount)
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const x = rest[vertex * 2]
    const y = rest[vertex * 2 + 1]
    if (frontHairParallaxScale) {
      frontHairParallaxScale[vertex] = frontHairUpperParallaxScale(
        y,
        source,
        face,
      )
    }
    let total = 0
    for (let strand = 0; strand < strandCount; strand += 1) {
      const weight = Math.exp(-(((x - strands[strand].x) / sigma) ** 2))
      strandWeights[vertex * strandCount + strand] = weight
      total += weight
    }
    let rootY = 0
    let tipY = 0
    if (total > 1e-6) {
      for (let strand = 0; strand < strandCount; strand += 1) {
        const weight = strandWeights[vertex * strandCount + strand] / total
        strandWeights[vertex * strandCount + strand] =
          weight * dynamics[strand].amplitudeScale
        rootY += weight * strands[strand].rootY
        tipY += weight * strands[strand].tipY
      }
    } else {
      strandWeights[vertex * strandCount] = dynamics[0].amplitudeScale
      rootY = strands[0].rootY
      tipY = strands[0].tipY
    }
    alongStrand[vertex] = clamp((y - rootY) / Math.max(1, tipY - rootY), 0, 1)
  }
  let bangWeights: Float32Array | null = null
  if (frontHair) {
    const faceWidth = face.x1 - face.x0
    const leftSplit = face.cx - faceWidth * 0.22
    const rightSplit = face.cx + faceWidth * 0.22
    bangWeights = new Float32Array(vertexCount * 3)
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const x = rest[vertex * 2]
      const left = smoothstep((x - leftSplit) / 36 + 0.5)
      const right = smoothstep((x - rightSplit) / 36 + 0.5)
      bangWeights[vertex * 3] = 1 - left
      bangWeights[vertex * 3 + 1] = left * (1 - right)
      bangWeights[vertex * 3 + 2] = right
    }
  }
  return {
    frontHair,
    frontHairParallaxScale,
    strandWeights,
    alongStrand,
    bangWeights,
    springs: strands.map((_, index) => ({
      stiff: { x: 0, v: 0, dx: 0 },
      soft: { x: 0, v: 0, dx: 0 },
      phase: index * 1.37 + layerZ,
      stiffnessScale: dynamics[index].stiffnessScale,
      dampingScale: dynamics[index].dampingScale,
    })),
  }
}

function smoothstep(value: number): number {
  const bounded = clamp(value, 0, 1)
  return bounded * bounded * (3 - 2 * bounded)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
