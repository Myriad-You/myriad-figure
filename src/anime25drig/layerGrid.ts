import type { Anime25DPlaybackAnchors, Anime25DPlaybackLayer, Anime25DShellProfile } from './types'

const NECK_MESH_CELL = 28
const FRONT_COLLAR_MESH_CELL = 22
/** A head drawing's mesh cell, as a share of the face's width. */
const HEAD_TURN_CELL = 0.03
/**
 * A bust's body layers are meshed to its canvas. A figure stands small on a
 * wide canvas (room to sway), so the top and the collar cut from it, which
 * turn as the torso's curved surface, are meshed to its face instead: a
 * face this wide gets the cell a 768-wide canvas gets, a bust's density.
 */
const FIGURE_TORSO_FACE_WIDTH = 310
const FIGURE_TORSO_ROLES = new Set(['topwear', 'collar-front', 'collar-back'])
/**
 * A standing figure's limbs turn each as a column of its own (figureColumns): what is drawn on one slides
 * across it, most at its middle. Its canvas-sized cells left a leg three vertices across, a tent, not a
 * column: it has at least this many cells across. (And a leg FIGURE_LEG_ROWS down, for its top's handing over.)
 */
const FIGURE_LIMB_ROLES = new Set(['legwear', 'footwear', 'handwear'])
const FIGURE_LIMB_COLS = 10
/**
 * What is drawn on a leg or a shoe in a layer of its own (laces, a buckle, a charm) stands and turns as that
 * limb does under it, point by point (layerGpuAssembly's standOnLimb): it has this many cells each way to
 * take that shape with, where its canvas-sized cells left it two.
 */
const FIGURE_RIDER_CELLS = 12
/**
 * A shoe has this many rows: its ankle's bones blend and its toe swings out within its height, and with the
 * three rows its canvas-sized cells gave it, what is drawn on it in a layer of its own did neither where it did.
 */
const FIGURE_SHOE_ROWS = 16
/** A piece cut out of its host has at least this many rows to bend over. */
const CUT_PIECE_ROWS = 10
/**
 * A leg's mesh has this many rows of cells: enough for its top's handing over (figureColumns) to be done where it
 * is meant to be, not a canvas cell further down, on the thigh in view. (Its canvas-sized cells were a dozen down
 * a leg.)
 */
export const FIGURE_LEG_ROWS = 40

export type Anime25DLayerBindingExtension =
  | 'neck-mesh-density'
  | 'collar-mesh-density'
  | 'collar-contact-grid'
  | 'mouth-mesh-density'
  | 'cry-eye-mesh-density'
  | 'eye-mesh-density'
  | 'head-turn-mesh-density'
  | 'face-profile-grid'
  | 'hair-length-dynamics'
  | 'front-hair-upper-parallax'

export interface Anime25DLayerBindingInput {
  source: Anime25DPlaybackLayer
  canvasWidth: number
  face: Anime25DPlaybackAnchors['face']
  layerZ: number
  extraGridX?: readonly number[]
  extraGridY?: readonly number[]
  faceShell?: Pick<Anime25DShellProfile, 'head' | 'faceProfile'>
  /** A standing figure rather than a bust. */
  figure?: boolean
}

/** A layer's mesh before it is built: its even cells, and the lines laid through them where it needs more. */
export interface Anime25DLayerGrid {
  baseCols: number
  baseRows: number
  gridX: readonly number[] | undefined
  gridY: readonly number[] | undefined
  extensions: Anime25DLayerBindingExtension[]
}

/** The most vertices a layer's mesh can come to: what validation holds a package to before anything is built. */
export function layerMeshVertexBound(input: Readonly<Anime25DLayerBindingInput>): number {
  const { baseCols, baseRows, gridX, gridY } = resolveLayerGrid(input, false)
  return (baseCols + 1 + (gridX?.length ?? 0)) * (baseRows + 1 + (gridY?.length ?? 0))
}

/** `cutPiece`: the layer is a piece cut out of its host (partSplit). */
export function resolveLayerGrid(input: Readonly<Anime25DLayerBindingInput>, cutPiece: boolean): Anime25DLayerGrid {
  const { source } = input
  const extensions: Anime25DLayerBindingExtension[] = []
  const faceShell = source.role === 'face' && input.faceShell?.faceProfile.enabled
    ? input.faceShell
    : undefined
  let gridX = input.extraGridX
  let gridY = input.extraGridY?.slice()
  if (faceShell) {
    extensions.push('face-profile-grid')
    // Resolve the narrow nose/eye/mouth depth field at its own landmarks,
    // rather than letting one canvas-sized triangle bridge several features.
    const { head, faceProfile } = faceShell
    const width = Math.max(1, head.radiusX * 0.34)
    gridX = [...(gridX ?? []), ...Array.from({ length: 17 }, (_, i) => head.centerX + (i - 8) * width / 4)]
    gridY = [...(gridY ?? [])]
    for (let i = 0; i < faceProfile.points.length; i++) {
      const start = faceProfile.points[i].v
      const end = faceProfile.points[i + 1]?.v ?? start
      for (let n = 0; n < (end === start ? 1 : 8); n++) {
        gridY.push(faceProfile.startY + (start + (end - start) * n / 8) * (faceProfile.endY - faceProfile.startY))
      }
    }
  }
  const flexibleCell =
    source.role === 'neck'
      ? extension(extensions, 'neck-mesh-density', NECK_MESH_CELL)
      : source.role === 'collar-front'
        ? extension(extensions, 'collar-mesh-density', FRONT_COLLAR_MESH_CELL)
        : null
  if (input.extraGridX?.length || input.extraGridY?.length) {
    extensions.push('collar-contact-grid')
  }
  const eyeFeature =
    source.group === 'head' &&
    ['eyewhite', 'eyelash', 'irides', 'eye-close', 'eye-close2', 'eyebrow'].includes(source.role)
  // Smile/wide-eye lid curves bend vertically inside the eye; the old four
  // rows could miss that curvature even when the outer contour was resolved.
  const curvedLid = source.role === 'eyewhite' || source.role === 'eyelash'
  // Thin eye art needs enough horizontal samples to retain its curve during
  // yaw/pitch and closure. Canvas-sized cells can leave just two columns.
  // The head turns as a curved surface, rendered vertex by vertex: canvas-sized
  // cells would fold a drawn line into straight pieces at every cell edge.
  // Hair keeps the upstream topology its strand dynamics are bound to; faded
  // expression and mouth drawings have meshes of their own.
  const headSurface = source.group === 'head' && !eyeFeature && !source.phys && !source.fade
  const cell = eyeFeature
    ? extension(extensions, 'eye-mesh-density', (curvedLid ? 4 : 12) * Math.max(0.25, (input.face.x1 - input.face.x0) / 333))
    : headSurface
      ? extension(extensions, 'head-turn-mesh-density', Math.max(4, (input.face.x1 - input.face.x0) * HEAD_TURN_CELL))
      : (flexibleCell ?? (source.phys ? 30 : 42)) *
        Math.max(0.6, input.figure && FIGURE_TORSO_ROLES.has(source.role)
          ? (input.face.x1 - input.face.x0) / FIGURE_TORSO_FACE_WIDTH
          : input.canvasWidth / 768)
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
  if (morphingMouth) extensions.push('mouth-mesh-density')
  if (source.role === 'eye-cry') extensions.push('cry-eye-mesh-density')
  const figureRider = Boolean(input.figure) && source.group === 'body' && source.role === 'objects'
  const baseCols = Math.max(
    maniacMouthMesh ? 14 : sillyMouthMesh ? 10 : eyeFeature ? 8 : morphingMouth ? 6 : 2,
    input.figure && source.group === 'body' && FIGURE_LIMB_ROLES.has(source.role) ? FIGURE_LIMB_COLS : 0,
    figureRider ? FIGURE_RIDER_CELLS : 0,
    Math.round(source.w / cell),
  )
  // A piece cut out of its host bends from its cut by its swing: it needs rows to bend over.
  const baseRows = Math.max(
    cutPiece ? CUT_PIECE_ROWS : 0,
    input.figure && source.group === 'body' && source.role === 'legwear' ? FIGURE_LEG_ROWS : 0,
    figureRider ? FIGURE_RIDER_CELLS : 0,
    input.figure && source.group === 'body' && source.role === 'footwear' ? FIGURE_SHOE_ROWS : 0,
    maniacMouthMesh
      ? 10
      : sillyMouthMesh
        ? 8
        : curvedLid
          ? 16
        : morphingMouth || eyeFeature
          ? 4
          : source.role === 'eye-cry'
            ? 3
            : 2,
    Math.round(source.h / cell),
  )
  return { baseCols, baseRows, gridX, gridY, extensions }
}

function extension<T>(
  extensions: Anime25DLayerBindingExtension[],
  name: Anime25DLayerBindingExtension,
  value: T,
): T {
  extensions.push(name)
  return value
}
