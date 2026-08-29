import type { ChestWeightField } from './chestPhysics'
import type { FrontCollarContactModel } from './collarContact'
import type { CollarClipMesh } from './collarRuntime'
import type { Anime25DDriver } from './driver'
import type { Anime25DExpressionDeformationBinding } from './expressionDeformation'
import type { Anime25DLayerSpringBinding } from './layerBinding'
import type { Anime25DUpstreamFeatureInput } from './layerDeformation'
import type { Anime25DLayerDeformationExtension } from './layerDeformationPolicy'
import type { Anime25DMouthDeformationKind } from './mouthDeformation'
import type { Anime25DRenderableLayer } from './renderer'
import type { Anime25DSecondaryDeformationBinding } from './secondaryDeformation'
import type { Anime25DPlayback } from './types'
import { sampleChestWeight } from './chestPhysics'
import { buildFrontCollarContactModel } from './collarContact'
import { createCollarClipMesh } from './collarRuntime'
import { resolveAnime25DExpressionDeformation } from './expressionDeformation'
import { buildAnime25DLayerBinding } from './layerBinding'
import { bindAnime25DUpstreamFeature } from './layerDeformation'
import { resolveAnime25DLayerDeformationPolicy } from './layerDeformationPolicy'
import { writeIdentityLayerTransform } from './layerTransform'
import { resolveAnime25DMouthDeformation } from './mouthDeformation'
import { createAnime25DSecondaryDeformationBinding } from './secondaryDeformation'
import { createIndexedDeformableMesh, readLayerPixels } from './webglRuntime'

export interface Anime25DGpuLayer extends Anime25DRenderableLayer {
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
        playback.anchors.faceScale,
        current,
      ),
      mouthDeformation: resolveAnime25DMouthDeformation(source.fade),
      expressionDeformation,
      secondaryDeformation,
      frameOpacity: source.fade ? 0 : 1,
      chestWeights,
      ...hair,
      collarContact,
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
