import type { V3 } from './arm3dMath'
import type { Arm3DPose, Arm3DShape } from './arm3dMotion'
import type { Arm3DSourceLayer } from './arm3dPrepare'
import type { Arm3DBound, Arm3DFrame, Arm3DView } from './arm3dView'
import type { Anime25DGpuLayer } from './layerGpuBinding'
import type { Anime25DRenderFrame } from './renderer'
import type { Anime25DSecondaryDeformationFrame } from './secondaryDeformation'
import type { Anime25DArmModel } from './types'
import { smoothstep } from './arm3dMath'
import { arm3DHandMesh, arm3DPalmAsModelled, arm3DSleeveMesh, arm3DWristMesh } from './arm3dMesh'
import { Arm3DMotion, arm3DShape } from './arm3dMotion'
import { arm3DGroundClip, arm3DProject, arm3DWristTone, composeArm3DPicture, splitArm3DLayer } from './arm3dPrepare'
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
}

/** A standing figure's modelled arm comes in over its drawn one, and goes, in this long (seconds), where it hangs. */
const HANDOVER = 0.12

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
  private wanted: string | null = null
  private shoulder: Followed | null = null
  private foot: Followed[] = []
  /** The picture's sides where it is cut off (a bust's arm at its edge), followed; none where the figure ends inside. */
  private sides: [Followed[], Followed[]] = [[], []]
  /** What the portrait draws in front of the upper arm (hair over the shoulder), drawn again there. */
  front: Anime25DGpuLayer[] = []
  private pose: Arm3DPose | null = null
  private restNear = 1
  /** How far the sleeve's own line is still held off as the hand first lifts (1 hanging, gone over a moment). */
  private unlined = 1
  private time: number | null = null
  private dt = 0
  private heldNear = 0
  private heldExact = 0
  private body: Arm3DBodyFrame | undefined
  /**
   * How far the modelled arm is shown over the drawn one: a bust's always (its portrait's hand is off the picture,
   * and the two never quite matched where they handed over); a standing figure's (its hand drawn hanging) only
   * while it gestures, faded in and out where it hangs.
   */
  private presence = 1
  private lastTime: number | null = null

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

  bind(layers: readonly Anime25DGpuLayer[], gl: WebGL2RenderingContext, atlas: HTMLImageElement): void {
    const { view, bases, canvas } = this
    const bustPixel = trialPixel(canvas)
    const still = layers.filter((layer) => layer.source.role !== 'arm-variant' && !layer.source.fade)
    const arm = (layer: Anime25DGpuLayer) => layer.source.armVariant?.model
    const baseAt = Math.max(...bases.map((b) => layers.indexOf(b)))
    this.front = layers.filter((layer, i) => layer.source.role !== 'arm-variant' && layer.source.role !== 'arm-variant-hand' && layer.source.role !== 'handwear' && !this.pieces.includes(layer)
      && layer.source.role !== 'back-hair' && layer.renderKind === 'ordinary' && (i > baseAt || layer.source.role.includes('hair')))
    for (const layer of layers) {
      const model = arm(layer)
      if (layer.source.role !== 'arm-variant' || !model || layer.source.side !== bases[0]?.source.side) continue
      const pixels = readLayerPixels(atlas, layer.source)
      if (!pixels) continue
      const shape = arm3DShape(model, layer.source.x, layer.source.y)
      // A full body's arm gives its drawn sizes on its own scale; a bust's on its canvas's.
      const px = model.trialPixel ?? bustPixel
      const motion = new Arm3DMotion(shape, layer.source.armVariant!.gesture === 'wave')
      const hanging = motion.keyPose(0, shape.rest.s)
      const raised = motion.keyPose(1, shape.rest.s)
      // The portrait about its hanging arm, whole and its arm alone (the arm layers say where the arm is).
      const hangWrist = arm3DWristMesh(shape, hanging)
      // The drawn hand lies where the gesture drew it; the modelled one hangs from the portrait's shoulder.
      const palm = arm3DPalmAsModelled(raised.hand, model.palmOutline)
      // A standing figure's hangs where the portrait draws it: the picture about the arm takes it in too.
      const hangHand = shape.restHand ? arm3DHandMesh(shape, hanging, palm) : null
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      for (const pos of [arm3DSleeveMesh(shape, hanging, 1, px).pos, hangWrist.pos, ...(hangHand ? [hangHand.pos] : [])]) {
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
      for (let i = 0; i < whole.pixels.length; i += 4) armOnly.pixels.set([whole.pixels[i], whole.pixels[i + 1], whole.pixels[i + 2], armOnly.pixels[i + 3] < 128 ? 0 : 255], i)
      const size = { width: pixels.width, height: pixels.height }
      const atLayer = (from: readonly Anime25DGpuLayer[], blur = 0) => composeArm3DPicture(atlas, from.map(asSource), layer.source, size, blur).pixels
      const portraitHere = atLayer(still)
      const split = splitArm3DLayer(pixels, model, pixels.width / layer.source.w, {
        whole: portraitHere,
        arm: atLayer(bases),
        // About where the portrait's arm was: its rim, the gesture's arm drawn beside it on the ground, is not body.
        near: atLayer(bases, 4 * px * pixels.width / layer.source.w),
      })
      const toLayer = (x: number, y: number): [number, number] => [(x - layer.source.x) / layer.source.w * pixels.width, (y - layer.source.y) / layer.source.h * pixels.height]
      const share = (r: { x: number; y: number; w: number; h: number }): [number, number, number, number] => [r.x / canvas.width, r.y / canvas.height, r.w / canvas.width, r.h / canvas.height]
      const layerRect = share(layer.source)
      const wholeTexture = view.picture(whole, false)
      const armMask = view.picture(armOnly, true)
      const keyTexture = view.picture({ pixels: split.arm, width: pixels.width, height: pixels.height }, false)
      const sleeveFrom = (upTo: number) => view.bakeSleeve(shape, px, canvas, [
        { src: wholeTexture, rect: share(rect), pose: hanging, rest: 1, minFace: -0.05, maskFrom: 2, vmax: Math.min(shape.restEnd, upTo) },
        { src: armMask, rect: share(rect), pose: hanging, rest: 1, minFace: -0.05, maskFrom: 0, vmax: upTo },
        { src: keyTexture, rect: layerRect, pose: raised, rest: 0, minFace: 0.15, maskFrom: 0, vmax: 2 },
      ])
      const sleeveTexture = sleeveFrom(2)
      // Lifted, the portrait's sleeve stops short of a band the gestures all draw at the wrist instead.
      const lifted = shape.restBand ? sleeveFrom(shape.restBand[0]) : undefined
      gl.deleteTexture(wholeTexture)
      gl.deleteTexture(keyTexture)
      // A wave's forearm swings off the drawing; the others' is held where drawn.
      const alone = arm3DUpperArmAlone(pixels.pixels, portraitHere, atLayer(this.front), pixels.width, pixels.height, model, pixels.width / layer.source.w, split.portraitArm, layer.source.armVariant!.gesture !== 'wave')
      const held = view.picture({ pixels: alone.over, width: pixels.width, height: pixels.height })
      const heldBeside = view.picture({ pixels: alone.beside, width: pixels.width, height: pixels.height })
      const heldFore = alone.fore ? view.picture({ pixels: alone.fore, width: pixels.width, height: pixels.height }) : null
      const heldForeFront = alone.foreFront ? view.picture({ pixels: alone.foreFront, width: pixels.width, height: pixels.height }) : null
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
      const bound: Arm3DBound = {
        shape,
        px,
        sleeve: sleeveTexture,
        lifted,
        hand: view.picture({ pixels: split.hand, width: pixels.width, height: pixels.height }),
        drawn: view.picture(pixels),
        ...this.wholeHand(layers, layer, atlas),
        armMask,
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
        wristTone: arm3DWristTone(split.hand, pixels.width, pixels.height, shape, toLayer),
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
      this.gestures.push({ layer, gesture: layer.source.armVariant!.gesture, bound, motion, touch: this.touchOf(layers, shape) })
      layer.ownTexture = createBodyTexture(gl, split.body, pixels.width, pixels.height)
      layer.follows = true
    }
    const first = this.gestures[0]?.bound.shape
    const host = bases.reduce<Anime25DGpuLayer | null>((last, layer) => (!last || layers.indexOf(layer) > layers.indexOf(last) ? layer : last), null)
    if (host) host.followers = this.gestures.map((g) => g.layer)
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
    this.shown = this.gestures[0] ?? null
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

  /** What it shows or is raising now; null while down or going down. */
  raised(): string | null {
    return this.shown?.motion.wanted ? this.shown.gesture : null
  }

  /** Steps the arm to `time`: another gesture waits for this one to come down. Writes the layers' opacity. */
  applyOpacity(time: number): void {
    const shown = this.shown
    if (!shown) return
    this.dt = this.time === null ? 0 : Math.min(0.1, Math.max(0, time - this.time))
    this.time = time
    shown.motion.wanted = shown.gesture === this.wanted
    if (!shown.motion.wanted && this.wanted && shown.motion.resting) {
      this.shown = this.gestures.find((g) => g.gesture === this.wanted) ?? shown
    }
    const now = this.shown!
    // A standing figure's, its whole arm drawn hanging (its hand too, or not found sure enough).
    const handover = now.bound.shape.restFore !== undefined
    if (handover) {
      const dt = this.lastTime === null ? 0 : Math.min(1 / 30, Math.max(0, time - this.lastTime))
      const active = this.wanted !== null || !now.motion.resting
      this.presence = this.lastTime === null
        ? active ? 1 : 0
        : Math.min(1, Math.max(0, this.presence + (active ? 1 : -1) * dt / HANDOVER))
      // It sets off once wholly in, faded in over the drawn arm where that hangs.
      if (this.presence < 1) now.motion.wanted = false
    }
    this.lastTime = time
    now.motion.step(time)
    const own = !handover || this.presence >= 1
    for (const g of this.gestures) g.layer.frameOpacity = g === now && own ? 1 : 0
    // Coming in or going, the drawn arm stays whole under it: two half-shown arms darken.
    if (!own) return
    for (const base of this.bases) base.frameOpacity = 0
    for (const piece of this.pieces) piece.frameOpacity = 0
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
    let pose = g.motion.pose(anchor)
    const hang = g.motion.keyPose(0, anchor)
    const fore = g.bound.shape.fore
    this.restNear = 1 - smoothstep(0.03 * fore, 0.25 * fore, Math.hypot(pose.w[0] - hang.w[0], pose.w[1] - hang.w[1], pose.w[2] - hang.w[2]))
    // The sleeve's own line held off a moment as the hand first lifts, however fast: round, the sleeve is short of a
    // flared cuff's drawn mouth, and the step that leaves (a light seam) came out lined, a stroke across the body.
    // The portrait's arm kept under it that long instead stood beside a bending arm as a dark wedge.
    this.unlined = sleeveLineHeldOff(this.unlined, this.restNear, this.dt)
    // Held as drawn: its elbow where the gesture has it, its hand near (a wave swings the hand, not the elbow).
    const drawn = g.motion.restPose(anchor)
    const upper = g.bound.shape.upper
    this.heldNear = (1 - smoothstep(0.01 * upper, 0.05 * upper, Math.hypot(pose.e[0] - drawn.e[0], pose.e[1] - drawn.e[1], pose.e[2] - drawn.e[2])))
      * (1 - smoothstep(0.35 * fore, 0.6 * fore, Math.hypot(pose.w[0] - drawn.w[0], pose.w[1] - drawn.w[1], pose.w[2] - drawn.w[2])))
    this.heldExact = this.heldNear * (1 - smoothstep(0.06 * fore, 0.2 * fore, Math.hypot(pose.w[0] - drawn.w[0], pose.w[1] - drawn.w[1], pose.w[2] - drawn.w[2])))
    this.body = body
    const binding = this.bases.find((b) => b.secondaryDeformation?.arm)?.secondaryDeformation
    const rig = binding?.arm
    const k = rig ? rig.scale * g.motion.hanging : 0
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
      const held = Math.min(1, Math.max(0, (g.motion.progress - 0.85) / 0.15))
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
    const g = this.shown
    if (!g || !this.pose || this.presence <= 0) return null
    const pts = this.foot.map((f) => [f.layer.deformed[f.i * 2], f.layer.deformed[f.i * 2 + 1]] as [number, number]).sort((a, b) => a[0] - b[0])
    const foot = pts.length <= 16 ? pts : Array.from({ length: 16 }, (_, k) => pts[Math.round(k * (pts.length - 1) / 15)])
    const side = (on: Followed[], sign: number) => (on.length ? sign * Math.max(...on.map((f) => sign * f.layer.deformed[f.i * 2])) : sign * Infinity)
    const sides: [number, number] = [side(this.sides[0], -1), side(this.sides[1], 1)]
    // Gone soon as it lifts: a still copy of the hanging arm beside the moving one.
    const to = this.restNear > 0.85 ? affineFit(g.bound.restArm.at, armPoints(this.pose)) : null
    const [x, y, w, h] = g.bound.restArm.rect
    const rest = to && { corners: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].flatMap(([cx, cy]) => [to[0] * cx + to[1] * cy + to[2], to[3] * cx + to[4] * cy + to[5]]), alpha: smoothstep(0.85, 1, this.restNear) }
    return { bound: g.bound, frame: { pose: this.pose, presence: this.presence, handRest: g.motion.handRest, hanging: g.motion.hanging, restNear: this.restNear, unlined: this.unlined, view: this.canvas, foot, sides, held: this.heldMesh(g), rest } }
  }

  /** The gesture layer's mesh where the figure draws it this frame, for its drawn upper arm under the arm held there. */
  private heldMesh(g: Gesture): Arm3DFrame['held'] {
    if (this.heldNear <= 0.004) return undefined
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
    return { pos, uv, idx: indices, near: this.heldNear, exact: this.heldExact, toDrawn: affineFit(pos, rest) }
  }

  dispose(): void {
    for (const g of this.gestures) {
      this.view.release(g.bound)
      g.layer.follows = false
      if (g.layer.ownTexture) {
        this.view.releaseTexture(g.layer.ownTexture.texture)
        g.layer.ownTexture = null
      }
    }
    for (const base of this.bases) base.followers = undefined
  }
}

/**
 * The gesture as drawn (its layer over the portrait it leaves showing; layer pixels, `scale` to a model unit)
 * about its upper arm and elbow alone: not its forearm, which a wave swings away from the drawing. All of it
 * there, not only what was measured as arm: a dark sleeve drawn over the portrait's dark sleeve is not in the
 * arm's outline, and left out, the portrait's hanging cuff showed under the elbow. `front`, what the portrait
 * draws in front of the arm. `over` is laid over the sleeve; `beside` where the body under the drawn arm keeps the
 * portrait's own (`portraitArm`, its share there), which the sleeve does not quite cover: its hanging cuff showed
 * in bits about the raised elbow. `fore`, for a gesture whose forearm is held still (`still`), that forearm as
 * drawn on into the heel of its hand, laid over the arm after its hand wherever the modelled hand is not: the
 * modelled forearm and its sleeve's end are a tube's, the drawing's a cloth's (a kimono's slanting sleeve mouth).
 * `foreFront`, the same where the portrait draws in front of its arm, laid on only as the arm is all but held.
 */
export function arm3DUpperArmAlone(gesture: Uint8ClampedArray, portrait: Uint8ClampedArray, front: Uint8ClampedArray, w: number, h: number, model: Anime25DArmModel, scale: number, portraitArm: Float32Array, still = false): { over: Uint8ClampedArray; beside: Uint8ClampedArray; fore: Uint8ClampedArray | null; foreFront: Uint8ClampedArray | null } {
  const out = new Uint8ClampedArray(gesture.length)
  const beside = new Uint8ClampedArray(gesture.length)
  const fore = still ? new Uint8ClampedArray(gesture.length) : null
  const foreFront = still ? new Uint8ClampedArray(gesture.length) : null
  const { shoulder: s, elbow: e, wrist: wr } = model.raised
  const R = model.radius
  const half = R.length >> 1
  const upperR = 1.25 * Math.max(...R.slice(0, half + 1))
  const foreR = 1.1 * R.slice(half).reduce((a, b) => a + b, 0) / (R.length - half)
  // Out to its widest (a sleeve's mouth), not only its mean: the modelled one is as wide there.
  const foreWide = Math.max(foreR, 1.1 * Math.max(...R.slice(half)))
  const along = (x: number, y: number, a: readonly number[], b: readonly number[]) => {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / Math.max(1e-6, dx * dx + dy * dy)))
    return { t, d: Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t) }
  }
  for (let p = 0; p < w * h; p += 1) {
    const x = (p % w) / scale
    const y = Math.floor(p / w) / scale
    const up = along(x, y, s, e)
    const forearm = along(x, y, e, wr)
    const pastElbow = smoothstep(0.12, 0.25, forearm.t)
    const notFore = 1 - pastElbow * (1 - smoothstep(foreR * 0.9, foreR * 1.1, forearm.d))
    const keep = (1 - smoothstep(upperR * 0.9, upperR * 1.1, up.d)) * notFore
    const i = p * 4
    const k = gesture[i + 3] / 255
    const a = Math.max(k, portrait[i + 3] / 255)
    for (let c = 0; c < 3; c += 1) out[i + c] = beside[i + c] = gesture[i + c] * k + portrait[i + c] * (1 - k)
    // Not where the portrait draws in front of the arm (hair over the shoulder): that is drawn again over it as it
    // moves, and the drawing's still copy showed beside it, a grey smudge.
    out[i + 3] = a * keep * (1 - front[i + 3] / 255) * 255
    // Nothing beside the forearm either, however wide its drawn cuff: a wave swings it off the drawing.
    beside[i + 3] = portraitArm[p] * (1 - pastElbow) * (1 - front[i + 3] / 255) * 255
    if (fore) {
      for (let c = 0; c < 3; c += 1) fore[i + c] = out[i + c]
      const sleeve = 1 - smoothstep(foreWide * 1.15, foreWide * 1.35, forearm.d)
      const drawn = k * pastElbow * sleeve
      const before = drawn * (1 - front[i + 3] / 255)
      fore[i + 3] = before * 255
      // Where the portrait draws in front of its arm, apart: the modelled forearm is in front of that too (only the
      // upper arm has it drawn again over it), and left out, the tube showed across a chest drawn after the arm;
      // but laid on as soon as the arm comes near, the drawn forearm showed there faintly before the arm was in it.
      // Laid over `fore`, not added to it: as much of what `fore` left as makes the two the drawing's own (the soft
      // edges of what lies in front were short of it, a faint fringe).
      foreFront![i + 3] = before < 1 ? Math.min(1, (drawn - before) / (1 - before)) * 255 : 0
      for (let c = 0; c < 3; c += 1) foreFront![i + c] = out[i + c]
    }
  }
  return { over: out, beside, fore, foreFront }
}

/**
 * The points (layer, vertex) on the picture's left and right edges, as they rest, where the edge cuts the figure:
 * a side counts when what reaches it runs straight down it a good way (a tenth of `height`), not one point of a
 * figure ending inside the picture. Empty for a side not cut.
 */
export function arm3DCutSides(layers: ReadonlyArray<{ rest: ArrayLike<number> }>, height: number): [Array<[number, number]>, Array<[number, number]>] {
  const out: [Array<[number, number]>, Array<[number, number]>] = [[], []]
  for (const [k, sign] of [[0, -1], [1, 1]] as const) {
    let edge = -Infinity
    for (const layer of layers) {
      for (let i = 0; i < layer.rest.length; i += 2) edge = Math.max(edge, sign * layer.rest[i])
    }
    const on: Array<[number, number]> = []
    let top = Infinity
    let bottom = -Infinity
    layers.forEach((layer, l) => {
      for (let i = 0; i < layer.rest.length / 2; i += 1) {
        if (sign * layer.rest[i * 2] < edge - 0.5) continue
        on.push([l, i])
        top = Math.min(top, layer.rest[i * 2 + 1])
        bottom = Math.max(bottom, layer.rest[i * 2 + 1])
      }
    })
    if (bottom - top > 0.1 * height) out[k] = on
  }
  return out
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

/** `q` turned by `angle` about `c` in the picture's plane (as the drawn arms are turned), its depth kept. */
function turned(q: V3, c: V3, angle: number): V3 {
  const x = q[0] - c[0]
  const y = q[1] - c[1]
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [c[0] + x * cos - y * sin, c[1] + x * sin + y * cos, q[2]]
}

/** The pose with the hand turned about the wrist, then the forearm about the elbow, then the arm about the shoulder. */
function swung(pose: Arm3DPose, arm: number, forearm: number, hand: number): Arm3DPose {
  let { e, w } = pose
  let pts = pose.hand.map((q) => turned(q, w, hand))
  w = turned(w, e, forearm)
  pts = pts.map((q) => turned(q, pose.e, forearm))
  e = turned(e, pose.s, arm)
  w = turned(w, pose.s, arm)
  pts = pts.map((q) => turned(q, pose.s, arm))
  return { s: pose.s, e, w, hand: pts }
}

/** The arm turned on about the shoulder by its elbow's share, and its forearm on about the elbow by the wrist's beyond that. */
function draped(pose: Arm3DPose, atElbow: number, atWrist: number): Arm3DPose {
  const e = turned(pose.e, pose.s, atElbow)
  const hand = pose.hand.map((q) => turned(turned(q, pose.s, atElbow), e, atWrist - atElbow))
  return { s: pose.s, e, w: turned(turned(pose.w, pose.s, atElbow), e, atWrist - atElbow), hand }
}

/** The body the portrait's arm leaves bare, premultiplied as the atlas is. */
function createBodyTexture(gl: WebGL2RenderingContext, pixels: Uint8ClampedArray, width: number, height: number) {
  const texture = gl.createTexture()
  const data = new Uint8Array(pixels.length)
  for (let i = 0; i < data.length; i += 4) {
    const a = pixels[i + 3]
    for (let c = 0; c < 3; c += 1) data[i + c] = Math.round(pixels[i + c] * a / 255)
    data[i + 3] = a
  }
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1)
  return { texture, uv: [0, 0, 1, 1] as const }
}

/**
 * How far the sleeve's own line is still held off (1 hanging): let go over a fifth of a second from when the hand
 * starts to leave hanging, however fast it goes; back only as the hand comes back to hanging.
 */
export function sleeveLineHeldOff(previous: number, restNear: number, dt: number): number {
  return Math.max(smoothstep(0.85, 1, restNear), previous - dt / 0.2)
}

/** The arm's points (shoulder, elbow, wrist, hand) as x, y pairs on the canvas. */
function armPoints(pose: Arm3DPose): number[] {
  return [pose.s, pose.e, pose.w, ...pose.hand].flatMap((q) => [q[0], q[1]])
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
