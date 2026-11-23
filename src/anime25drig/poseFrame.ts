import type { Arm3DSide } from './arm3dArm'
import type { V3 } from './arm3dMath'
import type { Arm3DBound } from './arm3dView'
import type { Anime25DArmVariants, DrawnArm, DrawnArms } from './armVariantPresenter'
import type { BodyLift } from './bodyLift'
import type { CollarClipMesh } from './collarRuntime'
import type { ContinuousMouthShape } from './continuousMouth'
import type { ContinuousMouthTexture } from './continuousMouthTexture'
import type { DrawnFrame } from './drawnFrame'
import type { Anime25DDriver } from './driver'
import type { Anime25DGpuLayer } from './layerGpuBinding'
import type { Anime25DArmPose, Anime25DClothPose, Anime25DDrawnArmPose, Anime25DLayerPose, Anime25DPose } from './pose'
import type { Anime25DRenderableLayer, Anime25DRenderFrame } from './renderer'
import type { ThinkingStickerFrame } from './thinkingSticker'

// Taking a drawn frame as a pose, and a pose as a frame to draw. The frame drawn for a pose is made of shadows of the
// layers: the same meshes and textures, the pose's place, opacity and colour; the live layers are not touched.

/** The figure a pose is taken of and drawn on. */
export interface PoseFigure {
  layers: readonly Anime25DGpuLayer[]
  collarClip: CollarClipMesh | null
  armVariants: Anime25DArmVariants
  mouth: ContinuousMouthTexture | null
}

/**
 * What tells one package's poses from another's: its layers as it says them (their modelled arms too), and how many
 * vertices came of them. Not where those lie: that is worked out on each device, and may differ in its last place.
 */
export function figureKey({ layers, collarClip, armVariants, mouth }: PoseFigure): string {
  const parts = layers.map(({ source, rest, indexCount }) => `${JSON.stringify(source)}:${rest.length}:${indexCount}`)
  for (const { side, arm } of armVariants.modelledArms()) parts.push(`${side}:${arm.gestures.map(g => g.gesture).join()}`)
  parts.push(`collar:${collarClip?.deformed.length ?? 0}`, `mouth:${mouth !== null}`)
  let hash = 0x811C9DC5
  for (const char of parts.join('|')) hash = Math.imul(hash ^ char.codePointAt(0)!, 0x01000193) >>> 0
  return `${layers.length}-${hash.toString(16)}`
}

/** A layer whose vertices move: between ticks, the GPU has them as `deformed` does. */
export function moves(layer: Anime25DGpuLayer): boolean {
  return layer.vertexBuffer !== null && layer.deformed !== layer.rest
}

export function capturePose(
  figure: PoseFigure,
  drawn: DrawnFrame,
  state: { key: string, time: number, driver: Anime25DDriver, mouth: Readonly<ContinuousMouthShape> | null },
): Anime25DPose {
  const { layers } = figure
  return {
    version: 1,
    figure: state.key,
    time: state.time,
    driver: { ...state.driver },
    frame: { ...drawn.renderFrame, ...(drawn.renderFrame.bodyLift ? { bodyLift: { ...drawn.renderFrame.bodyLift } } : {}) },
    order: Uint16Array.from(drawn.layers, layer => layers.indexOf(layer as Anime25DGpuLayer)),
    layers: layers.map(layer => ({
      transform: layer.layerTransform.slice(),
      opacity: layer.frameOpacity,
      multiply: layer.frameMultiply?.slice() ?? null,
      behindFace: layer.behindFace ?? 0,
      vertices: moves(layer) ? layer.deformed.slice() : null,
    })),
    collar: figure.collarClip?.deformed.slice() ?? null,
    mouth: state.mouth ? { ...state.mouth } : null,
    sticker: drawn.sticker ? { ...drawn.sticker } : null,
    arms: figure.armVariants.modelledArms().map(({ side, arm }) => captureArms(side, arm, drawn.arms.find(it => it.side === side))),
  }
}

function captureArms(side: Anime25DArmPose['side'], arm: Arm3DSide, drawn: DrawnArms | undefined): Anime25DArmPose {
  return {
    side,
    now: drawn?.now ? captureArm(arm, drawn.now) : null,
    leaving: drawn?.leaving ? captureArm(arm, drawn.leaving) : null,
    cloths: arm.cloths.map((cloth) => {
      const fold = drawn?.cloths.find(it => it.cloth === cloth)?.fold
      return fold ? { nodes: fold.nodes.slice(), under: fold.under.slice(), front: fold.front.slice() } : null
    }),
  }
}

function captureArm(arm: Arm3DSide, { bound, frame, twist }: DrawnArm): Anime25DDrawnArmPose {
  const named = (of: unknown) => arm.gestures.find(g => g.bound === of)!.gesture
  const { shape } = bound
  return {
    gesture: named(bound),
    twist: twist ?? null,
    cuff: shape.cuff,
    radius: [...shape.radius],
    restEnd: shape.restEnd,
    ink: bound.ink ?? null,
    joints: { s: [...frame.pose.s], e: [...frame.pose.e], w: [...frame.pose.w], hand: frame.pose.hand.map(point => [...point]) },
    presence: frame.presence,
    handRest: frame.handRest,
    hanging: frame.hanging,
    restNear: frame.restNear,
    unlined: frame.unlined,
    foot: frame.foot.map(point => [...point]),
    sides: [...frame.sides],
    held: frame.held ? { pos: frame.held.pos.slice(), near: frame.held.near, exact: frame.held.exact, toDrawn: frame.held.toDrawn ? [...frame.held.toDrawn] : null } : null,
    rest: frame.rest ? { corners: [...frame.rest.corners], alpha: frame.rest.alpha } : null,
    also: frame.also?.map(other => ({ gesture: named(other.bound), weight: other.weight })) ?? null,
  }
}

const finite = (value: unknown): value is number => Number.isFinite(value)
const floats = (value: unknown, length: number) => value instanceof Float32Array && value.length === length && value.every(finite)
/** A list of that many (a hole in it is something that is not one of them). */
const each = (value: unknown, length: number, is: (it: unknown, i: number) => boolean) => Array.isArray(value) && value.length === length && Array.from<unknown>(value).every(is)
const list = (value: unknown, length: number) => each(value, length, finite)
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
/** Every one of `like`'s numbers is a number of the value's. */
const has = (value: unknown, like: object): boolean => record(value) && Object.keys(like).every(key => finite(value[key]))

/** Whether a pose is of this figure, whole: every layer, vertex and arm it is drawn with. Anything may be asked. */
export function poseFits(figure: PoseFigure, key: string, pose: Readonly<Anime25DPose>): boolean {
  const { layers, collarClip } = figure
  if (!record(pose) || pose.version !== 1 || pose.figure !== key) return false
  if (!(pose.order instanceof Uint16Array) || pose.order.length !== layers.length || new Set(pose.order).size !== layers.length || pose.order.some(at => at >= layers.length)) return false
  if (!has(pose.frame, FRAME) || (pose.frame.bodyLift !== undefined && !liftFits(pose.frame.bodyLift))) return false
  if (!each(pose.layers, layers.length, (own, i) => layerFits(layers[i]!, own))) return false
  if (collarClip ? !floats(pose.collar, collarClip.deformed.length) : pose.collar !== null) return false
  if (figure.mouth ? !has(pose.mouth, MOUTH) : pose.mouth !== null) return false
  if (pose.sticker !== null && !has(pose.sticker, STICKER)) return false
  const arms = figure.armVariants.modelledArms()
  return each(pose.arms, arms.length, (own, i) => armFits(arms[i]!.side, arms[i]!.arm, own))
}

function layerFits(layer: Anime25DGpuLayer, value: unknown): boolean {
  const own = value as Readonly<Anime25DLayerPose>
  return record(value) && floats(own.transform, 9) && finite(own.opacity) && finite(own.behindFace)
    && (own.multiply === null || floats(own.multiply, 3))
    && (moves(layer) ? floats(own.vertices, layer.rest.length) : own.vertices === null)
}

const liftFits = (lift: Readonly<BodyLift>) => has(lift, LIFT) && [lift.pitch, lift.depth, lift.shoulderY].every(value => value === undefined || finite(value))

const LIFT: BodyLift = { centerX: 0, upperY: 0, lowerY: 0, amount: 0 }
const FRAME: Omit<Anime25DRenderFrame, 'bodyLift'> = { viewWidth: 0, viewHeight: 0, bodyPivotX: 0, bodyPivotY: 0, bodyRotationCosine: 0, bodyRotationSine: 0, bodyBendHeight: 0, time: 0, eyeCry: 0 }
const MOUTH: ContinuousMouthShape = { wide: 0, round: 0, narrow: 0 }
const STICKER: ThinkingStickerFrame = { time: 0, amount: 0, x: 0, y: 0, size: 0 }

function armFits(side: string, arm: Arm3DSide, value: unknown): boolean {
  const own = value as Readonly<Anime25DArmPose>
  return record(value) && own.side === side && [own.now, own.leaving].every(it => it === null || drawnFits(arm, it))
    && each(own.cloths, arm.cloths.length, (cloth, i) => cloth === null || (record(cloth) && arm.cloths[i]!.fits(cloth as unknown as Anime25DClothPose)))
}

function drawnFits(arm: Arm3DSide, it: Readonly<Anime25DDrawnArmPose>): boolean {
  const gesture = record(it) && arm.gestures.find(g => g.gesture === it.gesture)
  if (!gesture) return false
  const { joints, held, rest, also } = it
  return (it.twist === null || finite(it.twist)) && (it.ink === null || finite(it.ink))
    && [it.cuff, it.restEnd, it.presence, it.handRest, it.hanging, it.restNear, it.unlined].every(finite)
    // (A bust's arm between gestures wears the sleeve of another of them.)
    && arm.gestures.some(g => list(it.radius, g.own.radius.length))
    && record(joints) && [joints.s, joints.e, joints.w].every(at => list(at, 3))
    && each(joints.hand, gesture.bound.shape.hand.length, at => list(at, 3))
    && Array.isArray(it.foot) && it.foot.length <= 16 && each(it.foot, it.foot.length, at => list(at, 2))
    && each(it.sides, 2, at => typeof at === 'number' && !Number.isNaN(at))
    && (held === null || (record(held) && floats(held.pos, gesture.layer.rest.length) && finite(held.near) && finite(held.exact) && (held.toDrawn === null || list(held.toDrawn, 6))))
    && (rest === null || (record(rest) && list(rest.corners, 8) && finite(rest.alpha)))
    && (also === null || each(also, 2, other => record(other) && finite(other.weight) && arm.gestures.some(g => g.gesture === other.gesture)))
}

/** The frame that draws a pose that fits: it holds nothing of the pose's own. */
export function poseFrame(figure: PoseFigure, pose: Readonly<Anime25DPose>): DrawnFrame {
  const { layers } = figure
  const arms = figure.armVariants.modelledArms()
  // A cloth away from its layer: the layer wears its picture without it.
  const without = new Map(arms.flatMap(({ arm }, i) => arm.cloths.flatMap((cloth, at) => pose.arms[i]!.cloths[at] ? [[cloth.host, cloth.without] as const] : [])))
  const worn = new Set(arms.flatMap(({ arm }) => arm.cloths.map(cloth => cloth.host)))
  const shadows = new Map<Anime25DRenderableLayer, Anime25DGpuLayer>(layers.map((layer, i) => {
    const own = pose.layers[i]!
    return [layer, {
      ...layer,
      layerTransform: own.transform.slice(),
      frameOpacity: own.opacity,
      frameMultiply: own.multiply?.slice(),
      behindFace: own.behindFace,
      ...(worn.has(layer) ? { ownTexture: without.get(layer) ?? null } : {}),
    }]
  }))
  const shadow = <T extends Anime25DRenderableLayer>(layer: T): Anime25DGpuLayer => shadows.get(layer)!
  for (const own of shadows.values()) {
    if (own.followers) own.followers = own.followers.map(shadow)
    if (own.crownOccluders) own.crownOccluders = own.crownOccluders.map(crown => ({ ...crown, layer: shadow(crown.layer) }))
  }
  return {
    layers: Array.from(pose.order, at => shadow(layers[at]!)),
    collarClip: figure.collarClip,
    renderFrame: { ...pose.frame, ...(pose.frame.bodyLift ? { bodyLift: { ...pose.frame.bodyLift } } : {}) },
    arms: arms.map(({ side, arm, canvas }, i) => {
      const own = pose.arms[i]!
      return {
        side,
        leaving: own.leaving && drawnArm(arm, canvas, own.leaving),
        now: own.now && drawnArm(arm, canvas, own.now),
        front: arm.front.map(shadow),
        cloths: arm.cloths.flatMap((cloth, at) => {
          const fold = own.cloths[at]
          return fold ? [{ cloth, fold: { nodes: fold.nodes.slice(), under: fold.under.slice(), front: fold.front.slice() }, host: shadow(cloth.host), over: cloth.over.map(shadow) }] : []
        }),
      }
    }),
    sticker: pose.sticker && { ...pose.sticker },
  }
}

/** The arm as its gesture binds it, with the sleeve and elbow the pose wears: a copy, which drawing may turn. */
function drawnArm(arm: Arm3DSide, canvas: { width: number, height: number }, own: Readonly<Anime25DDrawnArmPose>): DrawnArm {
  const of = (name: string) => arm.gestures.find(g => g.gesture === name)!
  const { layer, bound: base } = of(own.gesture)
  const twist = own.twist ?? undefined
  const bound: Arm3DBound = {
    ...base,
    shape: { ...base.shape, cuff: own.cuff, radius: [...own.radius], restEnd: own.restEnd },
    ink: own.ink ?? undefined,
    elbowTwist: twist,
  }
  const point = (at: readonly number[]) => [at[0], at[1], at[2]] as V3
  return {
    bound,
    twist,
    frame: {
      pose: { s: point(own.joints.s), e: point(own.joints.e), w: point(own.joints.w), hand: own.joints.hand.map(point) },
      presence: own.presence,
      handRest: own.handRest,
      hanging: own.hanging,
      restNear: own.restNear,
      unlined: own.unlined,
      view: canvas,
      foot: own.foot.map(at => [at[0], at[1]] as [number, number]),
      sides: [own.sides[0]!, own.sides[1]!],
      held: own.held ? { ...arm.heldPicture(layer), pos: own.held.pos.slice(), near: own.held.near, exact: own.held.exact, toDrawn: own.held.toDrawn && [...own.held.toDrawn] as [number, number, number, number, number, number] } : undefined,
      rest: own.rest && { corners: [...own.rest.corners], alpha: own.rest.alpha },
      ...(own.also ? { also: own.also.map(other => ({ bound: of(other.gesture).bound, weight: other.weight })) } : {}),
    },
  }
}
