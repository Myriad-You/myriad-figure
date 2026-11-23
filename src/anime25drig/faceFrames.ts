import type { ClosedEyePresentation } from './closedEyePresentation'
import type { ContinuousMouthTexture } from './continuousMouthTexture'
import type { Anime25DDeformationChangeState } from './deformationDependencies'
import type { Anime25DDriver } from './driver'
import type { Anime25DExpressionDeformationFrame } from './expressionDeformation'
import type { Anime25DIrisRebound } from './irisRebound'
import type { Anime25DGpuLayer } from './layerGpuBinding'
import type { Anime25DMouthDeformationFrame } from './mouthDeformation'
import type {
  Anime25DMouthMorphSources,
  Anime25DOpacityFrame,
  MouthMorphState,
} from './mouthRuntime'
import type { SpeechMouthMaterial } from './mouthTransition'
import type { StylizedExpressionMotion } from './stylizedExpressionMotion'
import type { Anime25DPlayback } from './types'
import { resolveAnime25DFaceFrame } from '../expressionShapes/faceFrame'
import {
  captureAnime25DDeformationChanges,
  createAnime25DDeformationChangeState,
} from './deformationDependencies'
import {
  applyMouthTransitionBridge,
  compileAnime25DMouthMorphSources,
  createAnime25DOpacityFrame,
  fadeOpacityFromFrame,
  resolveMouthMorph,
  writeAnime25DOpacityFrame,
} from './mouthRuntime'
import { MouthTransitionController } from './mouthTransition'

/** A package's face, measured and not yet the one shown. */
export interface FaceBinding {
  anchors: Anime25DPlayback['anchors']
  mouthTransition: MouthTransitionController
  mouthMorphSources: Anime25DMouthMorphSources
  deformationFrame: Anime25DMouthDeformationFrame & Anime25DExpressionDeformationFrame
}

/** What the face contributes to one frame beyond the driver itself. */
export interface FaceFrameInput {
  time: number
  jawDrop: number
  jawOpen: number
  stylizedMotion: Readonly<StylizedExpressionMotion> | null
  sillyMouthShare: number
}

/**
 * The face between the driver and the drawn layers: the speaking mouth's
 * shape and material, the expression deformation frame, and which fading
 * layers show. Returns what changed so unchanged layers can skip work.
 */
export class Anime25DFaceFrames {
  private readonly mouthMorph: MouthMorphState = {
    centerX: 0,
    centerY: 0,
    width: 1,
    height: 1,
    openMix: 0,
    wide: 0,
    round: 0,
    narrow: 0,
    openCenterY: 0,
    openHeight: 1,
  }

  private mouthMorphSources!: Anime25DMouthMorphSources
  private readonly opacityFrame: Anime25DOpacityFrame =
    createAnime25DOpacityFrame()

  private readonly deformationChangeState: Anime25DDeformationChangeState =
    createAnime25DDeformationChangeState()

  /** The frame the mouth and expression deformation of every layer reads. */
  deformationFrame!: Anime25DMouthDeformationFrame &
    Anime25DExpressionDeformationFrame

  /** The speaking mouth drawn live, when the portrait's speaking mouths are the importer's. */
  private continuousMouth: ContinuousMouthTexture | null = null
  private mouthTransition!: MouthTransitionController
  private activeMouthMaterial: SpeechMouthMaterial = 'mouthClose'
  private anchors!: Anime25DPlayback['anchors']

  constructor(
    private readonly current: Anime25DDriver,
    private readonly irisRebound: Anime25DIrisRebound,
    private readonly closedEyes: ClosedEyePresentation,
  ) {}

  /** Measures a new package's mouths and face; the face keeps the one it has until it is bound. */
  measure(playback: Anime25DPlayback): FaceBinding {
    const mouthTransition = new MouthTransitionController(playback.mouthProfile)
    const mouthMorphSources = compileAnime25DMouthMorphSources(playback.layers)
    const faceFrame = resolveAnime25DFaceFrame(playback.anchors)
    const deformationFrame: FaceBinding['deformationFrame'] = {
      mouth: playback.anchors.mouth,
      face: playback.anchors.face,
      faceAxes: { cos: faceFrame.cos, sin: faceFrame.sin },
      faceScale: playback.anchors.faceScale,
      morph: this.mouthMorph,
      mouthMorph: this.mouthMorph,
      expression: this.current,
      jawDrop: 0,
      jawOpen: 0,
      time: 0,
      stylizedMotion: null,
    }
    return { anchors: playback.anchors, mouthTransition, mouthMorphSources, deformationFrame }
  }

  /** Takes a measured package's face. */
  bind(binding: FaceBinding): void {
    this.anchors = binding.anchors
    this.mouthTransition = binding.mouthTransition
    this.mouthMorphSources = binding.mouthMorphSources
    this.deformationFrame = binding.deformationFrame
  }

  /** Takes the new atlas's live speaking mouth (null when the portrait has none), releasing the one before. */
  bindAtlas(mouth: ContinuousMouthTexture | null): void {
    this.continuousMouth?.dispose()
    this.continuousMouth = mouth
  }

  dispose(): void {
    this.continuousMouth?.dispose()
    this.continuousMouth = null
  }

  prepare(input: FaceFrameInput, layers: readonly Anime25DGpuLayer[]): number {
    const A = this.anchors
    const e = this.current
    const t = input.time
    const { jawDrop, jawOpen } = input
    const mouthTransition = this.mouthTransition.sample(e, t)
    this.activeMouthMaterial = mouthTransition.material
    resolveMouthMorph(
      this.mouthMorphSources,
      e,
      A.mouth,
      A.face,
      this.mouthMorph,
    )
    applyMouthTransitionBridge(this.mouthMorph, mouthTransition)
    if (this.continuousMouth && this.mouthMorph.openMix > 0) this.continuousMouth.paint(this.mouthMorph)
    const deformationFrame = this.deformationFrame
    deformationFrame.faceScale = A.faceScale
    deformationFrame.jawDrop = jawDrop
    deformationFrame.jawOpen = jawOpen
    deformationFrame.time = t
    deformationFrame.stylizedMotion = input.stylizedMotion
    writeAnime25DOpacityFrame(
      this.opacityFrame,
      e,
      this.activeMouthMaterial,
      input.sillyMouthShare,
      mouthTransition,
      this.continuousMouth !== null,
    )
    const deformationChanges = captureAnime25DDeformationChanges(
      this.deformationChangeState,
      e,
      this.mouthMorph,
      jawDrop,
      jawOpen,
      input.stylizedMotion,
      this.irisRebound,
    )
    for (const layer of layers) {
      layer.frameOpacity =
        fadeOpacityFromFrame(layer.source, this.opacityFrame) *
        this.closedEyes.opacity(layer.source)
    }
    return deformationChanges
  }
}
