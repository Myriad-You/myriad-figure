import type { Arm3DWear } from './arm3dLook'
import type { V3 } from './arm3dMath'
import type { Arm3DPose, Arm3DShape } from './arm3dMotion'
import type { Arm3DSourceLayer } from './arm3dPrepare'
import type { Anime25DArmAim, Arm3DStance } from './arm3dReach'
import type { Arm3DBound, Arm3DFrame, Arm3DView } from './arm3dView'
import type { Anime25DGpuLayer } from './layerGpuBinding'
import type { Anime25DRenderFrame } from './renderer'
import type { Anime25DSecondaryDeformationFrame } from './secondaryDeformation'
import { isAnime25DLiningPiece } from '../rig/anime25dLayerSemantics'
import { Arm3DClothLayer } from './arm3dClothLayer'
import { ARM3D_BUST_LIFTED, arm3DInLook, arm3DMixedWear, arm3DOneLook, arm3DTurnWear, arm3DWearDrawn } from './arm3dLook'
import { add, handExactness, mul, norm, smoothstep, sub } from './arm3dMath'
import { arm3DCapReach, arm3DHandMesh, arm3DKeepWhole, arm3DPalmAsModelled, arm3DShoulderIsBare, arm3DSleeveMesh, arm3DWristMesh } from './arm3dMesh'
import { Arm3DMotion, arm3DShape, forearmOver } from './arm3dMotion'
import { ARM3D_INK, arm3DCutSides, arm3DGroundClip, arm3DInk, arm3DProject, arm3DUpperArmAlone, arm3DWristTone, composeArm3DPicture, splitArm3DLayer } from './arm3dPrepare'
import { arm3DAimBones, arm3DAimHand, arm3DAimOf, arm3DCarryHand, Arm3DTransit } from './arm3dReach'
import { armPoints, createBodyTexture, draped, swung } from './arm3dSwing'
import { armDrapeWeight } from './armRig'
import { applyBodyLift } from './bodyLift'
import { readLayerPixels } from './webglRuntime'

/** A vertex of a layer, followed: where it is now against where it rests. */
interface Followed { layer: Anime25DGpuLayer; i: number }

interface Gesture {
  layer: Anime25DGpuLayer
  gesture: string
  bound: Arm3DBound
  motion: Arm3DMotion
  touch: Followed | null
  /** Its place among the figure's layers (a higher one is drawn over a lower). */
  order: number
  /** How near the arm is held to this gesture as drawn (its elbow there, its hand near), and how exactly. */
  near: number
  exact: number
  /** Where its own picture draws the sleeve's end along the forearm (elbow 0, wrist 1). */
  cuff: number
  /** Its sleeve as its own picture has it (a bust's on the way between gestures is turned from one into another). */
  own: Arm3DWear
}

/** A bust's sleeve slides to where the gesture turned to draws its end in about this long (seconds). */
const CUFF = 0.1
/** A bust's sleeve turns into the one of the gesture turned to in this long (seconds). */
const WEAR = 0.35

/** A standing figure's modelled arm comes in over its drawn one, and goes, in this long (seconds), where it hangs. */
const HANDOVER = 0.12
/** One gesture's picture of the arm gives way to another's in this long (seconds), the arm on its way between them. */
const SWITCH = 0.14

/** The trial drew the figure 540 pixels wide; a trial pixel on this canvas. */
function trialPixel(view: { width: number }): number {
  return view.width / 540
}

function moved(f: Followed): [number, number] {
  return [f.layer.deformed[f.i * 2] - f.layer.rest[f.i * 2], f.layer.deformed[f.i * 2 + 1] - f.layer.rest[f.i * 2 + 1]]
}

function nearest(layers: readonly Anime25DGpuLayer[], x: number, y: number, keep: (layer: Anime25DGpuLayer) => boolean): { at: Followed | null; d: number } {
  let at: Followed | null = null
  let best = Infinity
  for (const layer of layers) {
    if (!keep(layer)) continue
    for (let i = 0; i < layer.rest.length / 2; i += 1) {
      const d = Math.hypot(layer.rest[i * 2] - x, layer.rest[i * 2 + 1] - y)
      if (d < best) {
        best = d
        at = { layer, i }
      }
    }
  }
  return { at, d: best }
}

function asSource(layer: Anime25DGpuLayer): Arm3DSourceLayer {
  return layer.source
}

/**
 * One side's arm as a 3D model: always the arm on that side, hanging too
 * (handed to and from the drawn arm at each start and end, the two never
 * quite matched and every gesture began and ended with a change), raised to
 * whichever of its gestures is wanted, one at a time.
 */
export class Arm3DSide {
  readonly gestures: Gesture[] = []
  private shown: Gesture | null = null
  /**
   * A standing figure's arm has one look, whatever its gesture: one arm is drawn, never two crossed over. Only
   * the drawn hand's picture is a gesture's own, and the arm wears the one it left (`worn`) until its hand is
   * no longer that drawing's.
   */
  private oneLook = false
  /**
   * A bust's arm is one arm too: going from one gesture to another it is the same arm in another pose, never two
   * crossed over, wearing the hand of the one it left (`worn`: that gesture's picture and fitted fingers) until
   * its hand is no longer that drawing's. Held, its sleeve is the gesture's own as that picture draws it (one
   * sleeve of all its pictures wore each pose with what another drew, its cuff a flap, streaks where that one saw
   * nothing); on the way it turns from the one into the other on the arm (`wear`), and hangs the leading one's.
   * Not a standing figure's in the rest: its hanging hand is off the picture (none drawn to hang in), the
   * portrait's arm still lies under its sleeve where it hangs, and each gesture keeps its picture of the body
   * beside its arm.
   */
  private bustLook = false
  /** With a bust's one arm: how much its sleeve is each gesture's (shares of `gestures`, summing to 1). */
  private wear: number[] = []
  /** With a bust's one arm: where the sleeve ends along the forearm this frame, and where it does hanging. */
  private cuff: number | null = null
  private hangCuff = 1
  /** With a bust's one arm, the leading gesture: come to rest, the arm is that one's, whichever it last made (each hung a hand of its own at the picture's foot). */
  private rests: Gesture | null = null
  /** The gesture whose hand an arm of one look hangs in. */
  private hangs: Gesture | null = null
  private worn: Gesture | null = null
  /** With one look, the gesture whose picture of the body (the arm off it) stands for them all. */
  private led: Gesture | null = null
  /** With one look: layers given the body's picture while binding, before their gesture was made. */
  private given: Anime25DGpuLayer[] = []
  private wanted: string | null = null
  private shoulder: Followed | null = null
  private foot: Followed[] = []
  /** The picture's sides where it is cut off (a bust's arm at its edge), followed; none where the figure ends inside. */
  private sides: [Followed[], Followed[]] = [[], []]
  /** What the portrait draws in front of the upper arm (hair over the shoulder), drawn again there. */
  front: Anime25DGpuLayer[] = []
  /**
   * A figure's cloth that lies on its upper arm without being the arm's (a cape off the shoulder), each a piece of
   * its own while the arm is away. Left in its layer, the lifted arm came out from under a cape that stayed hanging
   * in the air.
   */
  cloths: Arm3DClothLayer[] = []
  private pose: Arm3DPose | null = null
  private restNear = 1
  /** How near the whole arm is to hanging as drawn, its elbow too (1 there). */
  private restWhole = 1
  private restStayed = 1
  /** How far the sleeve's own line is still held off as the hand first lifts (1 hanging, gone over a moment). */
  private unlined = 1
  private time: number | null = null
  private dt = 0
  private body: Arm3DBodyFrame | undefined
  /**
   * How far the modelled arm is shown over the drawn one: a bust's always (its portrait's hand is off the picture,
   * and the two never quite matched where they handed over); a standing figure's (its hand drawn hanging) only
   * while it gestures, faded in and out where it hangs.
   */
  private presence = 1
  private lastTime: number | null = null
  /** Where the hand is asked to be, in place of a gesture; null, the gestures asked for are followed. */
  private aim: Anime25DArmAim | null = null
  private aiming = false
  /** The drawn hand's turn on an aimed forearm, last frame. */
  private aimTurn = 0
  /** The aim the arm was last stepped to. */
  private aimLast: Anime25DArmAim | null = null
  private transit = new Arm3DTransit()
  /** The arm is wanted elsewhere than it was going: the transit takes it on from where it is, at the next pose. */
  private turned = false
  /** The gesture whose picture the arm wore until it turned to another's, and how long ago: it fades under the new one. */
  private leaving: { g: Gesture; t: number } | null = null
  /** This frame's arm before the body moves it. */
  private stance: Arm3DStance | null = null

  constructor(
    private view: Arm3DView,
    readonly bases: Anime25DGpuLayer[],
    private canvas: { width: number; height: number },
    /** Pieces cut out of the drawn arm into layers of their own (a bracelet): part of it, hidden with it. */
    readonly pieces: Anime25DGpuLayer[] = [],
  ) {}

  /** Each of the side's gestures with a model, made ready to draw (its textures baked); dispose() undoes it. */
  /**
   * The gesture's whole drawn hand (its own layer, never shown) and where it lies on the gesture's layer: held as
   * drawn, the modelled hand wears it, all of it, not only what differs from the portrait.
   */
  private wholeHand(layers: readonly Anime25DGpuLayer[], gesture: Anime25DGpuLayer, atlas: HTMLImageElement): { full: WebGLTexture | null; fullMap: [number, number, number, number] } {
    const name = `arm-variant-hand-${gesture.source.name.slice('arm-variant-'.length)}`
    const own = layers.find((l) => l.source.role === 'arm-variant-hand' && l.source.name === name)?.source
    const pixels = own ? readLayerPixels(atlas, own) : null
    if (!own || !pixels) return { full: null, fullMap: [0, 0, 1, 1] }
    const g = gesture.source
    return {
      full: this.view.picture(pixels),
      fullMap: [(g.x - own.x) / own.w, (g.y - own.y) / own.h, g.w / own.w, g.h / own.h],
    }
  }

  bind(layers: readonly Anime25DGpuLayer[], gl: WebGL2RenderingContext, atlas: HTMLImageElement, drawing?: { texture: WebGLTexture; program: WebGLProgram }): void {
    const { view, bases, canvas } = this
    const bustPixel = trialPixel(canvas)
    const still = layers.filter((layer) => layer.source.role !== 'arm-variant' && !layer.source.fade)
    const arm = (layer: Anime25DGpuLayer) => layer.source.armVariant?.model
    const baseAt = Math.max(...bases.map((b) => layers.indexOf(b)))
    this.front = layers.filter((layer, i) => layer.source.role !== 'arm-variant' && layer.source.role !== 'arm-variant-hand' && layer.source.role !== 'handwear' && !this.pieces.includes(layer)
      && layer.source.role !== 'back-hair' && layer.renderKind === 'ordinary' && (i > baseAt || layer.source.role.includes('hair')))
    const mine = layers.filter((layer) => layer.source.role === 'arm-variant' && arm(layer) && layer.source.side === bases[0]?.source.side)
    const one = arm3DOneLook(mine.map((layer) => ({ gesture: layer.source.armVariant!.gesture, model: arm(layer)! })))
    // What only a standing figure's one look does (a bust's bakes and hangs as a bust's own).
    const standing = one !== null && !one.bust
    const lead = one ? mine[one.lead] : null
    const leadModel = lead ? arm(lead)! : null
    // The palm as the leading gesture draws it, on that gesture's own hand.
    const leadShape = lead && leadModel ? arm3DShape(leadModel, lead.source.x, lead.source.y) : null
    const onePalm = leadShape && leadModel ? arm3DPalmAsModelled(new Arm3DMotion(leadShape, false).keyPose(1, leadShape.rest.s).hand, leadModel.palmOutline) : null
    this.oneLook = standing
    this.hangCuff = one?.look.cuff ?? 1
    this.bustLook = one !== null && one.bust
    // (A bust's hand turns into the next with its bones, as ever: come to a gesture's shape before the arm is there,
    // the modelled hand stood in for the drawn one across the picture, short of it at the fingers' roots.)
    this.transit.handInTime = standing
    /** A figure's gestures wait for the one sleeve they all wear, baked from all their pictures. */
    const waiting: Array<{ lead: boolean; shape: Arm3DShape; px: number; tone: Arm3DBound['wristTone']; passes: (upTo: number) => Parameters<Arm3DView['bakeSleeve']>[3]; made: (sleeve: WebGLTexture, lifted: WebGLTexture | undefined, tone: Arm3DBound['wristTone']) => void; drop: () => void }> = []
    for (const layer of layers) {
      const model = arm(layer)
      if (layer.source.role !== 'arm-variant' || !model || layer.source.side !== bases[0]?.source.side) continue
      const pixels = readLayerPixels(atlas, layer.source)
      if (!pixels) continue
      const own = arm3DShape(model, layer.source.x, layer.source.y)
      // (A bust's is its own as its picture draws it: one arm of its gestures by turning from one's into another's.)
      const shape = standing ? arm3DInLook(own, one!.look) : own
      // Pieces of the drawings themselves are made for a standing figure's arm only (and laid on it only where it
      // has no one look, handed back to its drawn arm where it hangs). A bust's arm is the modelled one alone, wherever it is:
      // the drawing come up over it as it reached its gesture, and gone as it left, was another arm for a moment.
      const laid = own.restFore !== undefined
      // A full body's arm gives its drawn sizes on its own scale; a bust's on its canvas's.
      const px = (standing ? leadModel!.trialPixel : undefined) ?? model.trialPixel ?? bustPixel
      const motion = new Arm3DMotion(own, layer.source.armVariant!.gesture === 'wave', own.restFore === undefined ? 0 : own.rest.s[0] < canvas.width / 2 ? -1 : 1, one !== null, one?.bust && layer !== lead ? leadShape! : undefined)
      const hanging = motion.keyPose(0, shape.rest.s)
      const raised = motion.keyPose(1, shape.rest.s)
      // The portrait about its hanging arm, whole and its arm alone (the arm layers say where the arm is).
      const hangWrist = arm3DWristMesh(shape, hanging, 1)
      // The drawn hand lies where the gesture drew it; the modelled one hangs from the portrait's shoulder.
      // (A bust's palm is each gesture's own, as all its hand is.)
      const palm = standing ? onePalm : arm3DPalmAsModelled(raised.hand, model.palmOutline)
      // A standing figure's hangs where the portrait draws it: the picture about the arm takes it in too.
      const hangHand = shape.restHand ? arm3DHandMesh(shape, hanging, palm) : null
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      // (With room for a short sleeve's shoulder piece, should it prove to wear one.)
      const roomy = shape.restFore !== undefined && shape.shortSleeve !== undefined ? { ...shape, worn: true } : shape
      for (const pos of [arm3DSleeveMesh(roomy, hanging, 1, px).pos, hangWrist.pos, ...(hangHand ? [hangHand.pos] : [])]) {
        for (let i = 0; i < pos.length; i += 3) {
          x0 = Math.min(x0, pos[i])
          x1 = Math.max(x1, pos[i])
          y0 = Math.min(y0, pos[i + 1])
          y1 = Math.max(y1, pos[i + 1])
        }
      }
      const pad = 8 * px
      const rect = {
        x: Math.max(0, Math.floor(x0 - pad)),
        y: Math.max(0, Math.floor(y0 - pad)),
        w: 0,
        h: 0,
      }
      rect.w = Math.max(1, Math.min(canvas.width, Math.ceil(x1 + pad)) - rect.x)
      rect.h = Math.max(1, Math.min(canvas.height, Math.ceil(y1 + pad)) - rect.y)
      const whole = composeArm3DPicture(atlas, still.map(asSource), rect)
      const armOnly = composeArm3DPicture(atlas, [...bases, ...this.pieces].map(asSource), rect)
      // The portrait's arm as it hangs, laid under the modelled one at rest: the tube falls short of a sleeve drawn
      // wider (its mouth flaring off the picture's foot), and the arm layer itself is hidden.
      // Below the elbow only, come in across it: above, the tube is the arm, its top fading into the body under it.
      const restPixels = new Uint8ClampedArray(armOnly.pixels)
      const elbowY = hanging.e[1] - rect.y
      const across = 0.2 * shape.upper
      for (let ry = 0; ry < armOnly.height; ry += 1) {
        const k = smoothstep(elbowY - across, elbowY, (ry + 0.5) * rect.h / armOnly.height)
        for (let rx = 0; rx < armOnly.width; rx += 1) restPixels[(ry * armOnly.width + rx) * 4 + 3] *= k
      }
      const restArm = view.picture({ pixels: restPixels, width: armOnly.width, height: armOnly.height })
      // A figure's sleeve wears the arm layer's own drawing: the portrait's over it took in what hangs in front of
      // the arm (a cape's hem at the elbow), and the lifted arm carried that off with it, a piece of the cape on the sleeve.
      // A standing figure's shoulder cap: the arm layer where the portrait shows it, nothing worn over it (a
      // pauldron, an epaulette: the arm's skin under one came out on top of it), nor the pieces the arm carries.
      const capPixels = shape.restFore !== undefined ? composeArm3DPicture(atlas, bases.map(asSource), rect).pixels : null
      const capDrawn = capPixels?.slice()
      for (let i = 0; i < whole.pixels.length; i += 4) {
        const drawn = armOnly.pixels[i + 3] >= 128
        if (capPixels) {
          const off = Math.abs(whole.pixels[i] - capPixels[i]) + Math.abs(whole.pixels[i + 1] - capPixels[i + 1]) + Math.abs(whole.pixels[i + 2] - capPixels[i + 2])
          capPixels[i + 3] = capPixels[i + 3] >= 128 && off < 48 ? 255 : 0
          // (Off it the portrait's colour, as the arm's own picture below: its edge is not drawn toward black.)
          if (capPixels[i + 3] === 0) capPixels.set([whole.pixels[i], whole.pixels[i + 1], whole.pixels[i + 2]], i)
        }
        // (Off the arm the portrait's colour still: a sample across the arm's edge is not drawn toward black.)
        if (!standing || !drawn) armOnly.pixels.set([whole.pixels[i], whole.pixels[i + 1], whole.pixels[i + 2]], i)
        armOnly.pixels[i + 3] = drawn ? 255 : 0
      }
      if (capPixels) {
        const k = armOnly.width / rect.w
        // (An arm of more than one look has no picture of its own to take it from: no cap.)
        const bare = standing && arm3DShoulderIsBare(capPixels, armOnly.width, armOnly.height, (hanging.s[0] - rect.x) * k, (hanging.s[1] - rect.y) * k, arm3DCapReach(shape) * k)
        if (!bare) capPixels.fill(0)
        // Something worn there over a short sleeve: the arm layer's own drawing of it all, carried flat with the upper arm.
        if (!bare && standing && capDrawn && shape.shortSleeve !== undefined) {
          shape.worn = true
          const hungL = Math.hypot(hanging.e[0] - hanging.s[0], hanging.e[1] - hanging.s[1]) || 1
          const hungX = (hanging.e[0] - hanging.s[0]) / hungL
          const hungY = (hanging.e[1] - hanging.s[1]) / hungL
          for (let i = 0; i < capDrawn.length; i += 4) {
            // (About the shoulder only where the portrait shows it: the arm's skin drawn on under the body's straps
            // stays under them. Further down all of it: what hangs from the body before the sleeve stays behind.)
            const at = i / 4
            const down = (((at % armOnly.width) + 0.5) / k + rect.x - hanging.s[0]) * hungX + ((Math.floor(at / armOnly.width) + 0.5) / k + rect.y - hanging.s[1]) * hungY
            const off = Math.abs(whole.pixels[i] - capDrawn[i]) + Math.abs(whole.pixels[i + 1] - capDrawn[i + 1]) + Math.abs(whole.pixels[i + 2] - capDrawn[i + 2])
            const on = capDrawn[i + 3] >= 128 && (off < 48 || down > 0.2 * shape.upper)
            capPixels.set(on ? [capDrawn[i], capDrawn[i + 1], capDrawn[i + 2], 255] : [whole.pixels[i], whole.pixels[i + 1], whole.pixels[i + 2], 0], i)
          }
          arm3DKeepWhole(capPixels, armOnly.width, armOnly.height, 0.02)
        }
      }
      const size = { width: pixels.width, height: pixels.height }
      const atLayer = (from: readonly Anime25DGpuLayer[], blur = 0) => composeArm3DPicture(atlas, from.map(asSource), layer.source, size, blur).pixels
      const portraitHere = atLayer(still)
      const split = splitArm3DLayer(pixels, model, pixels.width / layer.source.w, {
        whole: portraitHere,
        arm: atLayer(bases),
        // About where the portrait's arm was: its rim, the gesture's arm drawn beside it on the ground, is not body.
        near: atLayer(bases, 4 * px * pixels.width / layer.source.w),
      }, standing)
      const toLayer = (x: number, y: number): [number, number] => [(x - layer.source.x) / layer.source.w * pixels.width, (y - layer.source.y) / layer.source.h * pixels.height]
      const share = (r: { x: number; y: number; w: number; h: number }): [number, number, number, number] => [r.x / canvas.width, r.y / canvas.height, r.w / canvas.width, r.h / canvas.height]
      const layerRect = share(layer.source)
      const wholeTexture = view.picture(whole, false)
      const armMask = view.picture(armOnly, true)
      const cap = capPixels ? view.picture({ pixels: capPixels, width: armOnly.width, height: armOnly.height }, true) : undefined
      const keyTexture = view.picture({ pixels: split.arm, width: pixels.width, height: pixels.height }, false)
      // A bust's lifted upper sleeve is the gesture's drawing of it only where that shows it: under a forearm folded
      // back up it the drawing has the forearm, and the upper sleeve wore that (a fan of the forearm's folds, pale
      // on the portrait's sleeve, as the forearm swung off it); there it stays the portrait's.
      const over = forearmOver(shape, raised)
      const passes = (upTo: number, apart = false): Parameters<Arm3DView['bakeSleeve']>[3] => [
        { src: standing ? armMask : wholeTexture, rect: share(rect), pose: hanging, rest: 1, minFace: -0.05, maskFrom: standing ? 0 : 2, vmax: Math.min(shape.restEnd, upTo) },
        { src: armMask, rect: share(rect), pose: hanging, rest: 1, minFace: -0.05, maskFrom: 0, vmax: upTo },
        { src: keyTexture, rect: layerRect, pose: raised, rest: 0, minFace: 0.15, maskFrom: 0, vmax: 2, ...(apart ? { over } : {}) },
        // (Past the portrait's own edge it has nothing to give either: what the gesture drew there after all.)
        ...(apart
          ? [
              { src: wholeTexture, rect: share(rect), pose: hanging, rest: 1, minFace: -0.05, maskFrom: 2, vmax: shape.restEnd },
              { src: keyTexture, rect: layerRect, pose: raised, rest: 0, minFace: 0.15, maskFrom: 0, vmax: 2 },
            ]
          : []),
      ]
      const drop = () => {
        gl.deleteTexture(wholeTexture)
        gl.deleteTexture(keyTexture)
      }
      // A wave's forearm swings off the drawing; the others' is held where drawn.
      const alone = laid ? arm3DUpperArmAlone(pixels.pixels, portraitHere, atLayer(this.front), pixels.width, pixels.height, model, pixels.width / layer.source.w, split.portraitArm, layer.source.armVariant!.gesture !== 'wave') : null
      const piece = (of: Uint8ClampedArray | null | undefined) => of ? view.picture({ pixels: of, width: pixels.width, height: pixels.height }) : null
      const held = piece(alone?.over)
      const heldBeside = piece(alone?.beside)
      const heldFore = piece(alone?.fore)
      const heldForeFront = piece(alone?.foreFront)
      const R = model.radius
      const half = R.length >> 1
      const ground = model.ground && arm3DGroundClip(
        model.ground.map((ring) => ring.map(([x, y]) => [x + layer.source.x, y + layer.source.y] as [number, number])),
        shape.raised.s, shape.raised.e, shape.raised.w,
        1.25 * Math.max(...R.slice(0, half + 1)),
        1.1 * R.slice(half).reduce((a, b) => a + b, 0) / (R.length - half),
        (r) => composeArm3DPicture(atlas, still.map(asSource), r, undefined, 3).pixels,
      )
      const groundClip = ground
        ? { texture: view.picture({ pixels: ground.pixels, width: ground.rect.w, height: ground.rect.h }, false), rect: [ground.rect.x, ground.rect.y, ground.rect.w, ground.rect.h] as [number, number, number, number] }
        : null
      const hangMesh = arm3DSleeveMesh(shape, hanging, 1, px)
      const hangPic = new Float32Array(hangMesh.pos.length / 3 * 2)
      for (let i = 0; i < hangPic.length / 2; i += 1) {
        hangPic[i * 2] = hangMesh.pos[i * 3] / canvas.width
        hangPic[i * 2 + 1] = hangMesh.pos[i * 3 + 1] / canvas.height
      }
      const dx = raised.hand[0][0] - shape.hand[0][0]
      const dy = raised.hand[0][1] - shape.hand[0][1]
      const onLayer = (x: number, y: number): [number, number] => {
        const [lx, ly] = toLayer(x - dx, y - dy)
        return [lx / pixels.width, ly / pixels.height]
      }
      const [handPic, handWt] = arm3DProject(arm3DHandMesh(shape, raised, palm), onLayer)
      // The wrist (a bare forearm) wears the drawn skin too: the gesture's raised, the portrait's hanging.
      const [wristPic, wristWt] = arm3DProject(arm3DWristMesh(shape, raised), onLayer)
      const onMask = (x: number, y: number): [number, number] => [(x - rect.x) / rect.w, (y - rect.y) / rect.h]
      const [wristHangPic, wristHangWt] = arm3DProject(hangWrist, onMask)
      // A standing figure's hand hangs where the portrait draws it, and wears that drawing there.
      const [handHangPic, handHangWt] = hangHand ? arm3DProject(hangHand, onMask) : []
      const tone = arm3DWristTone(split.hand, pixels.width, pixels.height, shape, toLayer)
      const order = layers.indexOf(layer)
      // (A bust's sleeve is lined as dark as its own picture lines its arm.)
      const ink = laid ? ARM3D_INK : arm3DInk(split.arm, pixels.width, pixels.height)
      const made = (sleeve: WebGLTexture, lifted: WebGLTexture | undefined, wristTone: Arm3DBound['wristTone']) => {
      const bound: Arm3DBound = {
        shape,
        px,
        sleeve,
        lifted,
        hand: view.picture({ pixels: split.hand, width: pixels.width, height: pixels.height }),
        drawn: view.picture(pixels),
        // (A bust's too: its modelled fingers leave a curled hand's palm open, the body showing through a fist.)
        ...this.wholeHand(layers, layer, atlas),
        armMask,
        cap,
        maskRect: share(rect),
        handPic,
        handWt,
        wristPic,
        wristWt,
        wristHangPic,
        wristHangWt,
        ...(handHangPic && handHangWt ? { handHangPic, handHangWt } : {}),
        hangPic,
        palm,
        wristTone,
        ...(laid ? {} : { ink }),
        drawnHand: raised.hand.map((q) => [q[0], q[1], q[2]] as V3),
        drawnPic: [dx + layer.source.x, dy + layer.source.y, 1 / layer.source.w, 1 / layer.source.h],
        held,
        heldBeside,
        heldFore,
        heldForeFront,
        groundClip,
        restArm: { texture: restArm, rect: [rect.x, rect.y, rect.w, rect.h], at: armPoints(hanging) },
      }
      // The body the portrait's arm leaves bare: drawn in the arm's place.
      this.gestures.push({ layer, gesture: layer.source.armVariant!.gesture, bound, motion, touch: this.touchOf(layers, shape), order, near: 0, exact: 0, cuff: shape.cuff, own: { radius: [...shape.radius], restEnd: shape.restEnd, ink } })
      }
      if (standing) {
        waiting.push({ lead: layer === lead, shape, px, tone, passes, made, drop })
      }
      else {
        // Lifted, the portrait's sleeve stops short of a band the gestures all draw at the wrist instead.
        // A bust's is the gesture's own drawing about the elbow whether or not a band was found there.
        if (!laid && !shape.restBand) shape.restBand = [...ARM3D_BUST_LIFTED]
        made(view.bakeSleeve(shape, px, canvas, passes(2)), shape.restBand ? view.bakeSleeve(shape, px, canvas, passes(shape.restBand[0], !laid)) : undefined, tone)
        drop()
      }
      layer.ownTexture = createBodyTexture(gl, split.body, pixels.width, pixels.height)
      layer.follows = true
      this.given.push(layer)
    }
    const led = waiting.find((w) => w.lead) ?? waiting[0]
    if (led) {
      // The portrait's sleeve as it hangs, then every gesture's picture of it raised, the leading one's first.
      const bake = (upTo: number) => view.bakeSleeve(led.shape, led.px, canvas, [...led.passes(upTo), ...waiting.filter((w) => w !== led).map((w) => w.passes(upTo)[2])])
      const sleeve = bake(2)
      const lifted = led.shape.restBand ? bake(led.shape.restBand[0]) : undefined
      for (const w of waiting) {
        w.made(sleeve, lifted, led.tone)
        w.drop()
      }
    }
    const first = this.gestures[0]?.bound.shape
    const host = bases.reduce<Anime25DGpuLayer | null>((last, layer) => (!last || layers.indexOf(layer) > layers.indexOf(last) ? layer : last), null)
    if (host) host.followers = this.gestures.map((g) => g.layer)
    if (first && this.oneLook && drawing) {
      const half = first.radius.length >> 1
      const hanging = { ...first.rest, upper: Math.max(...first.radius.slice(0, half + 1)), fore: Math.max(...first.radius.slice(half)), side: this.out(first) }
      const gpu = { gl, ...drawing, atlasWidth: atlas.naturalWidth, atlasHeight: atlas.naturalHeight }
      const mine = (layer: Anime25DGpuLayer) => layer.source.role === 'arm-variant' || layer.source.role === 'arm-variant-hand' || layer.source.role === 'handwear' || this.pieces.includes(layer)
      for (const layer of this.front) {
        if (layer.source.role !== 'topwear' || isAnime25DLiningPiece(layer.source.name) || layer.ownTexture || !layer.vao) continue
        try {
          const over = layers.slice(layers.indexOf(layer) + 1).filter((l) => l.renderKind === 'ordinary' && !mine(l))
          const cloth = Arm3DClothLayer.bind(gpu, layer, over, hanging)
          if (cloth) this.cloths.push(cloth)
        } catch (error) {
          console.warn('[figure] cloth over the arm left in its layer: it could not be cut out', error)
        }
      }
    }
    if (first) {
      this.shoulder = nearest(layers, first.rest.s[0], first.rest.s[1], (l) => l.source.role !== 'arm-variant' && l.source.role !== 'arm-variant-hand' && l.source.role !== 'handwear' && !l.source.role.startsWith('hair') && !l.source.role.includes('hair')).at
    }
    // The picture's foot: the layers' lowest points as they rest, followed (not a gesture's hand, never shown).
    const shown = layers.filter((layer) => layer.source.role !== 'arm-variant-hand')
    let footY = -Infinity
    for (const layer of shown) {
      for (let i = 1; i < layer.rest.length; i += 2) footY = Math.max(footY, layer.rest[i])
    }
    for (const layer of shown) {
      for (let i = 0; i < layer.rest.length / 2; i += 1) {
        if (layer.rest[i * 2 + 1] >= footY - 0.5) this.foot.push({ layer, i })
      }
    }
    // Its sides likewise, where the picture's edge cuts it: there the drawn arm stops, and the modelled one, a
    // whole tube, ran on past it into the margin.
    // A standing figure stands inside its margin, never cut at a side: its long hair's straight mesh edge read
    // as one, and cut off the arm swung out past it.
    const figure = this.gestures.some((g) => g.bound.shape.restFore !== undefined)
    const sides = figure ? [[], []] as ReturnType<typeof arm3DCutSides> : arm3DCutSides(layers, canvas.height)
    this.sides = [sides[0].map(([l, i]) => ({ layer: layers[l], i })), sides[1].map(([l, i]) => ({ layer: layers[l], i }))]
    // One of one look hangs in a gesture's hand from the first frame: the one that hangs most like a hand at rest.
    const hangs = this.oneLook ? ['chest', 'chin', 'wave', 'point'].map((name) => this.gestures.find((g) => g.gesture === name)).find((g) => g) : undefined
    this.hangs = hangs ?? null
    if (hangs) { for (const g of this.gestures) g.motion.hangIn(hangs.motion.hangHand)
}
    this.shown = hangs ?? this.gestures[0] ?? null
    this.worn = this.shown
    this.led = lead && standing ? this.gestures.find((g) => g.layer === lead) ?? null : null
    this.rests = lead && one?.bust ? this.gestures.find((g) => g.layer === lead) ?? null : null
  }

  /** A hand drawn touching the face (at the chin) stays on it while the head turns. */
  private touchOf(layers: readonly Anime25DGpuLayer[], shape: Arm3DShape): Followed | null {
    const tip = shape.hand[8]
    const found = nearest(layers, tip[0], tip[1], (l) => l.source.role === 'face')
    const size = Math.hypot(shape.hand[9][0] - shape.hand[0][0], shape.hand[9][1] - shape.hand[0][1])
    return found.d <= size * 0.6 ? found.at : null
  }

  request(gesture: string | null): void {
    this.wanted = gesture && this.gestures.some((g) => g.gesture === gesture) ? gesture : null
  }

  /**
   * Put the hand where `aim` says, from wherever the arm is; null lets it follow the gestures asked for again.
   * An aim that is not numbers is none.
   */
  aimAt(aim: Anime25DArmAim | null): void {
    const sound = aim !== null && [aim.out, aim.up, aim.forward, aim.swivel ?? 0].every((n) => Number.isFinite(n))
    this.aim = sound && this.gestures.length > 0 ? aim : null
  }

  /** An aim moved further in one frame than a hand is led (arm lengths, radians): the arm goes there, it is not put there. */
  private aimLeapt(aim: Anime25DArmAim): boolean {
    const last = this.aimLast
    if (!last || last === aim) return false
    return Math.hypot(aim.out - last.out, aim.up - last.up, aim.forward - last.forward) > 0.06
      || Math.abs((aim.swivel ?? 0) - (last.swivel ?? 0)) > 0.15
  }

  /** The aim that holds the arm as `gesture` is drawn; null without that gesture. */
  aimOf(gesture: string): Anime25DArmAim | null {
    const g = this.gestures.find((it) => it.gesture === gesture)
    if (!g) return null
    return { ...this.drawnAim(g), hand: gesture }
  }

  private drawnAim(g: Gesture): Required<Omit<Anime25DArmAim, 'hand'>> {
    const d = g.bound.shape
    const drawn = g.motion.keyPose(1, [0, 0, 0])
    return arm3DAimOf(norm(drawn.e), norm(sub(drawn.w, drawn.e)), this.out(d), d.upper, d.fore)
  }

  /** Which way is out from the body for this arm: 1 the picture's right, -1 its left. */
  private out(d: Arm3DShape): number {
    return d.rest.s[0] < this.canvas.width / 2 ? -1 : 1
  }

  /** The gesture whose picture an aimed arm wears: the one named, else the one it has, else the one drawn nearest. */
  private aimLook(aim: Anime25DArmAim, shown: Gesture): Gesture {
    const named = aim.hand ? this.gestures.find((g) => g.gesture === aim.hand) : undefined
    if (named) return named
    if (this.aiming) return shown
    let best = shown
    let nearest = Infinity
    for (const g of this.gestures) {
      const at = this.drawnAim(g)
      const off = Math.hypot(at.out - aim.out, at.up - aim.up, at.forward - aim.forward)
      if (off < nearest) {
        nearest = off
        best = g
      }
    }
    return best
  }

  /** An aimed arm wearing `g`'s picture, before the body moves it. */
  private aimed(aim: Anime25DArmAim, g: Gesture): Arm3DStance {
    const d = g.bound.shape
    const { du, df } = arm3DAimBones(aim, this.out(d), d.upper, d.fore)
    const drawn = g.motion.keyPose(1, [0, 0, 0])
    const depth = (du[2] * d.upper + df[2] * d.fore - drawn.w[2]) / (d.upper + d.fore)
    const from = drawn.hand.map((q) => sub(q, drawn.w))
    // A figure's hand is the arm's own, modelled whole: it turns with its forearm. A bust's is its drawing.
    if (this.oneLook) return { du, df, upper: d.upper, fore: d.fore, hand: arm3DCarryHand(from, norm(sub(drawn.w, drawn.e)), df, depth), handRest: 0, hanging: 0 }
    const { hand, turned } = arm3DAimHand(from, norm(sub(drawn.w, drawn.e)), df, depth, this.aimTurn)
    this.aimTurn = turned
    return { du, df, upper: d.upper, fore: d.fore, hand, handRest: 0, hanging: 0 }
  }

  /** What it shows or is raising now; null while down or going down. */
  raised(): string | null {
    return this.shown?.motion.wanted ? this.shown.gesture : null
  }

  /**
   * From wherever the arm is straight to `to` held (an aim's look, another gesture), or to hanging (null): what
   * is wanted changes at once, and the transit takes the arm there.
   */
  private turnTo(to: Gesture | null): void {
    const from = this.shown!
    const next = to ?? from
    if (next !== from) {
      this.leaving = { g: from, t: 0 }
      from.motion.snap(false)
      this.shown = next
    }
    if (!this.aiming && this.aim) this.aimTurn = 0
    this.aiming = this.aim !== null
    next.motion.snap(to !== null)
    this.turned = true
  }

  /**
   * Steps the arm to `time`. Hanging, it is raised to the gesture wanted along that gesture's own way; already
   * up (or aimed), it goes straight on to the next thing wanted. Writes the layers' opacity.
   */
  applyOpacity(time: number): void {
    const shown = this.shown
    if (!shown) return
    this.dt = this.time === null ? 0 : Math.min(0.1, Math.max(0, time - this.time))
    this.time = time
    // A standing figure's, its whole arm drawn hanging (its hand too, or not found sure enough).
    // (One of one look is the modelled arm from the first frame on and stays it: handed back to the drawn one where
    // it hangs, the two never quite matched, and the hand was another picture each time.)
    const handover = shown.bound.shape.restFore !== undefined && !this.oneLook
    const up = !handover || this.presence >= 1
    const want = this.gestures.find((g) => g.gesture === this.wanted) ?? null
    if (this.aim) {
      const look = this.aimLook(this.aim, shown)
      if (up && (!this.aiming || look !== shown)) this.turnTo(look)
      else if (this.aiming && this.aimLeapt(this.aim)) this.turned = true
      if (this.aiming) this.aimLast = this.aim
    }
    else if (this.aiming || (want && want !== shown && !(shown.motion.resting && this.transit.idle))) {
      this.turnTo(want)
    }
    const now = this.shown!
    if (!this.aiming) now.motion.wanted = now.gesture === this.wanted
    if (!now.motion.wanted && this.wanted && now.motion.resting && this.transit.idle) {
      this.shown = this.gestures.find((g) => g.gesture === this.wanted) ?? now
    }
    else if (this.rests && !this.aim && !this.wanted && now !== this.rests && now.motion.resting && this.transit.idle) {
      this.shown = this.rests
    }
    return this.show(time, handover)
  }

  private show(time: number, handover: boolean): void {
    const now = this.shown!
    const dt = this.lastTime === null ? 0 : Math.min(1 / 30, Math.max(0, time - this.lastTime))
    if (handover) {
      // Turned to hanging this frame, it is still on its way (the transit takes it up once posed): for that one
      // frame nothing held the arm, and the drawn one showed hanging beside it.
      const active = this.wanted !== null || this.aim !== null || this.turned || !now.motion.resting || !this.transit.idle
      this.presence = this.lastTime === null
        ? active ? 1 : 0
        : Math.min(1, Math.max(0, this.presence + (active ? 1 : -1) * dt / HANDOVER))
      // It sets off once wholly in, faded in over the drawn arm where that hangs.
      if (this.presence < 1 && !this.aiming) now.motion.wanted = false
    }
    this.lastTime = time
    now.motion.step(time)
    const leaving = this.leaving
    if (leaving) {
      leaving.t += dt
      if (leaving.t >= SWITCH || leaving.g === now) this.leaving = null
    }
    const own = !handover || this.presence >= 1
    for (const g of this.gestures) g.layer.frameOpacity = g === now && own ? 1 : 0
    // Coming in or going, the drawn arm stays whole under it: two half-shown arms darken.
    if (!own) return
    // One look: one picture of the body under the arm whatever it turns to (each gesture's drew the clothes about
    // the arm its own way, and one fading into the next stood as a second picture beside the moving arm).
    if (this.oneLook && this.led) {
      for (const g of this.gestures) g.layer.frameOpacity = g === this.led ? 1 : 0
    }
    else
    // Between two gestures' pictures the upper layer fades over the lower, whole (two half-shown let the body through).
    if (this.leaving) {
      const over = now.order > this.leaving.g.order
      this.leaving.g.layer.frameOpacity = over ? 1 : 1 - this.switched
      now.layer.frameOpacity = over ? this.switched : 1
    }
    for (const base of this.bases) base.frameOpacity = 0
    for (const piece of this.pieces) piece.frameOpacity = 0
  }

  /** How far the picture of the gesture turned to has come in over the one left (1 with none left). */
  private get switched(): number {
    return this.leaving ? smoothstep(0, 1, this.leaving.t / SWITCH) : 1
  }

  /**
   * This frame's pose, once the layers are deformed: hung from the shoulder as the body carries it, and, hanging,
   * swung as the drawn arm it stands for would be (`sway`, this frame's arm turns; the drawn arm is hidden and
   * not deformed). Left still, the arm hung stiff beside a body that breathed and swayed.
   */
  applyLift(sway?: Anime25DSecondaryDeformationFrame, body?: Arm3DBodyFrame): void {
    const g = this.shown
    if (!g) return
    const [mx, my] = this.shoulder ? moved(this.shoulder) : [0, 0]
    // A standing figure's chest carries its arm whole, turned with it, as its bones carry the drawn sleeve: the arm
    // is posed about its resting shoulder and carried after. A bust's moves with its shoulder and its shader's lean.
    const chest = sway?.figure?.pose.chest
    const [dx, dy] = chest ? [0, 0] : [mx, my]
    const a = g.bound.shape.rest.s
    const anchor: V3 = [a[0] + dx, a[1] + dy, a[2]]
    // What the arm is asked to be this frame (its gesture's own motion, or an aim), and the transit's way there
    // from whatever it was asked before; nothing of that left, it is the gesture's motion to the last bit.
    const asked = g.motion.pose(anchor)
    const wanted: Arm3DStance = this.aiming && this.aim
      ? this.aimed(this.aim, g)
      : { du: norm(sub(asked.e, asked.s)), df: norm(sub(asked.w, asked.e)), upper: g.motion.upper, fore: Math.hypot(asked.w[0] - asked.e[0], asked.w[1] - asked.e[1], asked.w[2] - asked.e[2]), hand: asked.hand.map((q) => sub(q, asked.w)), handRest: g.motion.handRest, hanging: g.motion.hanging }
    if (this.turned) this.transit.retarget(wanted)
    this.turned = false
    const stance = this.transit.pose(wanted, Math.min(1 / 30, this.dt))
    this.stance = stance
    if (this.bustLook) {
      const at = this.gestures.indexOf(g)
      this.wear = this.wear.length === this.gestures.length ? arm3DTurnWear(this.wear, at, this.dt / WEAR) : this.gestures.map((_, i) => (i === at ? 1 : 0))
      const to = this.hangCuff + (g.cuff - this.hangCuff) * (1 - stance.hanging)
      this.cuff = this.cuff === null ? to : this.cuff + (to - this.cuff) * Math.min(1, this.dt / CUFF)
    }
    let pose = asked
    if (stance !== wanted || this.aiming) {
      const e = add(anchor, mul(stance.du, stance.upper))
      const w = add(e, mul(stance.df, stance.fore))
      pose = { s: anchor, e, w, hand: stance.hand.map((q) => add(w, q)) }
    }
    const hang = g.motion.keyPose(0, anchor)
    const fore = g.bound.shape.fore
    this.restNear = 1 - smoothstep(0.03 * fore, 0.25 * fore, Math.hypot(pose.w[0] - hang.w[0], pose.w[1] - hang.w[1], pose.w[2] - hang.w[2]))
    // The sleeve's own line held off a moment as the hand first lifts, however fast: round, the sleeve is short of a
    // flared cuff's drawn mouth, and the step that leaves (a light seam) came out lined, a stroke across the body.
    // The portrait's arm kept under it that long instead stood beside a bending arm as a dark wedge.
    this.unlined = sleeveLineHeldOff(this.unlined, this.restNear, this.dt)
    // A standing figure's arm is the portrait's only with its elbow there too: its hand near hanging on an arm bent
    // another way, the portrait's arm fitted to it stood beside it a frame or two, sheared.
    const upper = g.bound.shape.upper
    this.restWhole = this.oneLook
      ? this.restNear * (1 - smoothstep(0.03 * upper, 0.25 * upper, Math.hypot(pose.e[0] - hang.e[0], pose.e[1] - hang.e[1], pose.e[2] - hang.e[2])))
      : this.restNear
    // And only once it has stayed there: an arm let fall swings through where it hangs and a little past, and the
    // portrait's arm showed for the frame it passed.
    this.restStayed = this.oneLook && this.restWhole < 0.85 ? 0 : Math.min(1, this.restStayed + this.dt / STAYED)
    // Held as drawn: its elbow where the gesture has it, its hand near (a wave swings the hand, not the elbow).
    // (An arm of one look is the modelled one wherever it is: a gesture's drawn pieces, laid on as it came to rest
    // where that gesture drew it, were another sleeve of another cut come up over this one, and gone as it left.)
    // (A bust's one arm wears its gesture's drawn hand whole, held as drawn: of the one it wears, too.)
    for (const it of this.oneLook ? [] : new Set([g, ...(this.leaving ? [this.leaving.g] : []), ...(this.bustLook && this.worn ? [this.worn] : [])])) {
      const drawn = it.motion.restPose(anchor)
      const upper = it.bound.shape.upper
      const reach = it.bound.shape.fore
      it.near = (1 - smoothstep(0.01 * upper, 0.05 * upper, Math.hypot(pose.e[0] - drawn.e[0], pose.e[1] - drawn.e[1], pose.e[2] - drawn.e[2])))
        * (1 - smoothstep(0.35 * reach, 0.6 * reach, Math.hypot(pose.w[0] - drawn.w[0], pose.w[1] - drawn.w[1], pose.w[2] - drawn.w[2])))
      it.exact = it.near * (1 - smoothstep(0.06 * reach, 0.2 * reach, Math.hypot(pose.w[0] - drawn.w[0], pose.w[1] - drawn.w[1], pose.w[2] - drawn.w[2])))
    }
    // The arm takes the hand's picture of the gesture it has turned to once its hand is no longer the last one's.
    const worn = this.worn
    // Near hanging its hand is the one it hangs in, and wears that one's picture.
    const wears = this.oneLook && !this.aiming && this.hangs && g.motion.handTurned < 0.5 ? this.hangs : g
    if (!(this.oneLook || this.bustLook) || !worn || this.transit.idle) { this.worn = wears
}
    else if (wears !== g) {
      if (this.transit.left < 0.5) this.worn = wears
    }
    else if (worn !== g && worn.near <= 0.004 && handExactness(worn.bound.drawnHand, pose.hand, worn.bound.px, 2, 12) <= 0.004) { this.worn = g
}
    this.body = body
    const binding = this.bases.find((b) => b.secondaryDeformation?.arm)?.secondaryDeformation
    const rig = binding?.arm
    const k = rig ? rig.scale * stance.hanging : 0
    if (sway && rig && k > 0) {
      const left = binding.handwearSide === 'L'
      const swing = (left ? sway.armAngleL : sway.armAngleR) * k
      pose = swung(pose,
        swing,
        rig.elbow ? (left ? sway.forearmL : sway.forearmR) * k : 0,
        rig.wrist ? (left ? sway.handL : sway.handR) * k : 0)
      // Lower down it hangs off the swing as the drawn arm's cloth does, lagging and swinging on (its drape):
      // without, the arm swung about two thirds as far as the drawn one did.
      const drape = rig.drape ? (left ? sway.armDrapeL : sway.armDrapeR) * k - swing : 0
      if (drape !== 0) {
        const rest = g.bound.shape.rest
        pose = draped(pose, drape * armDrapeWeight(rig, rest.e[1]), drape * armDrapeWeight(rig, rest.w[1]))
      }
    }
    if (g.touch) {
      // Only an arm come to its gesture: aimed or on its way from elsewhere, the hand is not on the face.
      const held = this.aiming ? 0 : Math.min(1, Math.max(0, (g.motion.progress - 0.85) / 0.15)) * (1 - this.transit.left)
      const [fx, fy] = moved(g.touch)
      // To the face, from where the shoulder has gone (the chest carries the arm after this).
      const tx = (fx - mx) * held
      const ty = (fy - my) * held
      const move = (q: V3, f: number): V3 => [q[0] + tx * f, q[1] + ty * f, q[2]]
      pose = { s: pose.s, e: move(pose.e, 0.5), w: move(pose.w, 1), hand: pose.hand.map((q) => move(q, 1)) }
    }
    if (chest) {
      const turn = Math.atan2(chest.b, chest.a)
      const c = Math.cos(turn)
      const sn = Math.sin(turn)
      const carried = (q: V3): V3 => {
        const x = q[0] - a[0]
        const y = q[1] - a[1]
        return [a[0] + mx + x * c - y * sn, a[1] + my + x * sn + y * c, q[2]]
      }
      pose = { s: carried(pose.s), e: carried(pose.e), w: carried(pose.w), hand: pose.hand.map(carried) }
    }
    // (Before the body's lean: the cloth's vertices get it from the shader, as every layer's do.)
    for (const cloth of this.cloths) cloth.step(pose.s, pose.e, pose.w, 1 - this.restNear, Math.min(1 / 30, this.dt))
    // The body's lean and lift, which the figure's shader gives every layer after its own deformation: left out,
    // the arm stood upright beside a leaning body, its shoulder parting from the sleeve's.
    if (body) {
      const on = (q: V3) => arm3DOnBody(q, body)
      pose = { s: on(pose.s), e: on(pose.e), w: on(pose.w), hand: pose.hand.map(on) }
    }
    this.pose = pose
  }

  /** This frame's arm, for the view; null before the first lift. */
  frame(): { bound: Arm3DBound; frame: Arm3DFrame } | null {
    if (this.oneLook || this.bustLook) return this.worn ? this.frameOf(this.worn, this.presence) : null
    return this.shown ? this.frameOf(this.shown, this.presence * this.switched) : null
  }

  /** The arm in the picture of the gesture it just turned from, drawn under this frame's while that comes in; null else. */
  leavingFrame(): { bound: Arm3DBound; frame: Arm3DFrame } | null {
    return this.leaving && !this.oneLook && !this.bustLook ? this.frameOf(this.leaving.g, this.presence) : null
  }

  private frameOf(g: Gesture, presence: number): { bound: Arm3DBound; frame: Arm3DFrame } | null {
    const stance = this.stance
    if (!this.pose || !stance || presence <= 0) return null
    let also: Arm3DFrame['also']
    if (this.bustLook) {
      if (this.cuff !== null) g.bound.shape.cuff = this.cuff
      // Its sleeve this frame: its gestures' by their shares, hanging the leading one's.
      const lead = this.rests ? this.gestures.indexOf(this.rests) : -1
      const hung = lead >= 0 ? smoothstep(0.55, 0.995, stance.hanging) : 0
      const wears = this.gestures.map((it) => it.own)
      const shown = Math.max(0, this.gestures.indexOf(this.shown ?? g))
      const wear = arm3DMixedWear(wears, this.wear, shown, lead, hung)
      Object.assign(g.bound.shape, { radius: wear.radius, restEnd: wear.restEnd })
      g.bound.ink = wear.ink
      const drawn = arm3DWearDrawn(this.wear, this.gestures.indexOf(g), lead, hung)
      also = [{ bound: (drawn.other ? this.gestures[drawn.other[0]] : g).bound, weight: drawn.other ? drawn.other[1] : 0 }, { bound: (this.rests ?? g).bound, weight: drawn.lead }]
      if (also.every((a) => a.weight <= 0)) also = undefined
    }
    const pts = this.foot.map((f) => [f.layer.deformed[f.i * 2], f.layer.deformed[f.i * 2 + 1]] as [number, number]).sort((a, b) => a[0] - b[0])
    const foot = pts.length <= 16 ? pts : Array.from({ length: 16 }, (_, k) => pts[Math.round(k * (pts.length - 1) / 15)])
    const side = (on: Followed[], sign: number) => (on.length ? sign * Math.max(...on.map((f) => sign * f.layer.deformed[f.i * 2])) : sign * Infinity)
    const sides: [number, number] = [side(this.sides[0], -1), side(this.sides[1], 1)]
    // Gone soon as it lifts: a still copy of the hanging arm beside the moving one.
    const to = this.restWhole > 0.85 && !this.oneLook ? affineFit(g.bound.restArm.at, armPoints(this.pose)) : null
    const [x, y, w, h] = g.bound.restArm.rect
    const rest = to && { corners: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].flatMap(([cx, cy]) => [to[0] * cx + to[1] * cy + to[2], to[3] * cx + to[4] * cy + to[5]]), alpha: smoothstep(0.85, 1, this.restWhole) * (this.oneLook ? smoothstep(0.55, 1, this.restStayed) : 1) }
    // The portrait's own hand comes onto a hand turning into it over the middle of the turn only: half on, the
    // lines of its curled fingers lay across the back of an open hand for as long as the arm took to fall.
    const handRest = this.oneLook ? smoothstep(0.3, 0.7, stance.handRest) : stance.handRest
    return { bound: g.bound, frame: { pose: this.pose, presence, handRest, hanging: stance.hanging, restNear: this.restNear, unlined: this.unlined, view: this.canvas, foot, sides, held: this.heldMesh(g), rest, ...(also ? { also } : {}) } }
  }

  /** The gesture layer's mesh where the figure draws it this frame, for its drawn upper arm under the arm held there. */
  private heldMesh(g: Gesture): Arm3DFrame['held'] {
    if (g.near <= 0.004) return undefined
    const { rest, deformed, indices, source } = g.layer
    const n = rest.length / 2
    const pos = new Float32Array(n * 2)
    const uv = new Float32Array(n * 2)
    for (let i = 0; i < n; i += 1) {
      const q = this.body ? arm3DOnBody([deformed[i * 2], deformed[i * 2 + 1], 0], this.body) : [deformed[i * 2], deformed[i * 2 + 1]]
      pos[i * 2] = q[0]
      pos[i * 2 + 1] = q[1]
      uv[i * 2] = (rest[i * 2] - source.x) / source.w
      uv[i * 2 + 1] = (rest[i * 2 + 1] - source.y) / source.h
    }
    return { pos, uv, idx: indices, near: g.near, exact: g.exact, toDrawn: affineFit(pos, rest) }
  }

  dispose(): void {
    for (const layer of this.given) {
      if (this.gestures.some((g) => g.layer === layer)) continue
      layer.follows = false
      if (layer.ownTexture) {
        this.view.releaseTexture(layer.ownTexture.texture)
        layer.ownTexture = null
      }
    }
    this.given = []
    for (const g of this.gestures) {
      this.view.release(g.bound)
      g.layer.follows = false
      if (g.layer.ownTexture) {
        this.view.releaseTexture(g.layer.ownTexture.texture)
        g.layer.ownTexture = null
      }
    }
    for (const base of this.bases) base.followers = undefined
    for (const cloth of this.cloths) cloth.dispose()
    this.cloths = []
  }
}

/** The figure's whole-body motion this frame, as its shader applies it to every layer. */
export type Arm3DBodyFrame = Pick<Anime25DRenderFrame, 'bodyPivotX' | 'bodyPivotY' | 'bodyRotationCosine' | 'bodyRotationSine' | 'bodyBendHeight' | 'bodyLift'>

/** `q` as the figure's shader moves a layer's point: leaned about the pivot (the torso bending into it), then lifted. */
export function arm3DOnBody(q: V3, body: Arm3DBodyFrame): V3 {
  const x = q[0] - body.bodyPivotX
  const y = q[1] - body.bodyPivotY
  let share = 1
  if (body.bodyBendHeight > 0) {
    const t = Math.max(0, Math.min(1, -y / body.bodyBendHeight))
    share = t * t * (3 - 2 * t)
  }
  const angle = Math.atan2(body.bodyRotationSine, body.bodyRotationCosine) * share
  const c = Math.cos(angle)
  const sn = Math.sin(angle)
  const point = { x: body.bodyPivotX + x * c - y * sn, y: body.bodyPivotY + x * sn + y * c }
  applyBodyLift(point, body.bodyLift)
  return [point.x, point.y, q[2]]
}

/** How long an arm has hung before the portrait's own arm is all there again (seconds). */
const STAYED = 0.3

/**
 * How far the sleeve's own line is still held off (1 hanging): let go over a fifth of a second from when the hand
 * starts to leave hanging, however fast it goes; back only as the hand comes back to hanging.
 */
export function sleeveLineHeldOff(previous: number, restNear: number, dt: number): number {
  return Math.max(smoothstep(0.85, 1, restNear), previous - dt / 0.2)
}

/**
 * The affine map taking each `from` point (x, y pairs) nearest its `to` point, least squares, as the rows
 * [a, b, c, d, e, f] of x' = a·x + b·y + c, y' = d·x + e·y + f; null when the points are all on one line.
 */
export function affineFit(from: ArrayLike<number>, to: ArrayLike<number>): [number, number, number, number, number, number] | null {
  const n = Math.min(from.length, to.length) >> 1
  let sxx = 0; let sxy = 0; let syy = 0; let sx = 0; let sy = 0
  let ux = 0; let uy = 0; let u1 = 0; let vx = 0; let vy = 0; let v1 = 0
  for (let i = 0; i < n; i += 1) {
    const x = from[i * 2]
    const y = from[i * 2 + 1]
    const u = to[i * 2]
    const v = to[i * 2 + 1]
    sxx += x * x; sxy += x * y; syy += y * y; sx += x; sy += y
    ux += u * x; uy += u * y; u1 += u; vx += v * x; vy += v * y; v1 += v
  }
  // Normal equations, [sxx sxy sx; sxy syy sy; sx sy n] · coefficients = right.
  const m = [sxx, sxy, sx, sxy, syy, sy, sx, sy, n]
  const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])
  if (Math.abs(det) < 1e-9) return null
  const solve = (r0: number, r1: number, r2: number): [number, number, number] => {
    const at = (c: number[]) => c[0] * (c[4] * c[8] - c[5] * c[7]) - c[1] * (c[3] * c[8] - c[5] * c[6]) + c[2] * (c[3] * c[7] - c[4] * c[6])
    return [
      at([r0, m[1], m[2], r1, m[4], m[5], r2, m[7], m[8]]) / det,
      at([m[0], r0, m[2], m[3], r1, m[5], m[6], r2, m[8]]) / det,
      at([m[0], m[1], r0, m[3], m[4], r1, m[6], m[7], r2]) / det,
    ]
  }
  return [...solve(ux, uy, u1), ...solve(vx, vy, v1)]
}
