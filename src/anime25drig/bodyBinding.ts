import type { ChestDeformationRegion, ChestDynamicsTuning, ChestMotionGeometry, ChestSpatialField } from './chestPhysics'
import type { CollarMotionPose } from './collarRuntime'
import type { Anime25DDriver } from './driver'
import type { Anime25DHairSpringFrame } from './hairPhysics'
import type { HeadSilhouette, HeadTurn } from './headTurn'
import type { JellyElement } from './jellyVolume'
import type { LayerJelly } from './layerFrameDeformation'
import type { Anime25DGpuLayer } from './layerGpuBinding'
import type { Anime25DMotionEnvelopeProfile } from './motionEnvelope'
import type { Anime25DSecondaryDeformationFrame } from './secondaryDeformation'
import type { Anime25DShellRotation } from './shellDeformation'
import type { Anime25DTorsoShellRotation } from './torsoDeformation'
import type { Anime25DPlayback, Anime25DShellProfile } from './types'
import { BodyLiftResponse } from './bodyLift'
import { bodyKeyShare } from './bodyTurnKeyforms'
import { resolveChestDeformationRegion, resolveChestDynamics, resolveChestSpatialField } from './chestPhysics'
import { FigureBody } from './figureSkeleton'
import { createHeadTurn, headTurnRadians } from './headTurn'
import { jawTravelPixels } from './jawMotion'
import { JellyVolume, SLEEVE_JELLY } from './jellyVolume'
import { movingPartIn, skirtTuning } from './partPhysics'
import { Anime25DStanding } from './standing'
import { figureShellProfile, resolveAnime25DTorsoChestShape } from './torsoDeformation'

// What the body measures of a package before it moves it: everything built from the package's anchors, chest
// and layers, made beside the package the body is moving and taken in one step by Anime25DBodyFrames.bind().

/** Share of an arm with a bare forearm that is sleeve: only that much of it is soft. */
const SLEEVE_SOFT_REACH = 0.55

export interface JellyPart extends LayerJelly {
  volume: JellyVolume
  /** The shoulder the sleeve hangs from. */
  side: 'L' | 'R'
}

/** What the body takes of its package's compiled layers. */
interface BodyLayerBinding {
  headTurn: HeadTurn
  bodyLiftResponse: BodyLiftResponse
  bodyPitchResponse: BodyLiftResponse
  jellyParts: Map<Anime25DGpuLayer, JellyPart>
  headJellyElement: JellyElement | null
}

/** A package measured for the body, not yet the one it moves. */
export interface BodyBinding {
  anchors: Anime25DPlayback['anchors']
  figure: FigureBody | null
  shellProfile: Anime25DShellProfile
  bodyKeyShare: number | null
  chestProfile: Anime25DPlayback['chestProfile']
  neckDepth: number
  jawTravel: number
  chestField: ChestSpatialField
  chestDynamics: ChestDynamicsTuning
  chestRegion: ChestDeformationRegion
  chestGeometry: ChestMotionGeometry
  secondaryDeformationFrame: Anime25DSecondaryDeformationFrame
  standing: Anime25DStanding | null
  collarMotion: CollarMotionPose
  hairSpringFrame: Anime25DHairSpringFrame
  /** Measured from the compiled layers (measureLayers); null leaves the body's as they are. */
  layers: BodyLayerBinding | null
}

/** The frames the body keeps across packages, which a new package's frames point at. */
export interface BodyOwnedFrames {
  current: Anime25DDriver
  shellRotation: Anime25DShellRotation
  torsoShellRotation: Anime25DTorsoShellRotation
}

/** Measures a new package for the body: anchors, chest, jaw travel and the frames built on them. */
export function measureBody(
  owned: BodyOwnedFrames,
  playback: Anime25DPlayback,
  motionEnvelopeProfile: Anime25DMotionEnvelopeProfile,
): BodyBinding {
  const figure = FigureBody.of(playback.anchors, playback.partProfile, playback.figureStance, playback)
  const shellProfile = figure ? figureShellProfile(playback.shellProfile) : playback.shellProfile
  const keyShare = bodyKeyShare(playback)
  const neckDepth =
    playback.layers.find((layer) => layer.role === 'neck')?.depth ?? 0.95
  const jawTravel = jawTravelPixels(playback)
  const chestField = resolveChestSpatialField(playback.chestProfile)
  const chestDynamics = resolveChestDynamics(
    playback.chestProfile,
    chestField,
  )
  const anchors = playback.anchors
  const chestRegion = resolveChestDeformationRegion(playback.chestProfile)
  const chestGeometry: ChestMotionGeometry = {
    faceScale: anchors.faceScale,
    faceCenterY: anchors.face.cy,
    neckX: anchors.neckPivot.x,
    neckY: anchors.neckPivot.y,
    centerX: chestRegion.centerX,
    centerY: chestRegion.centerY,
    depth:
      playback.layers.find((layer) => layer.role === 'topwear')?.depth ?? 0.9,
  }
  const neckFollowTop = Math.min(
    anchors.neckBottom - 1,
    Math.max(anchors.neckTop, anchors.face.y1 + anchors.faceScale * 5),
  )
  const secondaryDeformationFrame: Anime25DSecondaryDeformationFrame = {
    bodyRotationCosine: 1,
    bodyRotationSine: 0,
    expression: owned.current,
    faceScale: anchors.faceScale,
    headAngleY: 0,
    headRotationCosine: 1,
    headRotationSine: 0,
    headRoll: 0,
    hairDrapeLength: (anchors.face.y1 - anchors.face.y0) * 1.5,
    bodyPivotY: anchors.bodyPivot.y,
    bodyBendHeight: Math.max(1, anchors.bodyPivot.y - anchors.neckBottom),
    neckPivotX: anchors.neckPivot.x,
    neckPivotY: anchors.neckPivot.y,
    neckBottom: anchors.neckBottom,
    neckFollowTop,
    neckFollowSpan: Math.max(1, anchors.neckBottom - neckFollowTop),
    faceCenterY: anchors.face.cy,
    bodyBreathOffset: 0,
    headBreathOffset: 0,
    torsoProfile: shellProfile.torso,
    torsoChestShape: resolveAnime25DTorsoChestShape(
      playback.chestProfile,
      chestField,
    ),
    torsoShellRotation: owned.torsoShellRotation,
    torsoShellBlend: 0,
    torsoNeckOffsetX: 0,
    specialHeadOffset: 0,
    highCollar: motionEnvelopeProfile.highCollar,
    breath: 0,
    armAngleL: 0,
    armAngleR: 0,
    armDrapeL: 0,
    armDrapeR: 0,
    forearmL: 0,
    forearmR: 0,
    handL: 0,
    handR: 0,
    reachL: 0,
    reachR: 0,
    chestCenterX: chestRegion.centerX,
    chestRegionCenterY: chestRegion.centerY,
    chestMotionCenterY: chestRegion.centerY,
    chestRadiusY: chestRegion.radiusY,
    inverseChestRadiusX: 1 / chestRegion.radiusX,
    inverseChestRadiusY: 1 / chestRegion.radiusY,
    chestOffsetX: 0,
    chestOffsetY: 0,
    chestField,
    chestVolumeScale: 1,
    shellProfile,
    shellBlend: 0,
    shellActivation: 0,
    shellRotation: owned.shellRotation,
    standing: null,
    figure,
  }
  // With bones the figure sways from its feet, hips and shoulders together.
  const standing = Anime25DStanding.of(anchors, Boolean(figure), skirtTuning(movingPartIn(playback.partProfile, 'bottomwear')), figure?.hipShift)
  const collarMotion: CollarMotionPose = {
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
    torsoProfile: shellProfile.torso,
    torsoShellBlend: 0,
    torsoNeckOffsetX: 0,
    neckBottom: anchors.neckBottom,
    chestRegionCenterY: chestRegion.centerY,
    torsoShellRotation: owned.torsoShellRotation,
    headTurn: null,
    keyedHead: false,
  }
  const hairSpringFrame: Anime25DHairSpringFrame = {
    enabled: true,
    idle: true,
    faceScale: anchors.faceScale,
    time: 0,
    frontSoft: 0,
    rearSoft: 0,
    tilt: 0,
  }
  return {
    anchors, figure, shellProfile, bodyKeyShare: keyShare, chestProfile: playback.chestProfile, neckDepth, jawTravel,
    chestField, chestDynamics, chestRegion, chestGeometry, secondaryDeformationFrame, standing, collarMotion,
    hairSpringFrame, layers: null,
  }
}

/** Measures a package's compiled layers into its body binding: the head turn's silhouette and the soft volumes. */
export function measureBodyLayers(binding: BodyBinding, layers: readonly Anime25DGpuLayer[], headSilhouette: HeadSilhouette | null, keyedHead = false): void {
  const headTurn = createHeadTurn(headSilhouette, headTurnRadians(keyedHead))
  binding.secondaryDeformationFrame.headTurn = headTurn
  binding.secondaryDeformationFrame.keyedHead = keyedHead
  binding.collarMotion.headTurn = headTurn
  binding.collarMotion.keyedHead = keyedHead
  binding.layers = { headTurn, ...measureJelly(binding.anchors, layers) }
}

/** The soft volumes of a package's layers: the head's, and each hanging sleeve's from its shoulder. */
function measureJelly(anchors: Anime25DPlayback['anchors'], layers: readonly Anime25DGpuLayer[]): Omit<BodyLayerBinding, 'headTurn'> {
  const bodyLiftResponse = new BodyLiftResponse()
  const bodyPitchResponse = new BodyLiftResponse()
  const jellyParts = new Map<Anime25DGpuLayer, JellyPart>()
  const face = anchors.face
  const faceHeight = face.y1 - face.y0
  const headJellyElement: JellyElement | null = faceHeight > 0
    ? { anchorX: face.cx, anchorY: face.y1, axisX: 0, axisY: -1, length: faceHeight * 1.5, cutY: null }
    : null
  if (headJellyElement) {
    for (const layer of layers) {
      const binding = layer.secondaryDeformation
      if (binding.handwear && binding.arm && binding.arm.scale === 1 && binding.handwearSide) {
        // A hanging sleeve's cloth hangs from the shoulder joint.
        const arm = binding.arm
        jellyParts.set(layer, {
          element: {
            anchorX: arm.pivotX, anchorY: arm.pivotY, axisX: 0, axisY: 1, length: arm.length, cutY: arm.cutY,
            // Cloth all the way down is soft all the way; a bare forearm and hand are not.
            softReach: arm.drape ? 1 : SLEEVE_SOFT_REACH,
          },
          volume: new JellyVolume(SLEEVE_JELLY),
          side: binding.handwearSide === 'L' ? 'L' : 'R',
        })
      }
    }
  }
  return { bodyLiftResponse, bodyPitchResponse, jellyParts, headJellyElement }
}
