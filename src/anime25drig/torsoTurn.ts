import type { Anime25DSecondaryDeformationBinding, Anime25DSecondaryDeformationFrame } from './secondaryDeformation'
import { addBodyTurn } from './bodyTurnKeyforms'
import { figureColumnOffsetX } from './figureColumns'
import {
  addTorsoShellShare,
  anime25DSleeveAnchorX,
  anime25DTorsoShellOffsetX,
  deformAnime25DTorsoShellPoint,
  figureFrontDepth,
  figureSleeveOffsetX,
  SLEEVE_TORSO_TRANSMISSION,
} from './torsoDeformation'

/**
 * Moves a body layer's point with the torso's turn: on its cylinder, as a
 * limb's own column about its axis (a standing figure's), or by the part's
 * measured key. `collarBodyWeight`: the body's share of a neck's or a
 * collar's point, the rest being the head's.
 */
export function turnWithTorso(
  point: { x: number; y: number },
  restX: number,
  restY: number,
  vertex: number,
  binding: Readonly<Anime25DSecondaryDeformationBinding>,
  frame: Readonly<Anime25DSecondaryDeformationFrame>,
  collarBodyWeight: number,
): void {
  // The neck and collar take the body's share of the torso's turn.
  const torsoWeight = binding.torsoShellMode === 'collar' || binding.torsoShellMode === 'neck' ? collarBodyWeight : 1
  const frontDepth = binding.torsoShellMode ? figureFrontDepth(frame.torsoProfile, restY, frame.neckBottom, frame.chestRegionCenterY) : 1
  // A standing figure's arm, leg or shoe is a column of its own about the turn's axis (figureColumns).
  const column = binding.figureColumn && frame.figure
    ? figureColumnOffsetX(restX, vertex, binding.figureColumn, frame.torsoProfile, frame.torsoShellRotation, frame.torsoShellBlend)
    : null
  if (column !== null && binding.torsoShellMode !== 'sleeve') {
    // (A leg's top goes with the trunk's cylinder, like the skirt or the trousers' seat over it.)
    const trunk = binding.figureColumn!.trunk?.[vertex] ?? 0
    point.x += trunk > 0
      ? column + (anime25DTorsoShellOffsetX(restX, frame.torsoProfile, frame.torsoShellRotation, frame.torsoShellBlend) - column) * trunk
      : column
  } else if (binding.bodyTurnKeyform) {
    // Measured, not projected; but a leg's top, inside the skirt, turns with it. (A bust's keyed body, and what of a figure's is no limb.)
    const cylinder = addTorsoShellShare(point, binding.bodyTurnKeyform.cylinder?.[vertex] ?? 0, frame, restY)
    addBodyTurn(point, binding.bodyTurnKeyform, vertex, (frame.bodyTurn ?? 0) * torsoWeight * (1 - cylinder))
  } else if (binding.torsoShellMode === 'sleeve') {
    // A bust's sleeve is one rigid drawing hanging beside the cylinder, not a
    // patch of its surface; a figure's lies on the body where it covers it and is the arm's column beyond.
    point.x += column !== null
      ? figureSleeveOffsetX(restX, column, frame.torsoProfile, frame.torsoShellRotation, frame.torsoShellBlend, frontDepth, binding.figureColumn!.whole ? binding.figureColumn!.middleX : undefined)
      : anime25DTorsoShellOffsetX(anime25DSleeveAnchorX(binding.handwearAnchorX, frame.torsoProfile), frame.torsoProfile, frame.torsoShellRotation, frame.torsoShellBlend * SLEEVE_TORSO_TRANSMISSION)
  } else if (binding.torsoShellMode) {
    deformAnime25DTorsoShellPoint(point, frame.torsoProfile, frame.torsoShellRotation, frame.torsoShellBlend * torsoWeight, binding.topwear ? frame.torsoChestShape : null, binding.topwear ? (binding.chestWeights?.[vertex] ?? 1) : 1, frame.chestVolumeScale, frontDepth)
  }
}
