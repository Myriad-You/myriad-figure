import type { Anime25DHairSpringBinding } from './hairPhysics'
import type { Anime25DLayerBindingExtension, Anime25DLayerBindingInput } from './layerGrid'
import type {
  Anime25DPlaybackAnchors,
  Anime25DPlaybackLayer,
} from './types'
import { localToAtlasUv } from './atlasUv'
import { createHairChain } from './hairChain'
import {
  frontHairUpperParallaxScale,
  HAIR_CHAIN_LINKS,
  hairLockCharacter,
  hairStrandDynamics,
  rearStrandCharacters,
} from './hairPhysics'
import { resolveLayerGrid } from './layerGrid'
import { cutFrom } from './partSplit'

export type { Anime25DLayerBindingExtension, Anime25DLayerBindingInput } from './layerGrid'

export type Anime25DLayerSpringBinding = Anime25DHairSpringBinding

export interface Anime25DLayerBinding {
  rest: Float32Array
  atlasUvs: Float32Array
  indices: Uint16Array
  cols: number
  rows: number
  frontHair: boolean
  frontHairParallaxScale: Float32Array | null
  strandWeights: Float32Array | null
  alongStrand: Float32Array | null
  bangWeights: Float32Array | null
  springs: Anime25DLayerSpringBinding[] | null
  extensions: Anime25DLayerBindingExtension[]
}

export function buildAnime25DLayerBinding(
  input: Readonly<Anime25DLayerBindingInput>,
): Anime25DLayerBinding {
  const { source } = input
  const { extensions, baseCols, baseRows, gridX, gridY } = resolveLayerGrid(input, cutFrom(source) !== undefined)
  const xCoordinates = layerGridAxis(
    source.x,
    source.w,
    baseCols,
    gridX,
  )
  const yCoordinates = layerGridAxis(
    source.y,
    source.h,
    baseRows,
    gridY,
  )
  const cols = xCoordinates.length - 1
  const rows = yCoordinates.length - 1
  const rest = new Float32Array((cols + 1) * (rows + 1) * 2)
  const atlasUvs = new Float32Array(rest.length)
  let cursor = 0
  for (let row = 0; row <= rows; row += 1) {
    const y = yCoordinates[row]
    const localV = gridY?.length
      ? (y - source.y) / Math.max(1, source.h)
      : Math.fround(row / rows)
    for (let col = 0; col <= cols; col += 1) {
      const x = xCoordinates[col]
      const localU = gridX?.length
        ? (x - source.x) / Math.max(1, source.w)
        : Math.fround(col / cols)
      const [u, v] = localToAtlasUv(source.atlas, localU, localV)
      rest[cursor] = x
      rest[cursor + 1] = y
      atlasUvs[cursor] = u
      atlasUvs[cursor + 1] = v
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
  return {
    rest,
    atlasUvs,
    indices,
    cols,
    rows,
    ...bindHair(source, rest, input.face, input.layerZ, extensions),
    extensions,
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
  const sorted = coordinates.toSorted((left, right) => left - right)
  const unique: number[] = []
  for (const coordinate of sorted) {
    if (
      unique.length === 0 ||
      Math.abs(coordinate - unique.at(-1)!) > 0.05
    ) {
      unique.push(coordinate)
    }
  }
  return unique
}

function bindHair(
  source: Anime25DPlaybackLayer,
  rest: Float32Array,
  face: Anime25DPlaybackAnchors['face'],
  layerZ: number,
  extensions: Anime25DLayerBindingExtension[],
): Pick<
  Anime25DLayerBinding,
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
  extensions.push('hair-length-dynamics')
  if (frontHair) extensions.push('front-hair-upper-parallax')
  const strandCount = strands.length
  let spacing = 120
  if (strandCount > 1) {
    const gaps: number[] = []
    for (let index = 1; index < strandCount; index += 1) {
      gaps.push(strands[index].x - strands[index - 1].x)
    }
    const sortedGaps = gaps.toSorted((left, right) => left - right)
    spacing = sortedGaps[sortedGaps.length >> 1]
  }
  const sigma = spacing * 0.6
  const referenceHeight = Math.max(1, face.y1 - face.y0)
  const dynamics = strands.map((strand) =>
    hairStrandDynamics(strand.rootY, strand.tipY, referenceHeight),
  )
  const character = frontHair ? hairLockCharacter(source, face) : null
  const tied = frontHair ? null : rearStrandCharacters(strands, face)
  const vertexCount = rest.length / 2
  const frontHairParallaxScale = frontHair
    ? new Float32Array(vertexCount)
    : null
  // A lock left with one strand longer than the face is a side lock; bangs
  // cut into it with it hold no strand of their own (lockStrands drops the
  // short ones). Hair further than about a strand's spacing from that strand
  // goes with the head instead of swinging and hanging with the side lock.
  const sideLock = frontHair && strandCount === 1 && dynamics[0].lengthRatio > 1
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
    const reach = sideLock ? Math.min(1, total) : 1
    if (total > 1e-6) {
      for (let strand = 0; strand < strandCount; strand += 1) {
        const weightIndex = vertex * strandCount + strand
        strandWeights[weightIndex] /= total
        const normalizedWeight = strandWeights[weightIndex]
        rootY += normalizedWeight * strands[strand].rootY
        tipY += normalizedWeight * strands[strand].tipY
        strandWeights[weightIndex] =
          normalizedWeight * reach * dynamics[strand].amplitudeScale
      }
    } else {
      strandWeights[vertex * strandCount] = sideLock ? 0 : dynamics[0].amplitudeScale
      rootY = strands[0].rootY
      tipY = strands[0].tipY
    }
    alongStrand[vertex] = clamp(
      (y - rootY) / Math.max(1, tipY - rootY),
      0,
      1,
    )
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
    springs: strands.map((strand, index) => ({
      supportX: 0,
      supportY: 0,
      rootX: strand.x,
      rootY: strand.rootY,
      chain: createHairChain(strand.x, strand.rootY, strand.x, Math.max(strand.tipY, strand.rootY + 1), HAIR_CHAIN_LINKS),
      phase: index * 1.37 + layerZ,
      lengthRatio: dynamics[index].lengthRatio,
      amplitudeScale: dynamics[index].amplitudeScale,
      stiffnessScale: dynamics[index].stiffnessScale,
      dampingScale: dynamics[index].dampingScale,
      ...(character ?? tied?.[index] ?? {}),
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
