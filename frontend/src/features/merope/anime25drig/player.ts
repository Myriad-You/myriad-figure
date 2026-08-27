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
import type { HairSpringState } from './hairPhysics'
import type {
  MouthTransitionSample,
  SpeechMouthMaterial,
} from './mouthTransition'
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
  COLLAR_ATTACHMENT_NECK,
  deformRigidMlsPoint,
} from './collarContact'
import {
  cryTearHorizontalOffset,
  cryTearVerticalOffset,
  sampleCryMouthMotion,
} from './cryMotion'
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
  dominantMouthMaterial,
  MouthTransitionController,
} from './mouthTransition'
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
import { ThinkingMotionController } from './thinkingMotion'
import {
  type StylizedExpressionMotion,
  StylizedExpressionMotionController,
} from './stylizedExpressionMotion'

const BODY_HEAD_FOLLOW = 0.16
const NECK_MESH_CELL = 28
const FRONT_COLLAR_MESH_CELL = 22
const HIGH_COLLAR_NECK_FOLLOW_POWER = 3
const FRONT_COLLAR_HEAD_FOLLOW = 0.42
const FRONT_COLLAR_FLEX_REGION = 0.78
const FRONT_COLLAR_INNER_REGION = 0.72

const VERTEX_SHADER = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
uniform vec2 u_view;
out vec2 v_uv;
void main() {
  vec2 clip = vec2(a_pos.x / u_view.x * 2.0 - 1.0, 1.0 - a_pos.y / u_view.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  v_uv = a_uv;
}`

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform float u_cut;
uniform float u_opacity;
uniform float u_cry_time;
uniform float u_cry;
out vec4 out_color;

float tear_water_mask(vec4 color, float y) {
  vec3 straight = color.rgb / max(color.a, 0.001);
  float blue_water = smoothstep(0.06, 0.18, straight.b - straight.r)
    * smoothstep(0.04, 0.16, straight.g - straight.r);
  float pale_highlight = smoothstep(0.72, 0.94, max(straight.r, straight.g))
    * smoothstep(-0.02, 0.08, straight.b - straight.r);
  return max(blue_water, pale_highlight)
    * smoothstep(0.25, 0.33, y)
    * smoothstep(0.01, 0.12, color.a);
}

float tear_center(float y, float side) {
  if (side < 0.0) {
    if (y < 0.39) return mix(0.23, 0.27, clamp((y - 0.29) / 0.10, 0.0, 1.0));
    if (y < 0.52) return mix(0.27, 0.24, (y - 0.39) / 0.13);
    if (y < 0.70) return mix(0.24, 0.30, (y - 0.52) / 0.18);
    if (y < 0.89) return mix(0.30, 0.27, (y - 0.70) / 0.19);
    return 0.27;
  }
  if (y < 0.40) return mix(0.77, 0.73, clamp((y - 0.30) / 0.10, 0.0, 1.0));
  if (y < 0.53) return mix(0.73, 0.76, (y - 0.40) / 0.13);
  if (y < 0.71) return mix(0.76, 0.70, (y - 0.53) / 0.18);
  if (y < 0.90) return mix(0.70, 0.73, (y - 0.71) / 0.19);
  return 0.73;
}

void main() {
  vec4 color = texture(u_texture, v_uv);
  float cry_amount = abs(u_cry);
  if (cry_amount > 0.001) {
    float side = u_cry < 0.0 ? -1.0 : 1.0;
    float root_y = side < 0.0 ? 0.29 : 0.30;
    float source_span = 0.70;
    float side_phase = side < 0.0 ? 0.0 : 0.055;
    float cycle = fract(u_cry_time * 0.62 + side_phase);
    float grow = smoothstep(0.02, 0.29, cycle)
      * (1.0 - smoothstep(0.34, 0.52, cycle));
    float recoil = smoothstep(0.34, 0.58, cycle)
      * (1.0 - smoothstep(0.78, 0.98, cycle));
    float stretch = 0.775 + grow * 0.075 - recoil * 0.035;
    float source_y = root_y + (v_uv.y - root_y) / stretch;
    float stream_progress = clamp(
      (v_uv.y - root_y) / (source_span * stretch),
      0.0,
      1.0
    );
    float tip_weight = smoothstep(0.62, 0.98, stream_progress);
    float width_scale = 1.0 + tip_weight * (0.07 + grow * 0.13);
    float source_center = tear_center(source_y, side);
    float source_x = source_center + (v_uv.x - source_center) / width_scale;
    vec4 attached_sample = texture(u_texture, vec2(source_x, source_y));
    float base_water = tear_water_mask(color, v_uv.y);
    float attached_water = tear_water_mask(attached_sample, source_y)
      * step(root_y, v_uv.y)
      * step(v_uv.y, root_y + source_span * stretch);

    float drop_progress = clamp((cycle - 0.27) / 0.62, 0.0, 1.0);
    float drop_visible = smoothstep(0.25, 0.34, cycle)
      * (1.0 - smoothstep(0.84, 0.98, cycle));
    float drop_source_y = side < 0.0 ? 0.89 : 0.90;
    float drop_source_x = tear_center(drop_source_y, side);
    float drop_center_x = drop_source_x
      + side * drop_progress * 0.012
      + sin(drop_progress * 3.14159265) * side * 0.004;
    float drop_center_y = 0.83
      + drop_progress * 0.10
      + drop_progress * drop_progress * 0.035;
    float drop_radius_x = mix(0.042, 0.031, drop_progress);
    float drop_radius_y = mix(0.052, 0.039, drop_progress);
    vec2 drop_source_uv = vec2(
      drop_source_x + (v_uv.x - drop_center_x) * (0.068 / drop_radius_x),
      drop_source_y + (v_uv.y - drop_center_y) * (0.072 / drop_radius_y)
    );
    vec4 drop_sample = texture(u_texture, drop_source_uv);
    float drop_water = tear_water_mask(drop_sample, drop_source_uv.y)
      * step(0.805, drop_source_uv.y)
      * step(drop_source_uv.y, 0.955)
      * drop_visible;

    vec4 dry_eye = color * (1.0 - base_water);
    vec4 attached_tear = attached_sample * attached_water;
    vec4 falling_drop = drop_sample * drop_water;
    vec4 moving_water = attached_tear
      + falling_drop * (1.0 - attached_tear.a);
    color = dry_eye + moving_water * (1.0 - dry_eye.a);
  }
  if (color.a < u_cut) discard;
  out_color = color * u_opacity;
}`

/** Parameter block copied from Anime2.5DRig `P` / `auto` in index.html. */
export interface Anime25DDriver {
  angleX: number
  angleY: number
  angleZ: number
  eyeOpenL: number
  eyeOpenR: number
  eyeDizzy: number
  eyeSqueeze: number
  eyeCry: number
  anger: number
  speechless: number
  maniac: number
  eyeX: number
  eyeY: number
  brow: number
  mouthOpen: number
  mouthWide: number
  mouthRound: number
  mouthNarrow: number
  mouthSeal: number
  mouthForm: number
  mouthCY: number
  body: number
  physAmp: number
  soft: number
  browAngL: number
  browAngR: number
  browAngSym: number
  bangL: number
  bangC: number
  bangR: number
  armY: number
  armPos: number
  bust: number
  bustY: number
  irisScale: number
  mouthEase: number
  eyeEase: number
  fhAmp: number
  fhSoft: number
  eyeCY: number
  eyeCAng: number
  mouthCAng: number
  eyeScaleL: number
  eyeScaleR: number
  mouthScale: number
  idle: boolean
  blink: boolean
  rand: boolean
  thinking: boolean
  singing: boolean
  talk: boolean
  mouse: boolean
  phys: boolean
}

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

interface MouthMorphState {
  centerX: number
  centerY: number
  width: number
  height: number
  openMix: number
  wide: number
  round: number
  narrow: number
}

interface GpuLayer {
  source: Anime25DPlaybackLayer
  rest: Float32Array
  deformed: Float32Array
  uvs: Float32Array
  indices: Uint16Array
  cols: number
  rows: number
  vao: WebGLVertexArrayObject
  vertexBuffer: WebGLBuffer
  indexBuffer: WebGLBuffer
  indexCount: number
  texture: WebGLTexture
  chestWeights: Float32Array | null
  frontHair: boolean
  frontHairParallaxScale: Float32Array | null
  strandWeights: Float32Array | null
  alongStrand: Float32Array | null
  bangWeights: Float32Array | null
  springs: HairStrandSpring[] | null
  collarContact: FrontCollarContactModel | null
}

interface CollarClipMesh {
  rest: Float32Array
  deformed: Float32Array
  uvs: Float32Array
  indices: Uint16Array
  vao: WebGLVertexArrayObject
  vertexBuffer: WebGLBuffer
  indexBuffer: WebGLBuffer
  indexCount: number
}

interface CollarMotionPose {
  neckPivotX: number
  neckPivotY: number
  neckFollowTop: number
  neckFollowSpan: number
  faceCenterY: number
  faceScale: number
  angleX: number
  angleY: number
  headRotationCosine: number
  headRotationSine: number
  bodyBreathOffset: number
  headBreathOffset: number
}

export const DEFAULT_FRONT_HAIR_SWAY = 1
export const DEFAULT_REAR_HAIR_SWAY = 0.5

export const IDENTITY_DRIVER: Anime25DDriver = {
  angleX: 0,
  angleY: 0,
  angleZ: 0,
  eyeOpenL: 1,
  eyeOpenR: 1,
  eyeDizzy: 0,
  eyeSqueeze: 0,
  eyeCry: 0,
  anger: 0,
  speechless: 0,
  maniac: 0,
  eyeX: 0,
  eyeY: 0,
  brow: 0,
  mouthOpen: 0,
  mouthWide: 0,
  mouthRound: 0,
  mouthNarrow: 0,
  mouthSeal: 0,
  mouthForm: 0,
  mouthCY: 0,
  body: 0,
  physAmp: DEFAULT_REAR_HAIR_SWAY,
  soft: 2,
  browAngL: 0,
  browAngR: 0,
  browAngSym: 0,
  bangL: 0,
  bangC: 0,
  bangR: 0,
  armY: 0,
  armPos: 0,
  bust: 2.5,
  bustY: 1,
  irisScale: 1,
  mouthEase: 0.45,
  eyeEase: 0.3,
  fhAmp: DEFAULT_FRONT_HAIR_SWAY,
  fhSoft: 0.4,
  eyeCY: 0,
  eyeCAng: 0,
  mouthCAng: 0,
  eyeScaleL: 1,
  eyeScaleR: 1,
  mouthScale: 1,
  idle: true,
  blink: true,
  rand: true,
  thinking: false,
  singing: false,
  talk: true,
  mouse: false,
  phys: true,
}

/** Settings workbench: automations off so each slider can be seen. */
export const WORKBENCH_DRIVER: Anime25DDriver = {
  ...IDENTITY_DRIVER,
  idle: false,
  rand: false,
  talk: false,
  blink: true,
  mouse: false,
  phys: true,
}

const DRIVER_LIMITS: Partial<
  Record<keyof Anime25DDriver, readonly [number, number]>
> = {
  angleX: [-1, 1],
  angleY: [-1, 1],
  angleZ: [-1, 1],
  eyeOpenL: [0, 1],
  eyeOpenR: [0, 1],
  eyeDizzy: [0, 1],
  eyeSqueeze: [0, 1],
  eyeCry: [0, 1],
  anger: [0, 1],
  speechless: [0, 1],
  maniac: [0, 1],
  eyeX: [-1, 1],
  eyeY: [-1, 1],
  brow: [-1, 1],
  mouthOpen: [0, 1],
  mouthWide: [0, 1],
  mouthRound: [0, 1],
  mouthNarrow: [0, 1],
  mouthSeal: [0, 1],
  mouthForm: [-1, 1],
  mouthCY: [-1, 1],
  body: [-1, 1],
  physAmp: [0, 3],
  soft: [0, 3],
  browAngL: [-1, 1],
  browAngR: [-1, 1],
  browAngSym: [-1, 1],
  bangL: [-1, 1],
  bangC: [-1, 1],
  bangR: [-1, 1],
  armY: [-1, 1],
  armPos: [-1, 1],
  bust: [0, 4],
  bustY: [-3, 3],
  irisScale: [0.5, 1.3],
  mouthEase: [0, 1],
  eyeEase: [0, 1],
  fhAmp: [0, 3],
  fhSoft: [0, 2],
  eyeCY: [-1, 1],
  eyeCAng: [-1, 1],
  mouthCAng: [-1, 1],
  eyeScaleL: [0.5, 1.5],
  eyeScaleR: [0.5, 1.5],
  mouthScale: [0.5, 1.5],
}

export function sanitizeDriverPatch(
  partial: Partial<Anime25DDriver>,
): Partial<Anime25DDriver> {
  const sanitized: Partial<Anime25DDriver> = {}
  const output = sanitized as Record<string, unknown>
  for (const [rawKey, rawValue] of Object.entries(partial)) {
    const key = rawKey as keyof Anime25DDriver
    const identityValue = IDENTITY_DRIVER[key]
    if (typeof identityValue === 'boolean') {
      if (typeof rawValue === 'boolean') output[rawKey] = rawValue
      continue
    }
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) continue
    const limits = DRIVER_LIMITS[key]
    output[rawKey] = limits
      ? Math.max(limits[0], Math.min(limits[1], rawValue))
      : rawValue
  }
  return sanitized
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
  private layers: GpuLayer[] = []
  private readonly current: Anime25DDriver = { ...IDENTITY_DRIVER }
  private readonly target: Anime25DDriver = { ...IDENTITY_DRIVER }
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
    gl.useProgram(this.program)
    gl.uniform1i(requiredUniform(gl, this.program, 'u_texture'), 0)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1)
  }

  async loadAtlas(url: string): Promise<void> {
    const image = await loadImage(url)
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
      gl.deleteTexture(layer.texture)
    }
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
    const tgt: Anime25DDriver = { ...this.target }
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
    const stylized = this.stylizedExpression.sample(
      t,
      angerTarget,
      speechlessTarget,
      maniacTarget,
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
    applySingingGroove(tgt, groove, 1)
    // `talk` is a workbench preview generator, not ownership by real speech.
    // Agent speech suppresses idle actions; singing keeps them and switches
    // the catalog to an excited groove driven by the live spectrum.
    const actionBlocked =
      (this.speechActive && !singing) ||
      angerTarget > 0.03 ||
      speechlessTarget > 0.03 ||
      maniacTarget > 0.03
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
        maniacTarget <= 0.03,
    )
    const ambientScale =
      performanceMotionScale * randomAction.ambientScale * stylized.ambientScale
    tgt.angleX = clamp(tgt.angleX + ambient.angleX * ambientScale, -1, 1)
    tgt.angleY = clamp(tgt.angleY + ambient.angleY * ambientScale, -1, 1)
    tgt.angleZ = clamp(tgt.angleZ + ambient.angleZ * ambientScale, -1, 1)
    tgt.body = clamp(tgt.body + ambient.body * ambientScale, -1, 1)
    tgt.eyeX = clamp(tgt.eyeX + ambient.eyeX * ambientScale, -1, 1)
    tgt.eyeY = clamp(tgt.eyeY + ambient.eyeY * ambientScale, -1, 1)
    applyRandomActionFrame(
      tgt,
      randomAction,
      performanceMotionScale * stylized.ambientScale,
    )
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
      stylized.mouthScale,
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
    this.secondaryTarget.angleX = tgt.angleX
    this.secondaryTarget.angleY = tgt.angleY
    this.secondaryTarget.angleZ = tgt.angleZ
    this.secondaryTarget.body = tgt.body
    applyExpressiveMotionEnvelope(tgt, semanticExpression, speechExpression)
    if (maniacTarget > 0.03) {
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
    const az = e.angleZ * (0.07 + 0.19 * singingLift)
    const cz = Math.cos(az)
    const sz = Math.sin(az)
    // Keep waist rotation near idle while singing; boosting it swings the
    // shoulder seam around a second pivot from the neck.
    const ab = e.body * (0.028 + 0.04 * singingLift)
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
    const maniacHeadOffset = this.stylizedMotion
      ? this.stylizedMotion.maniacHeadPulse * 80 * fs
      : 0
    const mHalfW = (A.mouth.x1 - A.mouth.x0) / 2
    const mouthTransition = this.mouthTransition.sample(e)
    this.activeMouthMaterial = mouthTransition.material
    resolveMouthMorph(this.layers, e, A.mouth, A.face, this.mouthMorph)
    applyMouthTransitionBridge(this.mouthMorph, mouthTransition)
    const mouthMorph = this.mouthMorph
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
        source.fade === 'mouthManiac'
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
          e.mouthScale !== 1
        ) {
          x = A.mouth.cx + (x - A.mouth.cx) * e.mouthScale
          y = A.mouth.cy + (y - A.mouth.cy) * e.mouthScale
        }
        if (morphingMouth || source.fade === 'mouthCry') {
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
            (-e.angleY * (9 + 30 * depthOffset) -
              e.angleY * depthOffset * (y - A.face.cy) * 0.05)
        }
        if (!layer.collarContact && maniacHeadOffset !== 0) {
          const maniacHeadFollow = isHead
            ? 1
            : bn === 'neck'
              ? neckHeadBlend
              : isFrontCollar
                ? frontCollarHeadBlend
                : 0
          y += maniacHeadOffset * maniacHeadFollow
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
        packVertices(deformed, layer.uvs),
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
    for (const layer of this.layers) {
      const opacity = fadeOpacity(
        layer.source,
        this.current,
        this.activeMouthMaterial,
      )
      if (opacity < 0.004 && !layer.source.name.startsWith('eyewhite')) continue
      const eyewhite = layer.source.name.startsWith('eyewhite')
      const iris = layer.source.name.startsWith('irides')
      const crying = layer.source.fade === 'eyeCry'
      const crySide = layer.source.side === 'L' ? -1 : 1
      gl.bindTexture(gl.TEXTURE_2D, layer.texture)
      gl.uniform1f(this.opacityLocation, opacity)
      gl.uniform1f(this.cryLocation, crying ? crySide * this.current.eyeCry : 0)
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
    const cropped = cropLayerTexture(
      this.gl,
      atlasImage,
      source,
      source.role === 'collar-front',
    )
    const collarContact =
      source.role === 'collar-front' && cropped.pixels
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
      source.fade === 'mouthManiac'
    const maniacMouthMesh = source.fade === 'mouthManiac'
    const baseCols = Math.max(
      maniacMouthMesh ? 14 : morphingMouth ? 6 : 2,
      Math.round(source.w / cell),
    )
    const baseRows = Math.max(
      maniacMouthMesh
        ? 10
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
      const v = (y - source.y) / Math.max(1, source.h)
      for (let col = 0; col <= cols; col += 1) {
        const x = xCoordinates[col]
        const u = (x - source.x) / Math.max(1, source.w)
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
    const packed = packVertices(rest, uvs)
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
      indices,
      cols,
      rows,
      vao,
      vertexBuffer,
      indexBuffer,
      indexCount: indices.length,
      texture: cropped.texture,
      chestWeights,
      ...hair,
      collarContact,
    }
  }
}

function updateFrontCollarTargets(
  model: FrontCollarContactModel,
  collarDepth: number,
  neckDepth: number,
  pose: CollarMotionPose,
): void {
  for (let handle = 0; handle < model.attachments.length; handle += 1) {
    const index = handle * 2
    const restX = model.handles[index]
    const restY = model.handles[index + 1]
    const attachedToNeck = model.attachments[handle] === COLLAR_ATTACHMENT_NECK
    const neckHeadBlend = attachedToNeck ? collarNeckHeadBlend(restY, pose) : 0
    const headFollow = attachedToNeck
      ? BODY_HEAD_FOLLOW + (1 - BODY_HEAD_FOLLOW) * neckHeadBlend
      : BODY_HEAD_FOLLOW
    transformCollarPoint(
      restX,
      restY,
      headFollow,
      attachedToNeck ? neckDepth : collarDepth,
      neckHeadBlend,
      attachedToNeck,
      pose,
      model.targets,
      index,
    )
  }
}

function collarNeckHeadBlend(y: number, pose: CollarMotionPose): number {
  const progress = clamp(
    (pose.neckFollowTop + pose.neckFollowSpan - y) / pose.neckFollowSpan,
    0,
    1,
  )
  return smoothstep(progress ** HIGH_COLLAR_NECK_FOLLOW_POWER)
}

function transformCollarPoint(
  restX: number,
  restY: number,
  headFollow: number,
  depth: number,
  neckHeadBlend: number,
  attachedToNeck: boolean,
  pose: CollarMotionPose,
  output: Float32Array,
  index: number,
): void {
  let x = restX
  let y = restY
  const rotationX = x - pose.neckPivotX
  const rotationY = y - pose.neckPivotY
  const rotatedX =
    rotationX * pose.headRotationCosine - rotationY * pose.headRotationSine
  const rotatedY =
    rotationX * pose.headRotationSine + rotationY * pose.headRotationCosine
  x += (rotatedX - rotationX) * headFollow
  y += (rotatedY - rotationY) * headFollow
  let depthOffset = depth - 1
  if (attachedToNeck) depthOffset *= 1 - neckHeadBlend
  x +=
    headFollow *
    pose.faceScale *
    (pose.angleX * (14 + 40 * depthOffset) +
      pose.angleX * (pose.neckPivotY - y) * 0.028)
  y +=
    headFollow *
    pose.faceScale *
    (-pose.angleY * (9 + 30 * depthOffset) -
      pose.angleY * depthOffset * (y - pose.faceCenterY) * 0.05)
  const breathOffset = attachedToNeck
    ? pose.bodyBreathOffset +
      (pose.headBreathOffset - pose.bodyBreathOffset) * neckHeadBlend
    : pose.bodyBreathOffset
  output[index] = x
  output[index + 1] = y - breathOffset * pose.faceScale
}

function createCollarClipMesh(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  model: FrontCollarContactModel,
  neck: Anime25DPlaybackLayer,
  collar: Anime25DPlaybackLayer,
): CollarClipMesh {
  const firstLeftIndex = model.contactPairs[0] * 2
  const firstRightIndex = model.contactPairs[1] * 2
  const firstY = model.handles[firstLeftIndex + 1]
  const transitionHeight = Math.max(7, Math.min(collar.h * 0.16, neck.h * 0.1))
  const transitionY = Math.max(neck.y, firstY - transitionHeight)
  const horizontalMargin = collar.w * 0.075
  const seamAllowance = Math.max(1, Math.min(2.5, collar.w * 0.01))
  const restValues = [
    neck.x,
    neck.y,
    neck.x + neck.w,
    neck.y,
    Math.max(neck.x, model.handles[firstLeftIndex] - horizontalMargin),
    transitionY,
    Math.min(
      neck.x + neck.w,
      model.handles[firstRightIndex] + horizontalMargin,
    ),
    transitionY,
  ]
  for (let pair = 0; pair < model.contactPairs.length; pair += 2) {
    const leftIndex = model.contactPairs[pair] * 2
    const rightIndex = model.contactPairs[pair + 1] * 2
    restValues.push(
      Math.max(neck.x, model.handles[leftIndex] - seamAllowance),
      model.handles[leftIndex + 1],
      Math.min(neck.x + neck.w, model.handles[rightIndex] + seamAllowance),
      model.handles[rightIndex + 1],
    )
  }
  const rest = Float32Array.from(restValues)
  const deformed = rest.slice()
  const uvs = new Float32Array(rest.length)
  const rowCount = rest.length / 4
  const indices = new Uint16Array((rowCount - 1) * 6)
  for (let row = 0; row < rowCount - 1; row += 1) {
    const topLeft = row * 2
    const topRight = topLeft + 1
    const bottomLeft = topLeft + 2
    const bottomRight = topLeft + 3
    indices.set(
      [topLeft, topRight, bottomLeft, topRight, bottomRight, bottomLeft],
      row * 6,
    )
  }
  const vao = gl.createVertexArray()
  const vertexBuffer = gl.createBuffer()
  const indexBuffer = gl.createBuffer()
  if (!vao || !vertexBuffer || !indexBuffer) {
    throw new Error(currentCopy().merope.anime25dPlaybackFailed)
  }
  const position = gl.getAttribLocation(program, 'a_pos')
  const uv = gl.getAttribLocation(program, 'a_uv')
  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, packVertices(deformed, uvs), gl.DYNAMIC_DRAW)
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0)
  gl.enableVertexAttribArray(uv)
  gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8)
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)
  gl.bindVertexArray(null)
  return {
    rest,
    deformed,
    uvs,
    indices,
    vao,
    vertexBuffer,
    indexBuffer,
    indexCount: indices.length,
  }
}

function updateCollarClipMesh(
  gl: WebGL2RenderingContext,
  clip: CollarClipMesh,
  pose: CollarMotionPose,
  neckDepth: number,
  bodyPivotX: number,
  bodyPivotY: number,
  bodyRotationCosine: number,
  bodyRotationSine: number,
): void {
  for (let index = 0; index < clip.rest.length; index += 2) {
    const headBlend = collarNeckHeadBlend(clip.rest[index + 1], pose)
    transformCollarPoint(
      clip.rest[index],
      clip.rest[index + 1],
      BODY_HEAD_FOLLOW + (1 - BODY_HEAD_FOLLOW) * headBlend,
      neckDepth,
      headBlend,
      true,
      pose,
      clip.deformed,
      index,
    )
    const rotationX = clip.deformed[index] - bodyPivotX
    const rotationY = clip.deformed[index + 1] - bodyPivotY
    clip.deformed[index] =
      bodyPivotX + rotationX * bodyRotationCosine - rotationY * bodyRotationSine
    clip.deformed[index + 1] =
      bodyPivotY + rotationX * bodyRotationSine + rotationY * bodyRotationCosine
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, clip.vertexBuffer)
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, packVertices(clip.deformed, clip.uvs))
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

interface CroppedLayerTexture {
  texture: WebGLTexture
  pixels: Uint8ClampedArray | null
  width: number
  height: number
}

function cropLayerTexture(
  gl: WebGL2RenderingContext,
  atlas: HTMLImageElement,
  source: Anime25DPlaybackLayer,
  readPixels = false,
): CroppedLayerTexture {
  const sx = Math.max(0, Math.round(source.atlas.x * atlas.width))
  const sy = Math.max(0, Math.round(source.atlas.y * atlas.height))
  const sw = Math.max(1, Math.round(source.atlas.w * atlas.width))
  const sh = Math.max(1, Math.round(source.atlas.h * atlas.height))
  const crop = document.createElement('canvas')
  crop.width = sw
  crop.height = sh
  const context = crop.getContext('2d')
  if (!context) throw new Error(currentCopy().merope.anime25dPlaybackFailed)
  context.drawImage(atlas, sx, sy, sw, sh, 0, 0, sw, sh)
  let pixels: Uint8ClampedArray | null = null
  if (readPixels) {
    try {
      pixels = context.getImageData(0, 0, sw, sh).data
    } catch {
      pixels = null
    }
  }
  const texture = gl.createTexture()
  if (!texture) throw new Error(currentCopy().merope.anime25dPlaybackFailed)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, crop)
  return { texture, pixels, width: sw, height: sh }
}

function layerBaseName(role: string): string {
  if (role === 'front-hair') return 'front hair'
  if (role === 'back-hair') return 'back hair'
  return role.replace(/-/g, '_')
}

function resolveMouthMorph(
  layers: readonly GpuLayer[],
  driver: Anime25DDriver,
  fallback: Anime25DPlayback['anchors']['mouth'],
  face: Anime25DPlayback['anchors']['face'],
  output: MouthMorphState,
): void {
  const openMix = mouthOpenMix(driver)
  const shapeScale = mouthShapeScale(driver)
  const articulation = 1 - smoothstep(driver.mouthSeal)
  const wide = driver.mouthWide * shapeScale * articulation
  const round = driver.mouthRound * shapeScale * articulation
  const narrow = driver.mouthNarrow * shapeScale * articulation
  const open = Math.max(0, 1 - wide - round - narrow)
  const maniac = smoothstep(driver.maniac)
  const regular = 1 - maniac
  output.openMix = Math.max(openMix, maniac)
  output.wide = wide
  output.round = round
  output.narrow = narrow

  let total = 0
  output.centerX = 0
  output.centerY = 0
  output.width = 0
  output.height = 0
  let closed: Anime25DPlaybackLayer | undefined
  let ordinary: Anime25DPlaybackLayer | undefined
  let wideLayer: Anime25DPlaybackLayer | undefined
  let roundLayer: Anime25DPlaybackLayer | undefined
  let narrowLayer: Anime25DPlaybackLayer | undefined
  let maniacLayer: Anime25DPlaybackLayer | undefined
  for (const layer of layers) {
    if (layer.source.fade === 'mouthClose') closed ??= layer.source
    else if (layer.source.fade === 'mouthOpen') ordinary ??= layer.source
    else if (layer.source.fade === 'mouthWide') wideLayer ??= layer.source
    else if (layer.source.fade === 'mouthRound') roundLayer ??= layer.source
    else if (layer.source.fade === 'mouthNarrow') narrowLayer ??= layer.source
    else if (layer.source.fade === 'mouthManiac') maniacLayer ??= layer.source
  }
  if (closed)
    total += addMouthMorphSource(output, closed, (1 - openMix) * regular)
  if (ordinary)
    total += addMouthMorphSource(output, ordinary, openMix * open * regular)
  if (wideLayer)
    total += addMouthMorphSource(output, wideLayer, openMix * wide * regular)
  if (roundLayer)
    total += addMouthMorphSource(output, roundLayer, openMix * round * regular)
  if (narrowLayer)
    total += addMouthMorphSource(
      output,
      narrowLayer,
      openMix * narrow * regular,
    )
  if (maniacLayer) total += addMouthMorphSource(output, maniacLayer, maniac)
  if (total <= 0) {
    output.centerX = fallback.cx
    output.centerY = fallback.cy
    output.width = Math.max(1, fallback.x1 - fallback.x0)
    output.height = Math.max(1, fallback.y1 - fallback.y0)
    return
  }
  output.centerX /= total
  output.centerY /= total
  output.width = Math.max(1, output.width / total)
  output.height = Math.max(1, output.height / total)
  if (closed && output.openMix > 0) {
    const blendedTop = output.centerY - output.height / 2
    const blendedBottom = output.centerY + output.height / 2
    const neutralTop = closed.y
    const neutralBottom = closed.y + closed.h
    const upperRelease = 0.32 + maniac * 0.68
    const lowerRelease = 0.88 + maniac * 0.12
    const anchoredTop = neutralTop + (blendedTop - neutralTop) * upperRelease
    const releasedBottom =
      neutralBottom + (blendedBottom - neutralBottom) * lowerRelease
    output.centerY = (anchoredTop + releasedBottom) / 2
    output.height = Math.max(1, releasedBottom - anchoredTop)
  }
  if (maniac > 0) {
    // An extreme mouth must still fit the character's lower face.
    // Blend the guard with the expression so entry/exit remains continuous.
    const faceWidth = Math.max(1, face.x1 - face.x0)
    const faceHeight = Math.max(1, face.y1 - face.y0)
    const maximumWidth = faceWidth * 0.54
    const chinMargin = Math.max(2, faceHeight * 0.01)
    const lowerFaceRoom = Math.max(1, face.y1 - fallback.cy - chinMargin)
    const maximumHeight = Math.max(1, lowerFaceRoom / 0.44)
    const guardedWidth = Math.min(output.width, maximumWidth)
    const guardedHeight = Math.min(output.height, maximumHeight)
    const guardedCenterY = Math.min(output.centerY, fallback.cy)
    output.width += (guardedWidth - output.width) * maniac
    output.height += (guardedHeight - output.height) * maniac
    output.centerY += (guardedCenterY - output.centerY) * maniac
  }
}

function addMouthMorphSource(
  output: MouthMorphState,
  source: Anime25DPlaybackLayer,
  weight: number,
): number {
  if (weight <= 0) return 0
  output.centerX += (source.x + source.w / 2) * weight
  output.centerY += (source.y + source.h / 2) * weight
  output.width += source.w * weight
  output.height += source.h * weight
  return weight
}

function mouthOpenMix(driver: Anime25DDriver): number {
  const opening = smoothstep(
    (driver.mouthOpen - (0.02 + driver.mouthEase * 0.08)) /
      (0.53 + driver.mouthEase * 0.17),
  )
  return opening * (1 - smoothstep(driver.mouthSeal))
}

function mouthShapeScale(driver: Anime25DDriver): number {
  const total = driver.mouthWide + driver.mouthRound + driver.mouthNarrow
  return total > 1 ? 1 / total : 1
}

function applyMouthTransitionBridge(
  output: MouthMorphState,
  transition: Readonly<MouthTransitionSample>,
): void {
  output.width = Math.max(1, output.width * transition.widthScale)
  output.height = Math.max(1, output.height * transition.heightScale)
  output.centerX += transition.centerOffsetX
  output.centerY += transition.centerOffsetY
  const retainedShape = 1 - transition.shapeNeutralization
  output.wide *= retainedShape
  output.round *= retainedShape
  output.narrow *= retainedShape
}

export function fadeOpacity(
  layer: Anime25DPlaybackLayer,
  driver: Anime25DDriver,
  activeMouthMaterial?: SpeechMouthMaterial,
): number {
  if (!layer.fade) return 1
  const dizzy = smoothstep(driver.eyeDizzy)
  const cry = smoothstep(driver.eyeCry)
  const mouthCry = cry * (1 - dizzy)
  const squeeze = smoothstep(driver.eyeSqueeze)
  const anger = smoothstep(driver.anger)
  const speechless = smoothstep(driver.speechless)
  const maniac = smoothstep(driver.maniac)
  const symbolBlocker = (1 - dizzy) * (1 - squeeze) * (1 - cry)
  if (layer.fade === 'eyeDizzy') return dizzy
  if (layer.fade === 'eyeCry') return cry * (1 - dizzy)
  if (layer.fade === 'maniacEyeShadow') return maniac * symbolBlocker
  if (layer.fade === 'maniacMouthShadow') return maniac * symbolBlocker
  if (layer.fade === 'angerMark') return anger * (1 - maniac) * symbolBlocker
  if (layer.fade === 'speechlessSweat') {
    return speechless * (1 - anger) * (1 - maniac) * symbolBlocker
  }
  if (layer.fade === 'mouthCry') return mouthCry
  if (layer.fade === 'eyeSqueeze') {
    return squeeze * (1 - dizzy) * (1 - cry)
  }
  if (layer.fade === 'eyeOpen' || layer.fade === 'eyeClose') {
    const open = layer.side === 'L' ? driver.eyeOpenL : driver.eyeOpenR
    const faded = smoothstep((open - (0.1 + driver.eyeEase * 0.45)) / 0.15)
    return (
      (layer.fade === 'eyeOpen' ? faded : 1 - faded) *
      (1 - dizzy) *
      (1 - squeeze) *
      (1 - cry)
    )
  }
  if (
    layer.fade === 'mouthOpen' ||
    layer.fade === 'mouthWide' ||
    layer.fade === 'mouthRound' ||
    layer.fade === 'mouthNarrow' ||
    layer.fade === 'mouthClose' ||
    layer.fade === 'mouthManiac'
  ) {
    const selected = activeMouthMaterial ?? dominantMouthMaterial(driver)
    return (layer.fade === selected ? 1 : 0) * (1 - mouthCry)
  }
  return 1
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

function packVertices(
  positions: Float32Array,
  uvs: Float32Array,
): Float32Array {
  const packed = new Float32Array(positions.length * 2)
  for (let index = 0; index < positions.length; index += 2) {
    const write = index * 2
    packed[write] = positions[index]
    packed[write + 1] = positions[index + 1]
    packed[write + 2] = uvs[index]
    packed[write + 3] = uvs[index + 1]
  }
  return packed
}

function compileProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  const program = gl.createProgram()
  if (!program) throw new Error(currentCopy().merope.anime25dPlaybackFailed)
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(currentCopy().merope.anime25dPlaybackFailed)
  }
  return program
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error(currentCopy().merope.anime25dPlaybackFailed)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    throw new Error(currentCopy().merope.anime25dPlaybackFailed)
  }
  return shader
}

function requiredUniform(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name)
  if (!location) throw new Error(currentCopy().merope.anime25dPlaybackFailed)
  return location
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Anime2.5DRig atlas failed to load'))
    image.src = url
  })
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
