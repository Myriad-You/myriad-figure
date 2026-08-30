import type { ChestWeightField } from './chestPhysics'
import type { FrontCollarContactModel } from './collarContact'
import type { CollarClipMesh } from './collarRuntime'
import type { Anime25DLayerDeformationPlan } from './deformationDependencies'
import type { Anime25DDriver } from './driver'
import type { Anime25DExpressionDeformationBinding } from './expressionDeformation'
import type { Anime25DLayerSpringBinding } from './layerBinding'
import type { Anime25DUpstreamFeatureInput } from './layerDeformation'
import type { Anime25DLayerDeformationExtension } from './layerDeformationPolicy'
import type { Anime25DMouthDeformationKind } from './mouthDeformation'
import type { Anime25DRenderableLayer } from './renderer'
import type { Anime25DSecondaryDeformationBinding } from './secondaryDeformation'
import type { Anime25DPlayback, Anime25DShellProfile } from './types'
import { sampleChestWeight } from './chestPhysics'
import { buildFrontCollarContactModel } from './collarContact'
import { createCollarClipMesh } from './collarRuntime'
import {
  createAnime25DLayerDeformationPlan,
  resolveAnime25DDeformationDependencies,
} from './deformationDependencies'
import { resolveAnime25DExpressionDeformation } from './expressionDeformation'
import { buildAnime25DLayerBinding } from './layerBinding'
import { bindAnime25DUpstreamFeature } from './layerDeformation'
import { resolveAnime25DLayerDeformationPolicy } from './layerDeformationPolicy'
import { writeIdentityLayerTransform } from './layerTransform'
import { resolveAnime25DMouthDeformation } from './mouthDeformation'
import { createAnime25DSecondaryDeformationBinding } from './secondaryDeformation'
import {
  anime25DShellModeForLayer,
  sampleAnime25DHairlinePinWeights,
} from './shellDeformation'
import { anime25DTorsoShellModeForLayer } from './torsoDeformation'
import { createIndexedDeformableMesh, readLayerPixels } from './webglRuntime'

export interface Anime25DGpuLayer extends Anime25DRenderableLayer {
  baseRole: string
  rest: Float32Array
  deformed: Float32Array
  cols: number
  rows: number
  vertexBuffer: WebGLBuffer
  uvBuffer: WebGLBuffer
  indexBuffer: WebGLBuffer
  shaderGlobalTransform: boolean
  localDynamic: boolean
  deformationExtensions: Anime25DLayerDeformationExtension[]
  upstreamFeature: Anime25DUpstreamFeatureInput | null
  mouthDeformation: Anime25DMouthDeformationKind | null
  expressionDeformation: Anime25DExpressionDeformationBinding | null
  secondaryDeformation: Anime25DSecondaryDeformationBinding
  chestWeights: Float32Array | null
  frontHair: boolean
  frontHairParallaxScale: Float32Array | null
  strandWeights: Float32Array | null
  alongStrand: Float32Array | null
  bangWeights: Float32Array | null
  springs: Anime25DLayerSpringBinding[] | null
  collarContact: FrontCollarContactModel | null
  deformationPlan: Anime25DLayerDeformationPlan
  geometryDirty: boolean
}

export interface Anime25DCompiledGpuLayers {
  layers: Anime25DGpuLayer[]
  collarClip: CollarClipMesh | null
}

/** Compiles all stable atlas, mesh, deformation, and stencil bindings once. */
export function compileAnime25DGpuLayers(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  playback: Readonly<Anime25DPlayback>,
  shellProfile: Readonly<Anime25DShellProfile>,
  current: Anime25DDriver,
  chestWeightField: ChestWeightField | null,
  atlasImage: HTMLImageElement,
  existingCollarClip: CollarClipMesh | null = null,
): Anime25DCompiledGpuLayers {
  const layers: Anime25DGpuLayer[] = []
  let collarClip = existingCollarClip
  const neck = playback.layers.find((layer) => layer.role === 'neck')
  for (
    let layerIndex = 0;
    layerIndex < playback.layers.length;
    layerIndex += 1
  ) {
    const source = playback.layers[layerIndex]
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
          playback.anchors.neckPivot.x,
        )
      : null
    const binding = buildAnime25DLayerBinding({
      source,
      canvasWidth: playback.pixelCanvas.width,
      face: playback.anchors.face,
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
    const mesh = createIndexedDeformableMesh(
      gl,
      program,
      rest,
      atlasUvs,
      indices,
    )
    const chestWeights =
      source.role === 'topwear' && chestWeightField
        ? samplePlaybackChestWeights(
            chestWeightField,
            rest,
            playback.pixelCanvas.width,
          )
        : null
    const baseRole = anime25DLayerBaseName(source.role)
    const renderKind = anime25DRenderKind(source)
    const shellMode = anime25DShellModeForLayer(source)
    const torsoShellMode = anime25DTorsoShellModeForLayer(source)
    const hairlinePinWeights =
      shellMode === 'front-hair' && source.role === 'front-hair'
        ? sampleAnime25DHairlinePinWeights(rest, source, rows, shellProfile)
        : null
    const deformationPolicy = resolveAnime25DLayerDeformationPolicy({
      baseRole,
      fade: source.fade,
      hairPhysics: source.phys === 'hair',
      hasBangWeights: Boolean(hair.bangWeights),
      hasFrontHairParallax: Boolean(hair.frontHairParallaxScale),
      hasCollarContact: Boolean(collarContact),
      shellDeformation: Boolean(
        shellMode && shellProfile.enabled && shellProfile.blend > 0,
      ),
      torsoShellDeformation: Boolean(
        torsoShellMode &&
        shellProfile.enabled &&
        shellProfile.blend > 0 &&
        shellProfile.torso?.enabled &&
        shellProfile.torso.blend > 0,
      ),
    })
    const eye =
      source.side === 'L'
        ? playback.anchors.eyeL
        : source.side === 'R'
          ? playback.anchors.eyeR
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
    const upstreamFeature = bindAnime25DUpstreamFeature(
      source,
      eye,
      playback.anchors.faceScale,
      current,
    )
    const mouthDeformation = resolveAnime25DMouthDeformation(source.fade)
    const deformationPlan = createAnime25DLayerDeformationPlan(
      deformationPolicy.shaderGlobalTransform && deformationPolicy.localDynamic,
      resolveAnime25DDeformationDependencies({
        baseRole,
        fade: source.fade,
        shaderGlobalTransform: deformationPolicy.shaderGlobalTransform,
        localDynamic: deformationPolicy.localDynamic,
        upstreamFeatureKind: upstreamFeature?.kind ?? null,
        expressionDeformationKind,
        mouthDeformationKind: mouthDeformation,
      }),
    )
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
      shellMode,
      hairlinePinWeights,
      torsoShellMode,
    })
    const layerTransform = new Float32Array(9)
    writeIdentityLayerTransform(layerTransform)
    if (collarContact && !collarClip && neck) {
      collarClip = createCollarClipMesh(
        gl,
        program,
        collarContact,
        neck,
        source,
      )
    }
    layers.push({
      source,
      baseRole,
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
      upstreamFeature,
      mouthDeformation,
      expressionDeformation,
      secondaryDeformation,
      frameOpacity: source.fade ? 0 : 1,
      renderKind,
      retainWhenHidden: source.name.startsWith('eyewhite'),
      cryDirection:
        source.fade === 'eyeCry' ? (source.side === 'L' ? -1 : 1) : 0,
      chestWeights,
      ...hair,
      collarContact,
      deformationPlan,
      geometryDirty: false,
    })
  }
  return { layers, collarClip }
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

export function anime25DLayerBaseName(role: string): string {
  if (role === 'front-hair') return 'front hair'
  if (role === 'back-hair') return 'back hair'
  return role.replace(/-/g, '_')
}

function anime25DRenderKind(
  source: Anime25DPlayback['layers'][number],
): Anime25DGpuLayer['renderKind'] {
  if (source.role === 'neck') return 'neck'
  if (source.name.startsWith('eyewhite') || source.role === 'eye-silly-white') {
    return 'eyewhite'
  }
  if (
    source.name.startsWith('irides') ||
    source.role === 'iris-silly' ||
    source.role === 'lovestruck-heart'
  ) {
    return 'iris'
  }
  return 'ordinary'
}
