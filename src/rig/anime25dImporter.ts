import type { CharacterAssetProfile } from '@myriad-you/figure-player/internals'
import type { Psd } from 'ag-psd'
import type { Anime25DSourceReference } from './anime25dImportTypes'
import type { ArmVariantReference } from './armVariants'
import type { AuthoredExpressionReference } from './authoredExpression'
import type { ImportTimer } from './importTiming'
import type { MotionExposureFinding } from './motionExposure'
import type { Anime25DPsdReconciliation } from './psdReconciliation'
import type { PsdSkeleton } from './skeleton'
import type { MeropeRigImportSource } from './types'
import { anime25DBaseRole, CHARACTER_ASSET_PROFILES, MAX_RIG_PARTS, normalizeAnime25DLayerName, resolveAnime25DFaceFrame } from '@myriad-you/figure-player/internals'
import { analyzeAnime25DMouthProfile } from '../anime25drig/mouthProfile'
import { buildAnime25DPlayback, remapSourceAnchors } from '../anime25drig/playback'
import { rigger as Rigger } from '../anime25drig/upstream/rigger'
import { FigureError } from '../errors'
import { estimateAnime25DMouthAnchor } from '../expressionShapes/faceFrame'
import { paintAccessoriesFromReference } from './accessoryPaint'
import { validateAnime25DCharacterLayers } from './anime25dAssetValidation'
import { packAnime25DAtlas, visibleInAnalysisReference } from './anime25dAtlasCompiler'
import { splitHighCollarOcclusion } from './anime25dCollarCompiler'
import { compileAnime25DExpressionLayers } from './anime25dExpressionCompiler'
import { anime25DImportProfile } from './anime25dImportProfile'
import { buildAnime25DBonesAndHandles, buildAnime25DLayerSources } from './anime25dSkeletonCompiler'
import { cutArmVariantLayers } from './armVariants'
import { addAuthoredExpressionLayers } from './authoredExpression'
import { compensateSyntheticClosedEyeAngles } from './closedEyeCompensation'
import { keepClosedEyeLines } from './closedEyeLines'
import { RIG_IR_VERSION } from './contract'
import { revealCrownUnderFace } from './crownUnderFace'
import { raiseEarwearOverFrontHair } from './earwearOrder'
import { synthesizeMissingExpressionAccents } from './expressionAccentLayers'
import { underlapHairLocks } from './hairLockUnderlap'
import { liftHairShadowOffSkin } from './hairShadow'
import { hangTopPiecesOnHeadwear } from './headOrnaments'
import { contentFrame, deriveAnchors, semanticAnchors, standingStance } from './importerAnchors'
import { assignCrossfadeSlots, hasStaticSeeThroughMouth, mirrorLostEyeWhite, preserveStaticMouthAsClosed, splitHandwearIfNeeded, splitLowerLimbsIfNeeded, splitVariantEyesIfNeeded, stackArmsByReference, stackEarwearByReference, stackHeadwearByReference, stackLowerLimbsByReference, stackNeckwearByReference, stackOpenEyesInOrder, tuckBackHairBehindNeck, tuckBehindFace, tuckTopUnderChinBehindNeck } from './importerLayerSplits'
import { addHiddenArmFragments, anime25DShoulderSeeds } from './linkedHandwear'
import { findMotionExposure } from './motionExposure'
import { inferOutfitProfileFromPartIds } from './outfit'
import { repairAnime25DPsd } from './psdRepair'
import { flattenPsdForRigger, flattenVisibleLayers, genericCloseParts, rasterFromRiggerPart } from './riggerBridge'
import { skeletonInFrame } from './skeleton'
import { tuckGarmentOffLegsByReference, tuckGarmentOffNeckByReference, tuckLiningBehindLegs } from './skirtLining'
import { dropTopSkinOverNeck } from './topSkinOverNeck'
import { splitTrouserLegsIfNeeded } from './trouserLegs'

export type { Anime25DSourceReference } from './anime25dImportTypes'
export { ANIME25D_LAYER_DEPTH } from '@myriad-you/figure-player/internals'
export type { Anime25DLayerRole } from '@myriad-you/figure-player/internals'

export interface PreparedAnime25DRigImport {
  atlas: Blob
  analysisReference: Blob
  source: MeropeRigImportSource
  partCount: number
  /** Diagnosis against the source illustration; absent without one. */
  reconciliation: Anime25DPsdReconciliation | null
  /** Holes a blink or a spoken vowel would open in the face. */
  motionExposure: MotionExposureFinding[]
  /** The document and where the playback frame cuts it, for keys measured on the document. */
  documentFrame: { width: number; height: number; x: number; y: number }
}
export { anime25DBaseRole, normalizeAnime25DLayerName } from '@myriad-you/figure-player/internals'

export function isAnime25DDocument(psd: Psd): boolean {
  const names = flattenVisibleLayers(psd.children ?? []).map((layer) =>
    normalizeAnime25DLayerName(layer.name),
  )
  return names.some((name) => anime25DBaseRole(name) === 'face')
}

export interface Anime25DRigPsdOptions {
  sourceMasterAssetId: string
  onStage?: (stage: 'validated' | 'packing') => void
  sourceGenerationFingerprint?: string
  /** The portrait drawn onto the PSD's frame, to reconcile the layers with. */
  sourceReference?: Anime25DSourceReference
  expressionReferences?: readonly AuthoredExpressionReference[]
  /** Gesture arms drawn on the portrait, raised in at run time (armVariants). */
  armVariantReferences?: readonly ArmVariantReference[]
  /** The bust by default. */
  profile?: CharacterAssetProfile
  skeleton?: PsdSkeleton
  /** Takes each step's time (importTiming); the import is the same with or without. */
  timer?: ImportTimer
}

export async function prepareAnime25DRigPsd(
  psd: Psd,
  {
    sourceMasterAssetId,
    onStage,
    sourceGenerationFingerprint,
    sourceReference,
    expressionReferences = [],
    armVariantReferences = [],
    profile = 'bust',
    skeleton,
    timer,
  }: Anime25DRigPsdOptions,
): Promise<PreparedAnime25DRigImport> {
  if (!isAnime25DDocument(psd)) {
    throw new FigureError('anime25dMissingFace')
  }
  const importProfile = anime25DImportProfile(profile)
  const staticSeeThroughMouth = hasStaticSeeThroughMouth(psd)
  const working = flattenPsdForRigger(psd, importProfile)
  timer?.lap('layers.flatten')
  Rigger.cleanPsdLayers(working)
  timer?.lap('layers.clean')
  mirrorLostEyeWhite(working, Rigger.baseName)
  // A named but empty/hidden face must never silently acquire guessed pivots.
  if (
    !working.children?.some(
      (layer) =>
        Rigger.baseName(layer.name ?? '') === 'face' &&
        layer.imageData?.data.some(
          (value, index) => index % 4 === 3 && value > 8,
        ),
    )
  ) {
    throw new FigureError('anime25dMissingFace')
  }
  timer?.lap('layers.faceCheck')
  const rig = Rigger.buildRig(working, { generic: genericCloseParts() })
  compensateSyntheticClosedEyeAngles(rig.layers)
  timer?.lap('layers.buildRig')
  onStage?.('validated')
  const usedIds = new Set<string>()
  let layers = stackOpenEyesInOrder(rig.layers.map((part) => rasterFromRiggerPart(part, usedIds)))
  if (staticSeeThroughMouth) layers = preserveStaticMouthAsClosed(layers)
  layers = splitHandwearIfNeeded(layers, rig.anchors.face.cx)
  layers = splitLowerLimbsIfNeeded(splitTrouserLegsIfNeeded(layers))
  timer?.lap('layers.splits')
  if (sourceReference) {
    layers = stackLowerLimbsByReference(layers, sourceReference)
    layers = stackNeckwearByReference(layers, sourceReference)
    layers = stackHeadwearByReference(layers, sourceReference)
    layers = stackEarwearByReference(layers, sourceReference)
    // A bust's arms are cut off above where a skirt would be.
    if (profile === 'fullBody') layers = stackArmsByReference(layers, sourceReference)
  }
  timer?.lap('layers.stackByReference')
  layers = addHiddenArmFragments(layers, anime25DShoulderSeeds(layers), new Set(layers.map((layer) => layer.id)))
  timer?.lap('layers.hiddenArmFragments')
  // Cut against the arms as split, kept out of everything that reconciles the
  // resting figure with the portrait, and drawn last, over the front hair.
  const armVariants = cutArmVariantLayers(layers, sourceReference, armVariantReferences, skeleton, profile === 'fullBody', timer)
  timer?.lap('arms.rest')
  layers = splitVariantEyesIfNeeded(layers, rig.anchors.face.cx, 'eye-dizzy')
  layers = splitVariantEyesIfNeeded(layers, rig.anchors.face.cx, 'eye-squeeze')
  layers = splitVariantEyesIfNeeded(layers, rig.anchors.face.cx, 'eye-cry')
  if (
    !layers.some(
      (layer) => layer.role === 'mouth-open' || layer.role === 'mouth-close',
    )
  ) {
    // The frozen rigger guesses a fixed-pixel box off the face centroid.
    const frame = resolveAnime25DFaceFrame(rig.anchors)
    if (frame.landmarks) {
      rig.anchors.mouth = estimateAnime25DMouthAnchor(frame, rig.anchors.face)
    }
  }
  timer?.lap('expressions.variantEyes')
  layers = addAuthoredExpressionLayers(
    layers,
    rig.anchors,
    sourceReference,
    expressionReferences,
  )
  timer?.lap('expressions.authored')
  layers = compileAnime25DExpressionLayers(layers, rig.anchors)
  timer?.lap('expressions.compile')
  // A closed eye is lines on the face's own lid: a fill painted with it shows as a smear.
  layers = layers.map((layer) => layer.role === 'eye-close' || layer.role === 'eye-close2'
    ? { ...layer, data: keepClosedEyeLines(layer.data) }
    : layer)
  timer?.lap('expressions.closedEyeLines')
  layers = splitHighCollarOcclusion(layers, rig.anchors, sourceReference)
  timer?.lap('tuck.highCollar')
  layers = tuckBackHairBehindNeck(tuckBehindFace(layers))
  // A coat drawn over a leg or the neck the portrait shows goes behind it
  // before repair, which would cut it out and leave a hole once it moves.
  if (sourceReference) {
    layers = tuckGarmentOffLegsByReference(layers, sourceReference, visibleInAnalysisReference)
    layers = tuckGarmentOffNeckByReference(layers, sourceReference, visibleInAnalysisReference)
    layers = revealCrownUnderFace(layers, visibleInAnalysisReference, sourceReference)
  }
  timer?.lap('tuck.beforeRepair')
  layers.forEach((layer, index) => {
    layer.order = index
  })
  assignCrossfadeSlots(layers)
  validateAnime25DCharacterLayers(layers)
  timer?.lap('layers.validate')
  let reconciliation: Anime25DPsdReconciliation | null = null
  if (sourceReference) {
    const repair = repairAnime25DPsd(
      layers,
      visibleInAnalysisReference,
      sourceReference,
      Math.max(0, MAX_RIG_PARTS - layers.length - armVariants.length),
      profile === 'fullBody',
    )
    timer?.lap('repair.reconcile')
    layers = paintAccessoriesFromReference(
      raiseEarwearOverFrontHair(repair.layers),
      visibleInAnalysisReference,
      sourceReference,
    )
    // A lower garment lifted from the portrait lands above the top it covers;
    // the sleeves hanging over it go back in front where the portrait has them.
    if (profile !== 'fullBody' && layers.some((layer) => layer.role === 'bottomwear' && layer.synthetic)) {
      layers = stackArmsByReference(layers, sourceReference)
    }
    timer?.lap('repair.accessories')
    reconciliation = repair.reconciliation
    layers.forEach((layer, index) => {
      layer.order = index
    })
  }
  // Behind the legs goes what the skirt shows between them once repair has
  // cut it to the portrait, and behind the neck what the top draws under the
  // chin where repair has cut the top off the neck below it.
  // A ribbon the top took hangs from the clip it is tied to, and skin the top
  // draws over the neck is the neck's. The shadows the front hair casts on the
  // skin go into the hair, and under each lock of it goes the hair of the
  // locks above it.
  const necked = dropTopSkinOverNeck(hangTopPiecesOnHeadwear(tuckLiningBehindLegs(layers), visibleInAnalysisReference), visibleInAnalysisReference, sourceReference)
  const tucked = underlapHairLocks(liftHairShadowOffSkin(tuckTopUnderChinBehindNeck(necked, visibleInAnalysisReference), visibleInAnalysisReference))
  timer?.lap('tuck.afterRepair')
  if (tucked !== layers) {
    layers = tucked
    layers.forEach((layer, index) => {
      layer.order = index
    })
  }
  // Drawn accents next, with what the part budget leaves after repair.
  layers = synthesizeMissingExpressionAccents(
    layers,
    rig.anchors,
    resolveAnime25DFaceFrame(rig.anchors),
    MAX_RIG_PARTS - layers.length - armVariants.length,
  )
  layers = [...layers, ...armVariants]
  layers.forEach((layer, index) => {
    layer.order = index
  })
  timer?.lap('expressions.accents')
  const motionExposure = findMotionExposure(layers)
  timer?.lap('check.motionExposure')
  const faceCenter = {
    x: rig.anchors.face.cx,
    y: rig.anchors.face.cy,
  }
  if (layers.length === 0 || layers.length > MAX_RIG_PARTS) {
    throw new FigureError('anime25dPartCount', { max: MAX_RIG_PARTS })
  }
  const frame = contentFrame(psd, layers, importProfile)
  const stance = importProfile.bodyPivot === 'hips' ? standingStance(layers) : null
  if (importProfile.bodyPivot === 'hips' && !stance) {
    throw new FigureError('anime25dMissingLayer', { role: 'legwear' })
  }
  timer?.lap('frame.content')
  onStage?.('packing')
  const {
    atlas,
    analysisReference,
    layers: prepared,
    width: packedWidth,
    height: packedHeight,
  } = await packAnime25DAtlas(frame, layers, timer)
  const anchors = deriveAnchors(frame, prepared, faceCenter)
  const { bones, layerHandles, secondaryBoneIds } =
    buildAnime25DBonesAndHandles(prepared, anchors)
  const rigLayers = buildAnime25DLayerSources(prepared, layerHandles)
  const partIds = prepared.map((layer) => `a25d-${layer.id}`)
  const playbackAnchors = remapSourceAnchors(rig.anchors, frame, stance)
  const joints = skeleton ? skeletonInFrame(skeleton, frame) : null
  if (joints) playbackAnchors.skeleton = joints
  const mouthProfile = analyzeAnime25DMouthProfile(
    prepared,
    frame,
    playbackAnchors.mouth,
  )
  const anime25dPlayback = buildAnime25DPlayback(
    {
      frameWidth: frame.width,
      frameHeight: frame.height,
      layers: prepared,
      anchors: playbackAnchors,
      mouthProfile,
    },
  )
  const outfitProfile = inferOutfitProfileFromPartIds(partIds)
  timer?.lap('playback.build')
  const semanticBones: Record<string, string> = {
    root: 'root',
    torso: 'body',
    head: 'head',
    face: 'face',
  }
  if (bones.some((bone) => bone.id === 'left-eye')) {
    semanticBones['left-eye'] = 'left-eye'
  }
  if (bones.some((bone) => bone.id === 'right-eye')) {
    semanticBones['right-eye'] = 'right-eye'
  }
  if (bones.some((bone) => bone.id === 'mouth')) semanticBones.mouth = 'mouth'
  if (bones.some((bone) => bone.id === 'a25d-handwear')) {
    semanticBones.handwear = 'a25d-handwear'
  }
  return {
    atlas,
    analysisReference,
    partCount: prepared.length,
    reconciliation,
    motionExposure,
    documentFrame: { width: psd.width, height: psd.height, x: frame.x, y: frame.y },
    source: {
      rigIrVersion: RIG_IR_VERSION,
      characterAssetContractVersion: CHARACTER_ASSET_PROFILES[profile].contractVersion,
      ...(profile === 'bust' ? {} : { profile }),
      sourceMasterAssetId,
      ...(sourceGenerationFingerprint ? { sourceGenerationFingerprint } : {}),
      canvas: { ...importProfile.canvas },
      atlas: { id: 'atlas', width: packedWidth, height: packedHeight },
      bones,
      layers: rigLayers,
      outfitProfile,
      semanticAnchors: semanticAnchors(anchors),
      semantics: {
        bones: semanticBones,
        chains: { torso: ['root', 'body', 'head'] },
        secondaryBoneIds,
      },
      anime25dPlayback,
    },
  }
}
