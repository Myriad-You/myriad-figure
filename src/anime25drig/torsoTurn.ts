import type { Anime25DSecondaryDeformationBinding, Anime25DSecondaryDeformationFrame } from './secondaryDeformation'
import { addBodyTurn } from './bodyTurnKeyforms'
import { figureColumnOffsetX } from './figureColumns'
import { laggedTurn } from './figureTurn'
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
  // A standing figure's directed turn is led by its chest: this point's part of it may be behind that yet, or past it (figureTurn).
  const turn = frame.figure?.turn
  // (A leg's top, which goes with the trunk over it, is as far behind as the trunk there.)
  const onTrunk = binding.figureColumn?.trunk?.[vertex] ?? 0
  const lag = !turn?.active
    ? 0
    : binding.torsoShellMode === 'sleeve'
      ? turn.armLag(restY, frame.neckBottom)
      : binding.figureColumn
        ? turn.legLag + (turn.trunkLag(restY) - turn.legLag) * onTrunk
        : binding.torsoShellMode ? turn.trunkLag(restY) : 0
  const rotation = lag === 0 ? frame.torsoShellRotation : laggedTurn(frame.torsoShellRotation, lag, lagged)
  // A standing figure's arm, leg or shoe is a column of its own about the turn's axis (figureColumns).
  const column = binding.figureColumn && frame.figure
    ? figureColumnOffsetX(restX, vertex, binding.figureColumn, frame.torsoProfile, rotation, frame.torsoShellBlend)
    : null
  if (column !== null && binding.torsoShellMode !== 'sleeve') {
    // (A leg's top goes with the trunk's cylinder, like the skirt or the trousers' seat over it.)
    const trunk = binding.figureColumn!.trunk?.[vertex] ?? 0
    point.x += trunk > 0
      ? column + (anime25DTorsoShellOffsetX(restX, frame.torsoProfile, rotation, frame.torsoShellBlend) - column) * trunk
      : column
  } else if (binding.bodyTurnKeyform) {
    // Measured, not projected; but a leg's top, inside the skirt, turns with it. (A bust's keyed body, and what of a figure's is no limb.)
    const cylinder = addTorsoShellShare(point, binding.bodyTurnKeyform.cylinder?.[vertex] ?? 0, frame, restY)
    addBodyTurn(point, binding.bodyTurnKeyform, vertex, (frame.bodyTurn ?? 0) * torsoWeight * (1 - cylinder))
  } else if (binding.torsoShellMode === 'sleeve') {
    // A bust's sleeve is one rigid drawing hanging beside the cylinder, not a
    // patch of its surface; a figure's lies on the body where it covers it and is the arm's column beyond.
    // (Where it lies on the body it is as far round as the body under it, not as its arm.)
    point.x += column !== null
      ? figureSleeveOffsetX(restX, column, frame.torsoProfile, turn?.active ? laggedTurn(frame.torsoShellRotation, turn.trunkLag(restY), laggedBody) : rotation,
          frame.torsoShellBlend, frontDepth, binding.figureColumn!.whole ? binding.figureColumn!.middleX : undefined)
      : anime25DTorsoShellOffsetX(anime25DSleeveAnchorX(binding.handwearAnchorX, frame.torsoProfile), frame.torsoProfile, rotation, frame.torsoShellBlend * SLEEVE_TORSO_TRANSMISSION)
  } else if (binding.torsoShellMode) {
    deformAnime25DTorsoShellPoint(point, frame.torsoProfile, rotation, frame.torsoShellBlend * torsoWeight, binding.topwear ? frame.torsoChestShape : null, binding.topwear ? (binding.chestWeights?.[vertex] ?? 1) : 1, frame.chestVolumeScale, frontDepth)
  }
}

const lagged = { active: true, yawSine: 0, yawCosine: 1 }
const laggedBody = { active: true, yawSine: 0, yawCosine: 1 }
