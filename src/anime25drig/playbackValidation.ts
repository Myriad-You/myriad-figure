import type { Anime25DArmModel, Anime25DArmVariant, Anime25DEnhancement, Anime25DFade, Anime25DJointName, Anime25DPart, Anime25DPartProfile, Anime25DPlayback, Anime25DPlaybackAnchors, Anime25DPlaybackLayer, Anime25DShellProfile, Anime25DSkeleton } from './types'
import { MAX_RIG_PARTS, MAX_RIG_TOTAL_VERTICES, MAX_RIG_VERTICES_PER_PART } from '../rig/contract'
import { layerMeshVertexBound } from './layerGrid'

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
const MAX_RINGS = 256
const MAX_RING_POINTS = 16_384
/** A ring may run past its layer (the ground about a raised arm) by this many of the layer's own sizes. */
const RING_REACH = 2

const FADES = new Set<string>([
  'eyeOpen', 'eyeClose', 'eyeDizzy', 'eyeSqueeze', 'eyeCry', 'eyeSilly',
  'lovestruckHeart', 'lovestruckFace', 'lovestruckDrool', 'maniacEyeShadow', 'maniacMouthShadow',
  'angerMark', 'speechlessSweat',
  'accentNotes', 'accentQuestion', 'accentSleep', 'accentSparkle', 'accentBlush',
  'mouthOpen', 'mouthWide', 'mouthRound', 'mouthNarrow', 'mouthClose', 'mouthCry', 'mouthManiac', 'mouthSilly',
  'armVariant',
] satisfies Anime25DFade[])
const JOINTS = new Set<string>([
  'nose',
  ...(['eye', 'ear', 'shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle', 'bigToe', 'smallToe', 'heel'] as const)
    .flatMap((joint): Anime25DJointName[] => [`${joint}L`, `${joint}R`]),
])
const PART_MOTIONS = new Set<string>(['rigid', 'sway', 'dangle', 'flutter'] satisfies Array<Anime25DPart['motion']>)

type Canvas = Anime25DPlayback['pixelCanvas']

export function isPlaybackCanvas(value: unknown): value is Canvas {
  return isRecord(value) && isBetween(value.width, 1, MAX_PLAYBACK_EDGE) && isBetween(value.height, 1, MAX_PLAYBACK_EDGE)
}

export function isPlaybackLayers(value: unknown): value is Anime25DPlaybackLayer[] {
  return Array.isArray(value) && value.length > 0 && value.length <= MAX_RIG_PARTS && value.every(isPlaybackLayer)
}

function isPlaybackLayer(value: unknown): value is Anime25DPlaybackLayer {
  return isRecord(value) &&
    isText(value.name, MAX_NAME) &&
    isText(value.role, MAX_TAG) &&
    (value.z === undefined || isCoordinate(value.z)) &&
    isBetween(value.depth, 0, 4) &&
    (value.group === 'head' || value.group === 'body') &&
    (isAbsent(value.phys) || value.phys === 'hair') &&
    (isAbsent(value.fade) || (typeof value.fade === 'string' && FADES.has(value.fade))) &&
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
  return value.every((strand: unknown) => {
    if (!isRecord(strand) || !isCoordinate(strand.x) || !isCoordinate(strand.rootY) || !isCoordinate(strand.tipY)) return false
    const apart = strand.x > previous
    previous = strand.x
    return apart
  })
}

/**
 * The meshes the runtime would build, layer by layer, held to the rig contract's own limits: past them a
 * triangle's indices wrap round, and a drawing as wide as a number can be is memory without end.
 */
export function playbackMeshesFit(playback: Pick<Anime25DPlayback, 'layers' | 'anchors' | 'pixelCanvas'>, shell: Anime25DShellProfile): boolean {
  let total = 0
  return playback.layers.every((source, layerZ) => {
    const vertices = layerMeshVertexBound({
      source,
      canvasWidth: playback.pixelCanvas.width,
      face: playback.anchors.face,
      layerZ,
      faceShell: shell,
      figure: playback.anchors.groundY !== undefined,
    })
    total += vertices
    return vertices <= MAX_RIG_VERTICES_PER_PART && total <= MAX_RIG_TOTAL_VERTICES
  })
}

export function isPlaybackAnchors(value: unknown): value is Anime25DPlaybackAnchors {
  return isRecord(value) &&
    isBox(value.face) && isPointAt(value.face, 'cx', 'cy') &&
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
      JOINTS.has(name) && isPointAt(joint, 'x', 'y') && isBetween((joint as Record<string, unknown>).score, 0, 16))
}

export function isPartProfile(value: unknown): value is Anime25DPartProfile {
  return isRecord(value) &&
    value.version === 1 &&
    (value.source === 'ai-vision' || value.source === 'none') &&
    Array.isArray(value.parts) &&
    value.parts.length <= MAX_PROFILE_PARTS &&
    value.parts.every((part: unknown) =>
      isRecord(part) &&
      isText(part.name, MAX_NAME) &&
      (part.layer === null || isText(part.layer, MAX_NAME)) &&
      typeof part.separate === 'boolean' &&
      isNumbers(part.box, 4, isCoordinate) &&
      isNumbers(part.anchor, 2, isCoordinate) &&
      isText(part.bone, MAX_TAG) &&
      typeof part.motion === 'string' && PART_MOTIONS.has(part.motion) &&
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
  return isLengths(radii, 2, MAX_RADII) && radii.every(isBone) &&
    isOptional(value.trialPixel, (v) => isBetween(v, 1e-3, 64)) &&
    isOptional(value.restHand, isHand) &&
    isOptional(value.drawnRadius, (v) => isLengths(v, radii.length, radii.length) && v.every(isBone)) &&
    isOptional(value.shortSleeve, isShare) &&
    isOptional(value.restFore, isBone) &&
    isOptional(value.restCuff, isAlong) &&
    isOptional(value.cuffFrom, isAlong) &&
    isBone(value.upper) &&
    isBone(value.fore) &&
    isAlong(value.cuff) &&
    isOptional(value.bare, isBone) &&
    isCoordinate(value.bareShift) &&
    isShare(value.restEnd) &&
    isOptional(value.restBand, (v) => isNumbers(v, 2, isShare)) &&
    Array.isArray(value.restReach) && value.restReach.length === radii.length &&
    value.restReach.every((reach: unknown) => reach === null || isNumbers(reach, 2, isLength)) &&
    isArmJoints(value.rest) &&
    isArmJoints(value.raised) &&
    isHand(value.hand) &&
    isNumbers(value.fingers, 5, isLength) &&
    isFingerProfiles(value.fingerProfile) &&
    isFingerProfiles(value.keyProfile) &&
    (value.palmOutline === null || (isPoints(value.palmOutline, 3, MAX_RADII, (v) => isBetween(v, -64, 64)))) &&
    Array.isArray(value.hiddenFingers) && value.hiddenFingers.length <= 5 &&
    value.hiddenFingers.every((finger: unknown) => Number.isInteger(finger) && isBetween(finger, 0, 4)) &&
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

function isHand(value: unknown): boolean {
  return isPoints(value, 21, 21, isCoordinate)
}

/** One per finger, empty where it was not measured; a drawn hand may list fewer. */
function isFingerProfiles(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 5 && value.every((finger: unknown) => isLengths(finger, 0, MAX_RADII))
}

/** Outlines near their layer; filled in together, they ask for a picture as large as they reach: no larger than a frame. */
function isRings(value: unknown, w: number, h: number): boolean {
  if (!Array.isArray(value) || value.length > MAX_RINGS) return false
  let points = 0
  const low = [Infinity, Infinity]
  const high = [-Infinity, -Infinity]
  const isNear = (v: unknown, axis: number, edge: number): boolean => {
    if (!isBetween(v, -edge * RING_REACH, edge * (1 + RING_REACH))) return false
    low[axis] = Math.min(low[axis], v)
    high[axis] = Math.max(high[axis], v)
    return high[axis] - low[axis] <= MAX_PLAYBACK_EDGE
  }
  return value.every((ring: unknown) => {
    if (!Array.isArray(ring)) return false
    points += ring.length
    return points <= MAX_RING_POINTS &&
      ring.every((point: unknown) => Array.isArray(point) && point.length === 2 && isNear(point[0], 0, w) && isNear(point[1], 1, h))
  })
}

function isPoints(value: unknown, least: number, most: number, within: (v: unknown) => boolean): boolean {
  return Array.isArray(value) && value.length >= least && value.length <= most && value.every((point: unknown) => isNumbers(point, 2, within))
}

function isNumbers(value: unknown, length: number, within: (v: unknown) => boolean): boolean {
  return Array.isArray(value) && value.length === length && value.every(within)
}

function isLengths(value: unknown, least: number, most: number): value is number[] {
  return Array.isArray(value) && value.length >= least && value.length <= most && value.every(isLength)
}

/** A box with room in it: what is measured across it divides by its size. */
function isBox(value: unknown): boolean {
  return isRecord(value) &&
    isCoordinate(value.x0) && isCoordinate(value.y0) && isCoordinate(value.x1) && isCoordinate(value.y1) &&
    value.x1 > value.x0 && value.y1 > value.y0
}

function isPointAt(value: unknown, x: string, y: string): boolean {
  return isRecord(value) && isCoordinate(value[x]) && isCoordinate(value[y])
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
