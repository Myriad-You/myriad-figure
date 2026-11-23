import type { Anime25DArmModel, Anime25DArmVariant, Anime25DEnhancement, Anime25DFade, Anime25DJointName, Anime25DPart, Anime25DPartProfile, Anime25DPlayback, Anime25DPlaybackAnchors, Anime25DPlaybackLayer, Anime25DShellProfile, Anime25DSkeleton } from './types'
import { resolveAnime25DLayerSemantics } from '../rig/anime25dLayerSemantics'
import { MAX_RIG_PARTS } from '../rig/contract'
import { everyItem } from '../rig/lists'
import { layerMeshVertexBound } from './layerGrid'
import { largestPieces } from './partSplit'

/**
 * What a playback package has to be before anything is built from it: the
 * layers, the anchors and the optional blocks the runtime reads without
 * looking twice. A package comes from the site's server, whose own check stops
 * at these, and through it from an archive someone uploaded. One that does not
 * hold is refused here, whole, so the runtime needs no guards of its own.
 *
 * The bounds are the importer's own, with room: a document is at most 4096 a
 * side, a standing figure's frame half as wide again and its height up to
 * 16/9 of it. Inside them every number survives a Float32Array, every mesh its
 * Uint16 indices, and no canvas asks for more memory than a page has.
 */
export const MAX_PLAYBACK_EDGE = 8192
/** A drawing may lie off the frame (legs a bust's crop cuts): this far at most. */
const MAX_COORDINATE = MAX_PLAYBACK_EDGE * 2
/** Layer and part names come from a PSD's, which holds 255 characters. */
const MAX_NAME = 512
const MAX_TAG = 64
/** The narrowest drawing the mesh grid can still cut into cells (layerBinding drops lines closer than 0.05). */
const MIN_LAYER_EDGE = 0.5
/** The importer finds at most ten strands in a lock. */
const MAX_STRANDS = 32
/** The server's inventory lists at most 12. */
const MAX_PROFILE_PARTS = 64
const MAX_RADII = 256
/** Each layer's mesh is drawn by 16-bit indices, the last of which means a new strip. (The rig contract's limits are for the manifest's own parts, which are not drawn.) */
const MAX_LAYER_VERTICES = 65_535
/** All of them together, for what they take to hold: with the most strands, some 250 bytes a vertex. */
const MAX_PLAYBACK_VERTICES = 8 * MAX_LAYER_VERTICES
const MAX_RINGS = 256
const MAX_RING_POINTS = 16_384
/** A ring may run past its layer (the ground about a raised arm) by this many of the layer's own sizes. */
const RING_REACH = 2
/** How many times over the layers may cut out the whole atlas: the importer lays each in a place of its own (under 1). */
const MAX_ATLAS_CUTS = 4
/** Pixels of gesture-arm ground in one package. Eight arms on a 1133 × 1511 bust come to 2.1 million. */
const MAX_GROUND_AREA = 2 * 4096 ** 2
/** Where the cuff starts is divided by where it ends, hanging, which the importer reads from 0.75 of the forearm on. */
const LEAST_CUFF = 0.1

/** Every one of them: a name missing here would have a package that carries it refused, so the compiler asks for all. */
const FADES: Readonly<Record<Anime25DFade, true>> = {
  eyeOpen: true, eyeClose: true, eyeDizzy: true, eyeSqueeze: true, eyeCry: true, eyeSilly: true,
  lovestruckHeart: true, lovestruckFace: true, lovestruckDrool: true, maniacEyeShadow: true, maniacMouthShadow: true,
  angerMark: true, speechlessSweat: true,
  accentNotes: true, accentQuestion: true, accentSleep: true, accentSparkle: true, accentBlush: true,
  mouthOpen: true, mouthWide: true, mouthRound: true, mouthNarrow: true, mouthClose: true, mouthCry: true, mouthManiac: true, mouthSilly: true,
  armVariant: true,
}
const JOINTS: Readonly<Record<Anime25DJointName, true>> = {
  nose: true,
  eyeL: true, eyeR: true, earL: true, earR: true,
  shoulderL: true, shoulderR: true, elbowL: true, elbowR: true, wristL: true, wristR: true,
  hipL: true, hipR: true, kneeL: true, kneeR: true, ankleL: true, ankleR: true,
  bigToeL: true, bigToeR: true, smallToeL: true, smallToeR: true, heelL: true, heelR: true,
}
const PART_MOTIONS: Readonly<Record<Anime25DPart['motion'], true>> = { rigid: true, sway: true, dangle: true, flutter: true }

type Canvas = Anime25DPlayback['pixelCanvas']

export function isPlaybackCanvas(value: unknown): value is Canvas {
  return isRecord(value) && isBetween(value.width, 1, MAX_PLAYBACK_EDGE) && isBetween(value.height, 1, MAX_PLAYBACK_EDGE)
}

export function isPlaybackLayers(value: unknown): value is Anime25DPlaybackLayer[] {
  return Array.isArray(value) && value.length > 0 && value.length <= MAX_RIG_PARTS && everyItem(value, isPlaybackLayer) && picturesFit(value as Anime25DPlaybackLayer[])
}

/**
 * The pictures the runtime keeps of the layers: each one's own cut of the atlas, and the ground of each gesture arm,
 * as large as its rings reach. One may be large; all of them together may not be that large many times over.
 */
function picturesFit(layers: readonly Anime25DPlaybackLayer[]): boolean {
  let atlas = 0
  let ground = 0
  for (const { atlas: cut, armVariant } of layers) {
    atlas += cut.w * cut.h
    ground += ringsArea(armVariant?.model?.ground ?? [])
  }
  return atlas <= MAX_ATLAS_CUTS && ground <= MAX_GROUND_AREA
}

function ringsArea(rings: Anime25DArmModel['armOutline']): number {
  const points = rings.flat()
  if (points.length === 0) return 0
  const span = (axis: 0 | 1) => {
    let low = Infinity
    let high = -Infinity
    for (const point of points) {
      low = Math.min(low, point[axis])
      high = Math.max(high, point[axis])
    }
    return high - low + 1
  }
  return span(0) * span(1)
}

function isPlaybackLayer(value: unknown): value is Anime25DPlaybackLayer {
  return isRecord(value) &&
    isText(value.name, MAX_NAME) &&
    isText(value.role, MAX_TAG) &&
    (value.z === undefined || isCoordinate(value.z)) &&
    isBetween(value.depth, 0, 4) &&
    (value.group === 'head' || value.group === 'body') &&
    (isAbsent(value.phys) || value.phys === 'hair') &&
    (isAbsent(value.fade) || isOneOf(FADES, value.fade)) &&
    (isAbsent(value.side) || value.side === 'L' || value.side === 'R') &&
    isCoordinate(value.x) &&
    isCoordinate(value.y) &&
    isBetween(value.w, MIN_LAYER_EDGE, MAX_PLAYBACK_EDGE) &&
    isBetween(value.h, MIN_LAYER_EDGE, MAX_PLAYBACK_EDGE) &&
    isAtlasRect(value.atlas) &&
    isStrands(value.strands) &&
    (value.synthetic === undefined || typeof value.synthetic === 'boolean') &&
    (value.armVariant === undefined || isArmVariant(value.armVariant, value.w, value.h))
}

/** Where a drawing lies in the atlas, as shares of it: all of it inside. */
function isAtlasRect(value: unknown): boolean {
  return isRecord(value) &&
    isShare(value.x) && isShare(value.y) &&
    isShare(value.w) && isShare(value.h) &&
    value.w > 0 && value.h > 0 &&
    value.x + value.w <= 1 + 1e-6 && value.y + value.h <= 1 + 1e-6
}

/** Left to right, no two in one place: a lock's own spacing is measured between them. */
function isStrands(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > MAX_STRANDS) return false
  let previous = -Infinity
  return everyItem(value, (strand) => {
    if (!isRecord(strand) || !isCoordinate(strand.x) || !isCoordinate(strand.rootY) || !isCoordinate(strand.tipY)) return false
    const apart = strand.x > previous
    previous = strand.x
    return apart
  })
}

/**
 * The meshes the runtime would build, the hanging pieces it may cut out among them: each within what its indices
 * reach (past that they wrap round), and all of them within memory.
 */
export function playbackMeshesFit(
  playback: Pick<Anime25DPlayback, 'layers' | 'anchors' | 'pixelCanvas' | 'partProfile'>,
  shell: Anime25DShellProfile,
): boolean {
  const vertices = (source: Anime25DPlaybackLayer, cutPiece = false) => layerMeshVertexBound({
    source,
    canvasWidth: playback.pixelCanvas.width,
    face: playback.anchors.face,
    layerZ: 0,
    faceShell: shell,
    figure: playback.anchors.groundY !== undefined,
  }, cutPiece)
  // As the player meshes them: an unnamed role goes by the layer's name, and the role says which group it is in.
  const layers = playback.layers.map(resolveAnime25DLayerSemantics)
  // A piece comes out of one of the layers it may be in: the one that would mesh it finest. (Hung from the head, it
  // is meshed finer than the hair it is cut from.)
  const pieces = largestPieces(layers, playback.partProfile, playback.pixelCanvas)
    .map((hosts) => Math.max(0, ...hosts.map((piece) => vertices(piece, true))))
  let total = 0
  return [...layers.map((layer) => vertices(layer)), ...pieces].every((own) => {
    total += own
    return own <= MAX_LAYER_VERTICES && total <= MAX_PLAYBACK_VERTICES
  })
}

export function isPlaybackAnchors(value: unknown): value is Anime25DPlaybackAnchors {
  return isRecord(value) &&
    isBox(value.face) && hasRoom(value.face) && isPointAt(value.face, 'cx', 'cy') &&
    isPointAt(value.neckPivot, 'x', 'y') &&
    isCoordinate(value.neckTop) &&
    isCoordinate(value.neckBottom) &&
    isPointAt(value.bodyPivot, 'x', 'y') &&
    (value.groundY === undefined || isCoordinate(value.groundY)) &&
    (value.skeleton === undefined || isSkeleton(value.skeleton)) &&
    isBox(value.mouth) && isPointAt(value.mouth, 'cx', 'cy') &&
    isBetween(value.faceScale, 1e-3, 64) &&
    (value.eyeL === undefined || isEye(value.eyeL)) &&
    (value.eyeR === undefined || isEye(value.eyeR))
}

function isEye(value: unknown): boolean {
  return isBox(value) && isPointAt(value, 'icx', 'icy') && isCoordinate((value as Record<string, unknown>).closeY)
}

function isSkeleton(value: unknown): value is Anime25DSkeleton {
  return isRecord(value) &&
    isText(value.model, MAX_NAME) &&
    isRecord(value.joints) &&
    Object.entries(value.joints).every(([name, joint]) =>
      isOneOf(JOINTS, name) && isPointAt(joint, 'x', 'y') && isBetween((joint as Record<string, unknown>).score, 0, 16))
}

export function isOptionalPartProfile(value: unknown): value is Anime25DPartProfile | undefined {
  return value === undefined || isPartProfile(value)
}

function isPartProfile(value: unknown): value is Anime25DPartProfile {
  return isRecord(value) &&
    value.version === 1 &&
    (value.source === 'ai-vision' || value.source === 'none') &&
    Array.isArray(value.parts) &&
    value.parts.length <= MAX_PROFILE_PARTS &&
    everyItem(value.parts, (part) =>
      isRecord(part) &&
      isText(part.name, MAX_NAME) &&
      (part.layer === null || isText(part.layer, MAX_NAME)) &&
      typeof part.separate === 'boolean' &&
      isNumbers(part.box, 4, isCoordinate) &&
      isNumbers(part.anchor, 2, isCoordinate) &&
      isText(part.bone, MAX_TAG) &&
      isOneOf(PART_MOTIONS, part.motion) &&
      isText(part.material, MAX_TAG) &&
      isShare(part.stiffness) &&
      isShare(part.weight))
}

export function isEnhancement(value: unknown): value is Anime25DEnhancement {
  return isRecord(value) &&
    typeof value.turn === 'boolean' &&
    typeof value.expressions === 'boolean' &&
    (value.body === undefined || typeof value.body === 'boolean') &&
    (value.arms === undefined || typeof value.arms === 'boolean')
}

function isArmVariant(value: unknown, w: number, h: number): value is Anime25DArmVariant {
  return isRecord(value) &&
    isText(value.gesture, MAX_TAG) &&
    (value.lift === 'whole' || value.lift === 'shoulder') &&
    (value.model === undefined || isArmModel(value.model, w, h))
}

/** A gesture arm's measures on its layer, `w` × `h`. */
function isArmModel(value: unknown, w: number, h: number): value is Anime25DArmModel {
  if (!isRecord(value)) return false
  const radii = value.radius
  return isLengths(radii, 2, MAX_RADII) && everyItem(radii, isBone) &&
    isOptional(value.trialPixel, (v) => isBetween(v, 1e-3, 64)) &&
    isOptional(value.restHand, isHand) &&
    isOptional(value.drawnRadius, (v) => isLengths(v, radii.length, radii.length) && everyItem(v, isBone)) &&
    isOptional(value.shortSleeve, isShare) &&
    isOptional(value.restFore, isBone) &&
    isOptional(value.restCuff, (v) => isAlong(v) && v >= LEAST_CUFF) &&
    isOptional(value.cuffFrom, isAlong) &&
    isBone(value.upper) &&
    isBone(value.fore) &&
    isAlong(value.cuff) &&
    isOptional(value.bare, isBone) &&
    isCoordinate(value.bareShift) &&
    isShare(value.restEnd) &&
    isOptional(value.restBand, (v) => isNumbers(v, 2, isShare)) &&
    Array.isArray(value.restReach) && value.restReach.length === radii.length &&
    everyItem(value.restReach, (reach) => reach === null || isNumbers(reach, 2, isLength)) &&
    isArmJoints(value.rest) &&
    isArmJoints(value.raised) &&
    isHand(value.hand) &&
    isNumbers(value.fingers, 5, isLength) &&
    isFingerProfiles(value.fingerProfile) &&
    isFingerProfiles(value.keyProfile) &&
    (value.palmOutline === null || (isPoints(value.palmOutline, 3, MAX_RADII, (v) => isBetween(v, -64, 64)))) &&
    Array.isArray(value.hiddenFingers) && value.hiddenFingers.length <= 5 &&
    everyItem(value.hiddenFingers, (finger) => Number.isInteger(finger) && isBetween(finger, 0, 4)) &&
    isNumbers(value.skin, 3, isLevel) &&
    isNumbers(value.shade, 3, isLevel) &&
    isNumbers(value.line, 3, isLevel) &&
    isRings(value.handOutline, w, h) &&
    isRings(value.armOutline, w, h) &&
    isOptional(value.ground, (v) => isRings(v, w, h))
}

function isArmJoints(value: unknown): boolean {
  return isRecord(value) &&
    isNumbers(value.shoulder, 3, isCoordinate) &&
    isNumbers(value.elbow, 3, isCoordinate) &&
    isNumbers(value.wrist, 3, isCoordinate)
}

/** Its size is from the wrist to the middle finger's root, and the modelled hand is laid on by dividing by it. */
function isHand(value: unknown): boolean {
  return isPoints(value, 21, 21, isCoordinate) && isBone(Math.hypot(value[9][0] - value[0][0], value[9][1] - value[0][1]))
}

/** One per finger, empty where it was not measured; a drawn hand may list fewer. */
function isFingerProfiles(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 5 && everyItem(value, (finger) => isLengths(finger, 0, MAX_RADII))
}

/** Outlines, on their layer or near it. */
function isRings(value: unknown, w: number, h: number): boolean {
  if (!Array.isArray(value) || value.length > MAX_RINGS) return false
  let points = 0
  const isNear = (v: unknown, edge: number) => isBetween(v, -edge * RING_REACH, edge * (1 + RING_REACH))
  return everyItem(value, (ring) => {
    if (!Array.isArray(ring)) return false
    points += ring.length
    return points <= MAX_RING_POINTS &&
      everyItem(ring, (point) => Array.isArray(point) && point.length === 2 && isNear(point[0], w) && isNear(point[1], h))
  })
}

function isPoints(value: unknown, least: number, most: number, within: (v: unknown) => boolean): value is Array<[number, number]> {
  return Array.isArray(value) && value.length >= least && value.length <= most && everyItem(value, (point) => isNumbers(point, 2, within))
}

function isNumbers(value: unknown, length: number, within: (v: unknown) => boolean): boolean {
  return Array.isArray(value) && value.length === length && everyItem(value, within)
}

function isLengths(value: unknown, least: number, most: number): value is number[] {
  return Array.isArray(value) && value.length >= least && value.length <= most && everyItem(value, isLength)
}

type Box = Record<'x0' | 'y0' | 'x1' | 'y1', number>

/** Its edges are the first and last pixels of what it bounds: a line one pixel thick has them in one place. */
function isBox(value: unknown): value is Box {
  return isRecord(value) &&
    isCoordinate(value.x0) && isCoordinate(value.y0) && isCoordinate(value.x1) && isCoordinate(value.y1) &&
    value.x1 >= value.x0 && value.y1 >= value.y0
}

/** The face's size is what the head's meshes and turns are measured by. */
function hasRoom(box: Box): boolean {
  return box.x1 > box.x0 && box.y1 > box.y0
}

function isPointAt(value: unknown, x: string, y: string): boolean {
  return isRecord(value) && isCoordinate(value[x]) && isCoordinate(value[y])
}

function isOneOf(names: Readonly<Record<string, true>>, value: unknown): boolean {
  return typeof value === 'string' && Object.hasOwn(names, value)
}

function isOptional(value: unknown, within: (v: unknown) => boolean): boolean {
  return value === undefined || within(value)
}

/** A key left out, or written as nothing: a layer's optional marks come either way. */
function isAbsent(value: unknown): boolean {
  return value === undefined || value === null
}

function isCoordinate(value: unknown): value is number {
  return isBetween(value, -MAX_COORDINATE, MAX_COORDINATE)
}

function isLength(value: unknown): value is number {
  return isBetween(value, 0, MAX_COORDINATE)
}

/** An arm's length or width, which its mesh is placed by dividing by: some, however little. */
function isBone(value: unknown): value is number {
  return isBetween(value, 1e-3, MAX_COORDINATE)
}

/** A place along a forearm: 0 the elbow, 1 the wrist, a cuff worn over the hand past it. */
function isAlong(value: unknown): value is number {
  return isBetween(value, 0, 4)
}

function isShare(value: unknown): value is number {
  return isBetween(value, 0, 1)
}

function isLevel(value: unknown): value is number {
  return isBetween(value, 0, 255)
}

function isText(value: unknown, most: number): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= most
}

function isBetween(value: unknown, least: number, most: number): value is number {
  return typeof value === 'number' && value >= least && value <= most
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
