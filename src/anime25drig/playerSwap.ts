import type { MeropeRigManifest } from '../rig/types'
import type { Anime25DArmVariants, ArmVariantBinding } from './armVariantPresenter'
import type { BodyBinding } from './bodyBinding'
import type { Anime25DBodyFrames } from './bodyFrames'
import type { ContinuousMouthTexture } from './continuousMouthTexture'
import type { Anime25DDriver } from './driver'
import type { Anime25DFaceFrames, FaceBinding } from './faceFrames'
import type { MotionFigure } from './motionComposer'
import type { Anime25DHandPose, Anime25DMotionEnvelopeProfile } from './motionEnvelope'
import type { PreparedLivePackage } from './playerPackage'
import type { Anime25DPlayback } from './types'
import { sampleDizzyEyeTint } from '../expressionShapes/dizzyEye'
import { boundRigCapabilities } from '../motion/rigStateSummary'
import { resolveAnime25DLayerSemantics } from '../rig/anime25dLayerSemantics'
import { measureMotionFigure } from './motionComposer'
import { deriveAnime25DMotionEnvelopeProfile } from './motionEnvelope'
import { createContinuousMouth, prepareLivePackage, releaseCompiledGpu } from './playerPackage'
import { isStandingFigure } from './standing'

// An outfit swap in two halves: everything the next outfit needs is measured and made here, beside the live one
// and touching nothing of it; the player then takes it in a step that cannot fail. A swap that fails here leaves
// the figure on screen exactly as it was.

/** A package measured for the motion, the body and the face, not yet the live one. */
export interface PackageState {
  playback: Anime25DPlayback
  rigManifest: MeropeRigManifest | undefined
  motionEnvelopeProfile: Anime25DMotionEnvelopeProfile
  figure: MotionFigure
  body: BodyBinding
  face: FaceBinding
}

/** The next outfit, ready to take: compiled, its arms measured and mouth made, what the motion reads of it. */
export interface PreparedSwap {
  prepared: PreparedLivePackage
  state: PackageState
  arms: ArmVariantBinding
  mouth: ContinuousMouthTexture | null
  capabilities: readonly string[]
  tint: ReturnType<typeof sampleDizzyEyeTint>
}

/** The player's parts a swap measures against; it reads them and changes none of what they show. */
export interface SwapParts {
  gl: WebGL2RenderingContext
  program: WebGLProgram
  current: Anime25DDriver
  body: Anime25DBodyFrames
  face: Anime25DFaceFrames
  armVariants: Anime25DArmVariants
}

/** A package measured for the motion, the body and the face; nothing live changes. */
export function measurePackage(
  parts: Pick<SwapParts, 'body' | 'face'>,
  playback: Anime25DPlayback,
  rigManifest?: MeropeRigManifest,
  hands: Anime25DHandPose = {},
): PackageState {
  playback = {
    ...playback,
    layers: playback.layers.map(resolveAnime25DLayerSemantics),
  }
  const motionEnvelopeProfile = deriveAnime25DMotionEnvelopeProfile(
    playback,
    rigManifest,
    hands,
  )
  return {
    playback,
    rigManifest,
    motionEnvelopeProfile,
    figure: measureMotionFigure(playback),
    body: parts.body.measure(playback, motionEnvelopeProfile),
    face: parts.face.measure(playback),
  }
}

/** Everything the next outfit needs, made beside the live one. Fails having released what it made. */
export function prepareSwap(
  parts: SwapParts,
  playback: Anime25DPlayback,
  rigManifest: MeropeRigManifest | undefined,
  image: HTMLImageElement,
): PreparedSwap {
  const { gl, program } = parts
  const prepared = prepareLivePackage(gl, program, playback, rigManifest, image, parts.current)
  const { resolved, compiled } = prepared
  let mouth: ContinuousMouthTexture | null = null
  try {
    const state = measurePackage(parts, playback, rigManifest, {
      linked: compiled.armsLinked,
      touchingHead: compiled.handTouchesHead,
    })
    const arms = parts.armVariants.measure(compiled.layers, resolved.pixelCanvas.height, { gl, atlas: image, canvasWidth: resolved.pixelCanvas.width, texture: prepared.texture ?? undefined, program })
    mouth = createContinuousMouth(gl, resolved, image, compiled.layers)
    parts.body.measureLayers(state.body, compiled.layers, compiled.headSilhouette ?? null, Boolean(playback.turnKeyforms))
    const shell = resolved.shellProfile
    const capabilities = boundRigCapabilities(rigManifest, {
      torsoVolume: shell.enabled && shell.blend > 0 && shell.torso.enabled && shell.torso.blend > 0,
      arms: state.motionEnvelopeProfile.rigidArm.limit > 0 && !isStandingFigure(playback.anchors)
        ? compiled.layers.flatMap(layer => {
            const binding = layer.secondaryDeformation
            return binding.arm && binding.armMesh && (binding.handwearSide === 'L' || binding.handwearSide === 'R')
              ? [binding.handwearSide] : []
          }) : [],
    })
    return {
      prepared, state, arms, mouth, capabilities,
      tint: sampleDizzyEyeTint(prepared.linePixels),
    }
  } catch (error) {
    // Keep the live outfit; the not-yet-owned replacement must be released.
    mouth?.dispose()
    releaseCompiledGpu(gl, compiled.layers, compiled.collarClip, prepared.texture)
    throw error
  }
}

/** Lets a prepared outfit go without taking it. */
export function releaseSwap(parts: Pick<SwapParts, 'gl'>, next: PreparedSwap): void {
  next.mouth?.dispose()
  const { compiled, texture } = next.prepared
  releaseCompiledGpu(parts.gl, compiled.layers, compiled.collarClip, texture)
}
