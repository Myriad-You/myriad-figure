import type { V3 } from './arm3dMath'
import type { Arm3DMesh } from './arm3dMesh'
import type { Arm3DFrame, Arm3DPose, Arm3DShape } from './arm3dMotion'
import type { Arm3DPicture } from './arm3dPrepare'
import type { Arm3DTarget } from './arm3dTarget'
import { handExactness, len, similarity2D, smoothstep, sub } from './arm3dMath'
import { ARM3D_AROUND, ARM3D_ELBOW_CHART, ARM3D_RINGS, arm3DBareElbowRow, arm3DBareFromElbow, arm3DHandMesh, arm3DSleeveMesh, arm3DWristMesh } from './arm3dMesh'
import { liftForearm, wristOverUpper } from './arm3dMotion'
import { ARM3D_INK, bareBelowSleeve, clothCuffMouth, ringFill, spreadFill } from './arm3dPrepare'
import { BAKE_FS, BAKE_VS, COMPOSITE_FS, FULL_VS, GAP2_FS, GAP_FS, HAND_FS, HAND_VS, HELD_FS, HELD_VS, SLEEVE_FS, SLEEVE_VS, WHOLE_FS } from './arm3dShaders'
import { arm3DTexture, createArm3DTarget, dropArm3DTarget, setArm3DGround } from './arm3dTarget'

export type { Arm3DFrame } from './arm3dMotion'

const BAKE_W = 1024
const BAKE_H = 2048
// The elbow's own pieces' texture: they are a small part of the sleeve.
const ELBOW_SIZE = 512
/** A stencil bit of the figure's own buffer: the upper arm, where what the portrait draws over it stays in front. */
export const ARM3D_STENCIL = 16

/** One picture laid on the sleeve's texture: where the picture is, the pose it shows, and how much of the sleeve it may give. */
export interface Arm3DBakePass { src: WebGLTexture; rect: [number, number, number, number]; pose: Arm3DPose; rest: number; minFace: number; maskFrom: number; vmax: number; over?: { from: [number, number]; to: [number, number]; r: number }; inset?: number }

/** One gesture's arm, bound: its model, its textures and where its pictures lie on its meshes. */
export interface Arm3DBound {
  shape: Arm3DShape
  /** Document pixels to a trial pixel (a bust drawn 540 wide): the arm's drawn sizes (outlines, gaps) are in these. */
  px: number
  sleeve: WebGLTexture
  /** The sleeve with the gesture's own drawing where the portrait wears a band only while hanging (`restBand`). */
  lifted?: WebGLTexture
  hand: WebGLTexture
  /** The gesture's layer itself: seen through where it drew what the portrait has, so opaque where it drew the hand. */
  drawn: WebGLTexture
  /** The gesture's whole drawn hand, if its import kept one, and where it lies (offset, scale) on the gesture's layer. */
  full: WebGLTexture | null
  fullMap: [number, number, number, number]
  /** The drawn pose's place to the gesture layer's texture: u = (x - [0]) * [2], v = (y - [1]) * [3]. */
  drawnPic: [number, number, number, number]
  armMask: WebGLTexture
  /** Playback's own: how far round the elbow's rings turned last frame. */
  elbowTwist?: number
  /** A standing figure's: the arm layer about its shoulder where the portrait shows it (on the arm mask's rectangle). */
  cap?: WebGLTexture
  /** The arm mask's rectangle on the playback canvas, as a share of it. */
  maskRect: [number, number, number, number]
  /** Each hand vertex's place in the hand texture and how much of it to take (at the drawn pose). */
  handPic: Float32Array
  handWt: Float32Array
  /** The same for the wrist in the hand texture, raised, and in the arm mask, hanging. */
  wristPic: Float32Array
  wristWt: Float32Array
  wristHangPic: Float32Array
  wristHangWt: Float32Array
  /** A standing figure's: the hand in the arm mask as it hangs, where the portrait draws it (a bust's is off the picture). */
  handHangPic?: Float32Array
  handHangWt?: Float32Array
  /** Each sleeve vertex's place on the playback canvas (a share of it) as the arm hangs. */
  hangPic: Float32Array
  palm: Array<[number, number]> | null
  wristTone: [number, number, number]
  /** How dark the sleeve's outline is, of its cloth (`arm3DInk`); as ever (`ARM3D_INK`) where not given. */
  ink?: number
  /** A bust's: what its elbow's own pieces wear lifted, the gesture's drawing of the elbow laid out on them (`ARM3D_ELBOW_CHART`). */
  elbow?: WebGLTexture
  /** The drawn pose's hand, for how near the hand is to it. */
  drawnHand: V3[]
  /** The gesture's drawing of its upper arm and elbow alone (in the gesture layer's texture space), laid under the arm held there. Null (as the three below) for a bust, whose arm is the modelled one alone (its hand still wears the whole drawn hand, `full`). */
  held: WebGLTexture | null
  /** The same where the body under the drawn arm keeps the portrait's arm: laid on whether or not the sleeve covers it. */
  heldBeside: WebGLTexture | null
  /** The drawn forearm of a gesture holding it still, laid over the arm after its hand; null for a wave. */
  heldFore: WebGLTexture | null
  /** Its share where the portrait draws in front of its arm, laid on only as the arm is all but held where drawn. */
  heldForeFront: WebGLTexture | null
  /** Where the arm held is cut away (the drawing's own ground about its upper arm), on `rect` of the canvas; null when nowhere. */
  groundClip: { texture: WebGLTexture; rect: [number, number, number, number] } | null
  /** The portrait's arm as it hangs (its arm layers, on `rect` of the canvas), and the hanging arm's points there. */
  restArm: { texture: WebGLTexture; rect: [number, number, number, number]; at: number[] }
}

interface Program {
  program: WebGLProgram
  attributes: Map<string, number>
  uniforms: Map<string, WebGLUniformLocation | null>
}

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): Program {
  const program = gl.createProgram()
  for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'arm shader')
    gl.attachShader(program, shader)
    gl.deleteShader(shader)
  }
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'arm program')
  return { program, attributes: new Map(), uniforms: new Map() }
}

/**
 * Draws the modelled gesture arm into the figure's own WebGL context: into a
 * target of its own (antialiased, with depth), the gap shadow between the
 * fingers over it, then onto the figure.
 */
export class Arm3DView {
  private sleeveProgram: Program
  private handProgram: Program
  private bakeProgram: Program
  private gapProgram: Program
  private gap2Program: Program
  private compositeProgram: Program
  private heldProgram: Program
  private wholeProgram: Program
  private vao: WebGLVertexArrayObject
  private buffers = new Map<string, WebGLBuffer>()
  private target: Arm3DTarget | null = null

  constructor(private gl: WebGL2RenderingContext) {
    this.sleeveProgram = compile(gl, SLEEVE_VS, SLEEVE_FS)
    this.handProgram = compile(gl, HAND_VS, HAND_FS)
    this.bakeProgram = compile(gl, BAKE_VS, BAKE_FS)
    this.gapProgram = compile(gl, FULL_VS, GAP_FS)
    this.gap2Program = compile(gl, FULL_VS, GAP2_FS)
    this.compositeProgram = compile(gl, FULL_VS, COMPOSITE_FS)
    this.heldProgram = compile(gl, HELD_VS, HELD_FS)
    this.wholeProgram = compile(gl, FULL_VS, WHOLE_FS)
    this.vao = gl.createVertexArray()
  }

  dispose(): void {
    const gl = this.gl
    for (const p of [this.sleeveProgram, this.handProgram, this.bakeProgram, this.gapProgram, this.gap2Program, this.compositeProgram, this.heldProgram, this.wholeProgram]) gl.deleteProgram(p.program)
    for (const b of this.buffers.values()) gl.deleteBuffer(b)
    this.buffers.clear()
    gl.deleteVertexArray(this.vao)
    this.dropTarget()
  }

  release(bound: Arm3DBound): void {
    for (const t of [bound.sleeve, bound.lifted, bound.elbow, bound.hand, bound.drawn, bound.full, bound.armMask, bound.cap, bound.held, bound.heldBeside, bound.heldFore, bound.heldForeFront, bound.groundClip?.texture, bound.restArm.texture]) {
      if (t) this.gl.deleteTexture(t)
    }
  }

  releaseTexture(t: WebGLTexture): void {
    this.gl.deleteTexture(t)
  }

  private uniform(p: Program, name: string): WebGLUniformLocation | null {
    if (!p.uniforms.has(name)) p.uniforms.set(name, this.gl.getUniformLocation(p.program, name))
    return p.uniforms.get(name) ?? null
  }

  private attribute(p: Program, name: string): number {
    if (!p.attributes.has(name)) p.attributes.set(name, this.gl.getAttribLocation(p.program, name))
    return p.attributes.get(name)!
  }

  /** The mesh's attributes for `p` (named arrays, `size` floats each) and its indices; returns how many. */
  private upload(p: Program, attributes: Record<string, [ArrayLike<number>, number]>, idx: number[]): number {
    const gl = this.gl
    gl.bindVertexArray(this.vao)
    for (let i = 0; i < 8; i += 1) gl.disableVertexAttribArray(i)
    for (const [name, [data, size]] of Object.entries(attributes)) {
      const loc = this.attribute(p, name)
      if (loc < 0) continue
      let b = this.buffers.get(name)
      if (!b) {
        b = gl.createBuffer()
        this.buffers.set(name, b)
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, b)
      gl.bufferData(gl.ARRAY_BUFFER, data instanceof Float32Array ? data : new Float32Array(data), gl.DYNAMIC_DRAW)
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0)
    }
    let ib = this.buffers.get('idx')
    if (!ib) {
      ib = gl.createBuffer()
      this.buffers.set('idx', ib)
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.DYNAMIC_DRAW)
    return idx.length
  }

  /** A picture as a texture (straight colour). */
  picture(picture: Pick<Arm3DPicture, 'pixels' | 'width' | 'height'>, mip = true): WebGLTexture {
    return arm3DTexture(this.gl, picture.width, picture.height, picture.pixels, mip)
  }

  bakeSleeve(shape: Arm3DShape, px: number, view: { width: number; height: number }, passes: Arm3DBakePass[]): WebGLTexture {
    return this.bake(shape, px, view, passes, false).texture
  }

  /**
   * The texture a bust's elbow's own pieces wear (`ARM3D_ELBOW_CHART`), from the gesture's picture; none where the
   * picture shows next to nothing of the elbow (off its foot, or all under the forearm): a texture with nothing
   * written is black, and the elbow keeps the sleeve's own rows.
   */
  bakeElbow(shape: Arm3DShape, px: number, view: { width: number; height: number }, passes: Arm3DBakePass[]): WebGLTexture | undefined {
    const { texture, written } = this.bake(shape, px, view, passes, true)
    if (written >= 0.005 * ELBOW_SIZE * ELBOW_SIZE) return texture
    this.gl.deleteTexture(texture)
    return undefined
  }

  /**
   * The sleeve's one texture, made on the very mesh it is worn on: the portrait where it lies hanging (the
   * upper arm from the whole picture, its sleeve there may be drawn with the body; past it only the arm),
   * then the gesture's picture where it lies raised; first come, first kept. What none shows (the back, the
   * sides) takes the colour already on its ring. With `elbow`, the elbow's own pieces' texture instead, laid out as
   * `ARM3D_ELBOW_CHART` has them.
   */
  private bake(shape: Arm3DShape, px: number, view: { width: number; height: number }, passes: Arm3DBakePass[], elbow: boolean): { texture: WebGLTexture; written: number } {
    const gl = this.gl
    const p = this.bakeProgram
    const [W, H] = elbow ? [ELBOW_SIZE, ELBOW_SIZE] : [BAKE_W, BAKE_H]
    const out = arm3DTexture(gl, W, H, null, false)
    const fb = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out, 0)
    gl.viewport(0, 0, W, H)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.disable(gl.STENCIL_TEST)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE_MINUS_DST_ALPHA, gl.ONE)
    gl.useProgram(p.program)
    // As wide as the sleeve is drawn where that is wider than it is modelled: all of the drawing is its texture.
    const drawn = shape.drawnRadius ? { ...shape, radius: shape.drawnRadius } : shape
    for (const pass of passes) {
      const m = arm3DSleeveMesh(drawn, pass.pose, pass.rest, px)
      const pic: number[] = []
      for (let i = 0; i < m.pos.length / 3; i += 1) pic.push(m.pos[i * 3] / view.width, m.pos[i * 3 + 1] / view.height)
      // The two tubes only (the elbow's balls and the cuff's end have their own v); or the elbow's pieces by their own.
      const n = elbow
        ? this.upload(p, { aPos: [m.pos, 3], aNrm: [m.nrm, 3], aUv: [m.own ?? [], 2], aPic: [pic, 2] }, m.idx.slice(m.elbow ?? m.idx.length))
        : this.upload(p, { aPos: [m.pos, 3], aNrm: [m.nrm, 3], aUv: [m.uv, 2], aPic: [pic, 2] }, m.idx.slice(m.tubes ?? 0, (m.tubes ?? 0) + 2 * (ARM3D_RINGS / 2) * ARM3D_AROUND * 6))
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, pass.src)
      gl.uniform1i(this.uniform(p, 'uSrc'), 0)
      gl.uniform4fv(this.uniform(p, 'uRect'), pass.rect)
      gl.uniform1f(this.uniform(p, 'uMinFace'), pass.minFace)
      gl.uniform1f(this.uniform(p, 'uMaskFrom'), pass.maskFrom)
      gl.uniform1f(this.uniform(p, 'uVmax'), pass.vmax)
      gl.uniform4f(this.uniform(p, 'uOver'), pass.over?.from[0] ?? 0, pass.over?.from[1] ?? 0, pass.over?.to[0] ?? 0, pass.over?.to[1] ?? 0)
      gl.uniform1f(this.uniform(p, 'uOverR'), pass.over?.r ?? 0)
      gl.uniform2f(this.uniform(p, 'uView'), view.width, view.height)
      gl.uniform1f(this.uniform(p, 'uInset'), pass.inset ?? 0)
      // Under the forearm: the upper sleeve; of the elbow's pieces, what goes on past the elbow as the upper sleeve does.
      gl.uniform2f(this.uniform(p, 'uOverRows'), elbow ? ARM3D_ELBOW_CHART.past[0] - 0.01 : -10, elbow ? 10 : 0.5)
      gl.drawElements(gl.TRIANGLES, n, gl.UNSIGNED_INT, 0)
    }
    const px8 = new Uint8Array(W * H * 4)
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px8)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.deleteFramebuffer(fb)
    // About 11° round the ring in from where a picture saw the sleeve last: past the outline it draws there.
    let written = 0
    for (let at = 3; at < px8.length; at += 4) written += px8[at] > 0 ? 1 : 0
    if (elbow) spreadFill(px8, W, H)
    else ringFill(px8, W, H, W >> 5)
    if (!elbow && shape.restCuff !== undefined) clothCuffMouth(px8, W, H)
    if (!elbow && shape.shortSleeve !== undefined) bareBelowSleeve(px8, W, H, shape.shortSleeve, arm3DBareElbowRow(shape.shortSleeve), shape.skin, shape.shade)
    gl.bindTexture(gl.TEXTURE_2D, out)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, px8)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    // Seen slanting round the sleeve's sides the texture is squeezed one way only; a plain mip blurred it both ways.
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic')
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)))
    gl.bindVertexArray(null)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    return { texture: out, written }
  }

  private dropTarget(): void {
    if (this.target) dropArm3DTarget(this.gl, this.target)
    this.target = null
  }

  private ensureTarget(width: number, height: number): Arm3DTarget {
    if (this.target && this.target.width === width && this.target.height === height) return this.target
    this.dropTarget()
    this.target = createArm3DTarget(this.gl, width, height)
    return this.target
  }

  /**
   * The arm into its own target and onto the figure's buffer (bound, `width` × `height`). Leaves the
   * figure's blending as it found it (premultiplied over), depth and culling off.
   */
  draw(bound: Arm3DBound, frame: Arm3DFrame, width: number, height: number): void {
    const gl = this.gl
    const t = this.ensureTarget(width, height)
    const px = bound.px
    const pose = liftForearm(bound.shape, frame.pose)
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.msaa)
    gl.viewport(0, 0, width, height)
    gl.clearColor(0, 0, 0, 0)
    gl.clearDepth(1)
    gl.clearStencil(0)
    gl.stencilMask(255)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT)
    gl.disable(gl.STENCIL_TEST)
    gl.disable(gl.SCISSOR_TEST)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    const line = bound.shape.line.map((c) => c / 255 * 0.85)
    if (frame.rest) this.drawHeld(bound, frame, bound.restArm.texture, frame.rest.alpha, { pos: frame.rest.corners, uv: [0, 0, 1, 0, 1, 1, 0, 1], idx: [0, 1, 2, 0, 2, 3] })
    this.drawSleeve(bound, pose, frame, px, line)
    if (bound.held && frame.held && frame.held.near > 0.004) this.drawHeld(bound, frame)
    const hand = this.drawHand(bound, pose, frame, px, line)
    if (bound.heldFore && frame.held && frame.held.near > 0.004) {
      // Wherever the modelled hand is not (its stencil): the drawn heel of the hand where the model's palm falls
      // short of it too, which a cut-out of the drawn hand left open on the body under it.
      gl.enable(gl.STENCIL_TEST)
      gl.stencilFunc(gl.NOTEQUAL, 1, 255)
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP)
      this.drawHeld(bound, frame, bound.heldFore)
      if (bound.heldForeFront && frame.held.exact > 0.004) this.drawHeld(bound, frame, bound.heldForeFront, frame.held.exact)
      gl.disable(gl.STENCIL_TEST)
    }
    // Held as drawn, the whole drawn hand wherever the modelled one is not.
    gl.enable(gl.STENCIL_TEST)
    gl.stencilFunc(gl.NOTEQUAL, 1, 255)
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP)
    gl.disable(gl.DEPTH_TEST)
    this.drawWhole(bound, pose, frame, t, px, false)
    gl.disable(gl.STENCIL_TEST)
    gl.enable(gl.DEPTH_TEST)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.msaa)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.resolved)
    gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.drawGap(bound, pose, hand, frame, t, px)
    // Onto the figure.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, width, height)
    gl.disable(gl.SCISSOR_TEST)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    const c = this.compositeProgram
    gl.useProgram(c.program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, t.resolvedTexture)
    gl.uniform1i(this.uniform(c, 'uArm'), 0)
    gl.uniform2f(this.uniform(c, 'uPixel'), 1 / width, 1 / height)
    gl.uniform2f(this.uniform(c, 'uToView'), frame.view.width / width, frame.view.height / height)
    const feet = frame.foot.slice(0, 16)
    gl.uniform2fv(this.uniform(c, 'uFoot[0]'), feet.length ? feet.flat() : [0, 0])
    gl.uniform1i(this.uniform(c, 'uFeet'), feet.length)
    gl.uniform2f(this.uniform(c, 'uSides'), Math.max(-1e9, frame.sides[0]), Math.min(1e9, frame.sides[1]))
    gl.uniform1f(this.uniform(c, 'uAlpha'), frame.presence)
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
  }

  /** The sleeve as posed, its elbow turned the way it was last frame (afresh once the arm hangs). */
  private sleeveMesh(bound: Arm3DBound, pose: Arm3DPose, frame: Arm3DFrame, px: number): Arm3DMesh {
    const m = arm3DSleeveMesh(bound.shape, pose, frame.hanging, px, frame.hanging >= 1 ? undefined : bound.elbowTwist)
    bound.elbowTwist = m.twist
    return m
  }

  private drawSleeve(bound: Arm3DBound, pose: Arm3DPose, frame: Arm3DFrame, px: number, line: number[]): void {
    const gl = this.gl
    const p = this.sleeveProgram
    const m = this.sleeveMesh(bound, pose, frame, px)
    const n = m.pos.length / 3
    const pic = new Float32Array(n * 2)
    pic.set(bound.hangPic.subarray(0, Math.min(bound.hangPic.length, n * 2)))
    // Points the hanging sleeve has not (past the elbow, bent) take where they are now.
    for (let i = bound.hangPic.length / 2; i < n; i += 1) {
      pic[i * 2] = m.pos[i * 3] / frame.view.width
      pic[i * 2 + 1] = m.pos[i * 3 + 1] / frame.view.height
    }
    gl.useProgram(p.program)
    const count = this.upload(p, { aPos: [m.pos, 3], aNrm: [m.nrm, 3], aUv: [m.uv, 2], aPic: [pic, 2], aOwn: [m.own ?? new Float32Array(n * 2), 2] }, m.idx)
    this.common(p, frame, px)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, bound.sleeve)
    gl.uniform1i(this.uniform(p, 'uTex'), 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, bound.armMask)
    gl.uniform1i(this.uniform(p, 'uArmMask'), 1)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, bound.lifted ?? bound.sleeve)
    gl.uniform1i(this.uniform(p, 'uLifted'), 2)
    gl.activeTexture(gl.TEXTURE4)
    gl.bindTexture(gl.TEXTURE_2D, bound.cap ?? bound.armMask)
    gl.uniform1i(this.uniform(p, 'uCap'), 4)
    // (A bust's on its way between gestures: the others' drawings of the sleeve, by how much of each.)
    const also = frame.also ?? []
    for (let i = 0; i < 2; i += 1) {
      const other = also[i]?.bound ?? bound
      const tag = i === 0 ? 'B' : 'C'
      gl.activeTexture(gl.TEXTURE5 + i * 2)
      gl.bindTexture(gl.TEXTURE_2D, other.sleeve)
      gl.uniform1i(this.uniform(p, `uTex${tag}`), 5 + i * 2)
      gl.activeTexture(gl.TEXTURE6 + i * 2)
      gl.bindTexture(gl.TEXTURE_2D, other.lifted ?? other.sleeve)
      gl.uniform1i(this.uniform(p, `uLifted${tag}`), 6 + i * 2)
      const otherBand = other.lifted && other.shape.restBand
      gl.uniform3f(this.uniform(p, `uBand${tag}`), otherBand ? otherBand[0] : 0, otherBand ? otherBand[1] : 0, otherBand ? 1 : 0)
      gl.activeTexture(gl.TEXTURE10 + i)
      gl.bindTexture(gl.TEXTURE_2D, other.elbow ?? other.sleeve)
      gl.uniform1i(this.uniform(p, `uElbow${tag}`), 10 + i)
    }
    gl.activeTexture(gl.TEXTURE9)
    gl.bindTexture(gl.TEXTURE_2D, bound.elbow ?? bound.sleeve)
    gl.uniform1i(this.uniform(p, 'uElbow'), 9)
    gl.uniform1f(this.uniform(p, 'uElbowOn'), bound.elbow ? 1 : 0)
    gl.uniform2f(this.uniform(p, 'uAlso'), also[0]?.weight ?? 0, also[1]?.weight ?? 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.uniform4fv(this.uniform(p, 'uMaskRect'), bound.maskRect)
    gl.uniform1f(this.uniform(p, 'uRest'), frame.hanging)
    gl.uniform1f(this.uniform(p, 'uUnlined'), frame.unlined)
    // Lifting only the wrist, the forearm came out in front of the upper sleeve only near the hand: the sleeve
    // cut it off half way (b00 pointing with the left hand), where the drawing has it across the sleeve.
    const fold = wristOverUpper(bound.shape, pose)
    gl.uniform1f(this.uniform(p, 'uFold'), fold.over * fold.ru * 2.5)
    gl.uniform1f(this.uniform(p, 'uRestEnd'), bound.shape.restEnd)
    gl.uniform1f(this.uniform(p, 'uOpen'), arm3DBareFromElbow(bound.shape) ? 0.5 : 1)
    gl.uniform1f(this.uniform(p, 'uLined'), bound.shape.restCuff === undefined ? 0 : 1)
    const band = bound.lifted && bound.shape.restBand
    gl.uniform3f(this.uniform(p, 'uBand'), band ? band[0] : 0, band ? band[1] : 0, band ? 1 : 0)
    setArm3DGround(gl, (name) => this.uniform(p, name), bound.groundClip, frame.held, bound.armMask)
    gl.uniform1f(this.uniform(p, 'uFadeTop'), 0.26)
    gl.uniform3fv(this.uniform(p, 'uLine'), line)
    gl.uniform1f(this.uniform(p, 'uInk'), bound.ink ?? ARM3D_INK)
    // Its outline first (back faces pushed out), then itself.
    gl.enable(gl.CULL_FACE)
    gl.cullFace(gl.FRONT)
    gl.uniform1f(this.uniform(p, 'uPush'), 1.6 * px)
    gl.uniform4f(this.uniform(p, 'uSolid'), line[0], line[1], line[2], 2)
    gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, 0)
    gl.disable(gl.CULL_FACE)
    gl.uniform1f(this.uniform(p, 'uPush'), 0)
    gl.uniform4f(this.uniform(p, 'uSolid'), 0, 0, 0, 0)
    gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, 0)
  }

  /** The drawing laid on as held: over the sleeve and beside it, or (`only`) that one picture plainly over all. */
  private drawHeld(bound: Arm3DBound, frame: Arm3DFrame, only?: WebGLTexture, alpha = frame.held!.near, mesh?: { pos: ArrayLike<number>; uv: ArrayLike<number>; idx: ArrayLike<number> }): void {
    const { gl, heldProgram: p } = this
    const held = mesh ?? frame.held!
    gl.useProgram(p.program)
    const count = this.upload(p, { aPos: [held.pos, 2], aUv: [held.uv, 2] }, Array.from(held.idx))
    gl.uniform2f(this.uniform(p, 'uSize'), frame.view.width, frame.view.height)
    gl.activeTexture(gl.TEXTURE0)
    gl.uniform1i(this.uniform(p, 'uHeld'), 0)
    gl.uniform1f(this.uniform(p, 'uAlpha'), alpha)
    gl.disable(gl.DEPTH_TEST)
    if (only) {
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.bindTexture(gl.TEXTURE_2D, only)
      gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, 0)
      gl.enable(gl.DEPTH_TEST)
      return
    }
    gl.bindTexture(gl.TEXTURE_2D, bound.held)
    // Only over the sleeve already drawn, its coverage kept: past it the drawing's still copy of what lies beside
    // the arm (a collar, hair) stood over the figure's own, which moves.
    gl.blendFuncSeparate(gl.DST_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE)
    gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, 0)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.bindTexture(gl.TEXTURE_2D, bound.heldBeside)
    gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, 0)
    gl.enable(gl.DEPTH_TEST)
  }

  private common(p: Program, frame: Arm3DFrame, px: number): void {
    const gl = this.gl
    gl.uniform2f(this.uniform(p, 'uSize'), frame.view.width, frame.view.height)
    gl.uniform1f(this.uniform(p, 'uDepth'), 6000 * px)
    gl.uniform1f(this.uniform(p, 'uBack'), 0)
  }

  /** The wrist and hand, both outlines first, then both fills, so no outline crosses the heel. Returns the hand's mesh. */
  private drawHand(bound: Arm3DBound, pose: Arm3DPose, frame: Arm3DFrame, px: number, line: number[]): Arm3DMesh {
    const gl = this.gl
    const p = this.handProgram
    const d = bound.shape
    const hand = arm3DHandMesh(d, pose, bound.palm)
    const wrist = arm3DWristMesh(d, pose, frame.hanging)
    const n = hand.pos.length / 3
    const fits = bound.handPic.length === n * 2
    const wristFits = bound.wristPic.length === wrist.pos.length / 3 * 2 && bound.wristHangPic.length === bound.wristPic.length
    const hangs = fits && bound.handHangPic?.length === n * 2
    gl.useProgram(p.program)
    this.common(p, frame, px)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, bound.hand)
    gl.uniform1i(this.uniform(p, 'uHand'), 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, bound.armMask)
    gl.uniform1i(this.uniform(p, 'uHang'), 1)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, bound.drawn)
    gl.uniform1i(this.uniform(p, 'uDrawn'), 2)
    gl.activeTexture(gl.TEXTURE3)
    // (Without one, any texture: the program samples it and takes none of it.)
    gl.bindTexture(gl.TEXTURE_2D, bound.full ?? bound.hand)
    gl.uniform1i(this.uniform(p, 'uFull'), 3)
    gl.uniform4f(this.uniform(p, 'uFullMap'), ...bound.fullMap)
    gl.uniform1f(this.uniform(p, 'uHasFull'), bound.full ? 1 : 0)
    gl.uniform1f(this.uniform(p, 'uHanging'), frame.hanging)
    gl.uniform1f(this.uniform(p, 'uRestNear'), frame.restNear)
    gl.uniform1f(this.uniform(p, 'uHandHang'), hangs ? 1 : 0)
    gl.uniform1f(this.uniform(p, 'uHandRest'), frame.handRest)
    gl.uniform1f(this.uniform(p, 'uRestShown'), frame.rest?.alpha ?? 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.uniform1f(this.uniform(p, 'uExact'), handExactness(bound.drawnHand, pose.hand, px, 1, 4))
    gl.uniform1f(this.uniform(p, 'uNear'), handExactness(bound.drawnHand, pose.hand, px, 2, 12))
    gl.uniform3fv(this.uniform(p, 'uLit'), d.skin.map((c) => c / 255))
    gl.uniform3fv(this.uniform(p, 'uShade'), d.shade.map((c) => c / 255 * 0.97))
    gl.uniform3fv(this.uniform(p, 'uWristTone'), bound.wristTone)
    gl.uniform1f(this.uniform(p, 'uPlainWrist'), d.restCuff === undefined ? 0 : 1)
    // Only a forearm bare from the elbow: one in a sleeve stays inside its cuff.
    const fold = wristOverUpper(d, pose)
    gl.uniform1f(this.uniform(p, 'uFold'), arm3DBareFromElbow(d) ? fold.over * fold.ru * 2.5 : 0)
    gl.uniform1f(this.uniform(p, 'uAlpha'), 1)
    // The drawings line a hand thinly, in a warm shade of the skin: a full dark line makes each finger a tube.
    const skinLine = line.map((c, i) => c * 0.35 + d.shade[i] / 255 * 0.55)
    type Part = [Arm3DMesh, Float32Array | null, Float32Array | null, Float32Array | null, Float32Array | null]
    const parts: Part[] = [
      wristFits ? [wrist, bound.wristPic, bound.wristWt, bound.wristHangPic, bound.wristHangWt] : [wrist, null, null, null, null],
      [hand, fits ? bound.handPic : null, fits ? bound.handWt : null, hangs ? bound.handHangPic! : null, hangs ? bound.handHangWt! : null],
    ]
    const send = ([m, pic, wt, hangPic, hangWt]: Part) => {
      const k = m.pos.length / 3
      return this.upload(p, {
        aPos: [m.pos, 3],
        aNrm: [m.nrm, 3],
        aUv: [m.uv, 2],
        aPic: [pic ?? new Float32Array(k * 2), 2],
        aWt: [wt ?? new Float32Array(k), 1],
        aHangPic: [hangPic ?? new Float32Array(k * 2), 2],
        aHangWt: [hangWt ?? new Float32Array(k), 1],
        aAlong: [m.along ?? new Float32Array(k), 1],
        aFace: [m.face ?? new Float32Array(k), 1],
      }, m.idx)
    }
    gl.enable(gl.CULL_FACE)
    gl.cullFace(gl.FRONT)
    gl.uniform1f(this.uniform(p, 'uPush'), 1.6 * px * 0.6)
    gl.uniform4f(this.uniform(p, 'uSolid'), skinLine[0], skinLine[1], skinLine[2], 1)
    // Set back about a finger's thickness: where parts meet at much the same depth (a finger's root in the
    // palm's edge) the skin covers the outline; a finger well in front of the palm keeps its outline over it.
    gl.uniform1f(this.uniform(p, 'uBack'), len(sub(pose.hand[9], pose.hand[0])) * 0.1)
    // The hand (not its wrist) marks the stencil where it is drawn, for the drawn forearm laid over after it.
    const drawParts = () => {
      for (const part of parts) {
        if (part[0] === hand) {
          gl.enable(gl.STENCIL_TEST)
          gl.stencilFunc(gl.ALWAYS, 1, 255)
          gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE)
        }
        gl.drawElements(gl.TRIANGLES, send(part), gl.UNSIGNED_INT, 0)
        gl.disable(gl.STENCIL_TEST)
      }
    }
    drawParts()
    gl.uniform1f(this.uniform(p, 'uBack'), 0)
    gl.disable(gl.CULL_FACE)
    gl.uniform1f(this.uniform(p, 'uPush'), 0)
    gl.uniform4f(this.uniform(p, 'uSolid'), 0, 0, 0, 0)
    drawParts()
    return hand
  }

  /** The gap shadow and small holes, from the arm just drawn, within the hand's box. */
  private drawGap(bound: Arm3DBound, pose: Arm3DPose, hand: Arm3DMesh, frame: Arm3DFrame, t: Arm3DTarget, px: number): void {
    const gl = this.gl
    const d = bound.shape
    const toBuffer = t.width / frame.view.width
    const hs = len(sub(pose.hand[9], pose.hand[0]))
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (let i = 0; i < hand.pos.length; i += 3) {
      x0 = Math.min(x0, hand.pos[i])
      x1 = Math.max(x1, hand.pos[i])
      y0 = Math.min(y0, hand.pos[i + 1])
      y1 = Math.max(y1, hand.pos[i + 1])
    }
    const box = (pad: number): [number, number, number, number] | null => {
      const bx0 = Math.max(0, Math.floor((x0 - pad) * toBuffer))
      const bx1 = Math.min(t.width, Math.ceil((x1 + pad) * toBuffer))
      // Buffer rows count up from the bottom.
      const by0 = Math.max(0, Math.floor(t.height - (y1 + pad) * toBuffer))
      const by1 = Math.min(t.height, Math.ceil(t.height - (y0 - pad) * toBuffer))
      return bx1 > bx0 && by1 > by0 ? [bx0, by0, bx1 - bx0, by1 - by0] : null
    }
    const inner = box(hs * 0.4)
    const outer = box(hs * 0.4 + 14 * px)
    if (!inner || !outer) return
    const step: [number, number] = [px * toBuffer / t.width, px * toBuffer / t.height]
    const holeTone = d.shade.map((v, i) => (v * 0.7 + d.skin[i] * 0.3) / 255)
    const tone = d.shade.map((v, i) => (v * 0.55 + d.line[i] * 0.45) / 255)
    gl.disable(gl.BLEND)
    // The hand and wrist alone, solid: with the sleeve (a portrait's coat drawn over it) and the drawing laid on
    // the arm counted, a stretch of the body by the wrist they closed in was taken for a hole and filled with skin.
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.cover)
    gl.viewport(0, 0, t.width, t.height)
    gl.disable(gl.SCISSOR_TEST)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.SCISSOR_TEST)
    gl.scissor(...outer)
    const h = this.handProgram
    gl.useProgram(h.program)
    this.common(h, frame, px)
    gl.uniform1f(this.uniform(h, 'uPush'), 0)
    gl.uniform1f(this.uniform(h, 'uAlpha'), 1)
    gl.uniform1f(this.uniform(h, 'uExact'), 0)
    gl.uniform4f(this.uniform(h, 'uSolid'), 1, 1, 1, 1)
    for (const m of [arm3DWristMesh(d, pose, frame.hanging), hand]) {
      gl.drawElements(gl.TRIANGLES, this.upload(h, { aPos: [m.pos, 3], aNrm: [m.nrm, 3] }, m.idx), gl.UNSIGNED_INT, 0)
    }
    gl.uniform4f(this.uniform(h, 'uSolid'), 0, 0, 0, 0)
    // What the drawn hand laid under it fills is no hole or gap.
    this.drawWhole(bound, pose, frame, t, px, true)
    gl.bindVertexArray(this.vao)
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.mask)
    gl.viewport(0, 0, t.width, t.height)
    gl.disable(gl.SCISSOR_TEST)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.SCISSOR_TEST)
    gl.scissor(...outer)
    const g = this.gapProgram
    gl.useProgram(g.program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, t.resolvedTexture)
    gl.uniform1i(this.uniform(g, 'uSrc'), 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, t.coverTexture)
    gl.uniform1i(this.uniform(g, 'uCov'), 1)
    gl.activeTexture(gl.TEXTURE0)
    gl.uniform2f(this.uniform(g, 'uPixel'), 1 / t.width, 1 / t.height)
    gl.uniform2fv(this.uniform(g, 'uStep'), step)
    gl.uniform1f(this.uniform(g, 'uSigma'), Math.max(1.5, hs / px * 0.03))
    gl.uniform1f(this.uniform(g, 'uReach'), hs / px * 0.25)
    gl.uniform3fv(this.uniform(g, 'uHoleTone'), holeTone)
    gl.uniform3fv(this.uniform(g, 'uSkin'), d.skin.map((c) => c / 255))
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.resolved)
    gl.scissor(...inner)
    const g2 = this.gap2Program
    gl.useProgram(g2.program)
    gl.bindTexture(gl.TEXTURE_2D, t.maskTexture)
    gl.uniform1i(this.uniform(g2, 'uMask'), 0)
    gl.uniform2f(this.uniform(g2, 'uPixel'), 1 / t.width, 1 / t.height)
    gl.uniform2fv(this.uniform(g2, 'uStep'), step)
    gl.uniform3fv(this.uniform(g2, 'uTone'), tone)
    gl.uniform3fv(this.uniform(g2, 'uHoleTone'), holeTone)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.disable(gl.SCISSOR_TEST)
    gl.bindVertexArray(null)
  }

  /**
   * The whole drawn hand, held as drawn, where it lies now: into the bound target over what is drawn (the caller
   * keeps it off the modelled hand), or (`solid`) only where it lies, for the gap pass's cover.
   */
  private drawWhole(bound: Arm3DBound, pose: Arm3DPose, frame: Arm3DFrame, t: Arm3DTarget, px: number, solid: boolean): void {
    // In the drawn shape and where it was drawn (the elbow there, the hand near): the shape alone held the hanging
    // hand too, and the picture showed by it at rest where the figure's edge cuts the modelled hand off.
    const exact = bound.full ? handExactness(bound.drawnHand, pose.hand, px, 1, 4) * (frame.held?.near ?? 0) : 0
    if (exact <= 0) return
    const gl = this.gl
    // This frame's hand to the drawn one, as one turn, scale and shift.
    const was = bound.drawnHand
    const fit = similarity2D(pose.hand, was)
    if (!fit) return
    const p = this.wholeProgram
    gl.useProgram(p.program)
    gl.bindVertexArray(this.vao)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, bound.full)
    gl.uniform1i(this.uniform(p, 'uFull'), 1)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, bound.hand)
    gl.uniform1i(this.uniform(p, 'uHand'), 0)
    gl.uniform4f(this.uniform(p, 'uFullMap'), ...bound.fullMap)
    gl.uniform4f(this.uniform(p, 'uPicMap'), ...bound.drawnPic)
    gl.uniform2f(this.uniform(p, 'uToView'), frame.view.width / t.width, frame.view.height / t.height)
    gl.uniform1f(this.uniform(p, 'uRows'), t.height)
    gl.uniform3fv(this.uniform(p, 'uRow0'), fit[0])
    gl.uniform3fv(this.uniform(p, 'uRow1'), fit[1])
    gl.uniform1f(this.uniform(p, 'uExact'), exact)
    gl.uniform1f(this.uniform(p, 'uSolid'), solid ? 1 : 0)
    gl.uniform4f(this.uniform(p, 'uAxis'), was[0][0], was[0][1], was[9][0] - was[0][0], was[9][1] - was[0][1])
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  /**
   * Marks ARM3D_STENCIL in the figure's buffer (bound) where the upper arm is, less where the forearm or
   * hand crosses it: what the portrait draws over the upper arm (hair over the shoulder) stays in front there.
   * With `drawn`, instead of the upper arm, wherever `drawn` draws (called with the mark being written): a cloth
   * of the arm's own lies over all of it but what comes in front; and `over` draws what lies over those too.
   */
  markUpperArm(bound: Arm3DBound, frame: Arm3DFrame, drawn?: () => void, over?: () => void): void {
    const gl = this.gl
    const px = bound.px
    const pose = liftForearm(bound.shape, frame.pose)
    gl.enable(gl.STENCIL_TEST)
    gl.stencilMask(ARM3D_STENCIL)
    gl.clearStencil(0)
    gl.clear(gl.STENCIL_BUFFER_BIT)
    gl.colorMask(false, false, false, false)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE)
    if (drawn) {
      gl.stencilFunc(gl.ALWAYS, ARM3D_STENCIL, ARM3D_STENCIL)
      drawn()
    }
    const s = this.sleeveProgram
    gl.useProgram(s.program)
    this.common(s, frame, px)
    gl.uniform1f(this.uniform(s, 'uRest'), 0)
    gl.uniform1f(this.uniform(s, 'uFadeTop'), 0.0001)
    gl.uniform4f(this.uniform(s, 'uSolid'), 1, 1, 1, 1)
    // Cut as the sleeve is (the program's last cut and textures would stand otherwise, the hand's picture bound there).
    setArm3DGround(gl, (name) => this.uniform(s, name), bound.groundClip, frame.held, bound.armMask)
    const sleeve = this.sleeveMesh(bound, pose, frame, px)
    // What the sleeve gains past a bent elbow is the elbow's once raised, whichever rows it wears (the upper sleeve's,
    // by their v the upper arm's: the portrait's front layers came back over the elbow's point).
    const along = (lo: number, hi: number) => {
      const keep: number[] = []
      for (let i = 0; i < sleeve.idx.length; i += 3) {
        const v = i < (sleeve.gained ?? Infinity) || frame.hanging >= 1 ? sleeve.uv[sleeve.idx[i] * 2 + 1] : 0.5
        if (v >= lo && v < hi) keep.push(sleeve.idx[i], sleeve.idx[i + 1], sleeve.idx[i + 2])
      }
      return keep
    }
    const attrs = { aPos: [sleeve.pos, 3], aNrm: [sleeve.nrm, 3], aUv: [sleeve.uv, 2], aPic: [new Float32Array(sleeve.pos.length / 3 * 2), 2] } as Record<string, [ArrayLike<number>, number]>
    // While the upper arm lies where the portrait drew it hanging (as on the canvas: a body turning carries it off
    // too) the portrait covers it down to the elbow as it did hanging; the stretch above the elbow comes out in
    // front as the upper arm leaves. Early in the rise and late in the lowering only (by how far along it is):
    // hanging, the stretch is the portrait's own picture either way, and further up the portrait there is the arm
    // it drew hanging (its cuff, across the raised elbow).
    const at = bound.restArm.at
    const was = [at[2] - at[0], at[3] - at[1]]
    const moved = Math.hypot(pose.e[0] - pose.s[0] - was[0], pose.e[1] - pose.s[1] - was[1]) / Math.max(1e-6, Math.hypot(was[0], was[1]))
    const stays = (1 - smoothstep(0.08, 0.3, moved)) * smoothstep(0, 0.05, 1 - frame.hanging) * smoothstep(0.3, 0.6, frame.hanging)
    gl.stencilFunc(gl.ALWAYS, ARM3D_STENCIL, ARM3D_STENCIL)
    gl.uniform1f(this.uniform(s, 'uPush'), 2 * px)
    if (!drawn) gl.drawElements(gl.TRIANGLES, this.upload(s, attrs, along(-Infinity, 0.36 + 0.14 * stays)), gl.UNSIGNED_INT, 0)
    gl.stencilFunc(gl.ALWAYS, 0, ARM3D_STENCIL)
    gl.uniform1f(this.uniform(s, 'uPush'), 0)
    gl.drawElements(gl.TRIANGLES, this.upload(s, attrs, along(0.5, Infinity)), gl.UNSIGNED_INT, 0)
    const h = this.handProgram
    gl.useProgram(h.program)
    this.common(h, frame, px)
    gl.uniform1f(this.uniform(h, 'uPush'), px)
    gl.uniform1f(this.uniform(h, 'uAlpha'), 1)
    gl.uniform4f(this.uniform(h, 'uSolid'), 1, 1, 1, 1)
    for (const m of [arm3DWristMesh(bound.shape, pose, frame.hanging), arm3DHandMesh(bound.shape, pose, bound.palm)]) {
      gl.drawElements(gl.TRIANGLES, this.upload(h, { aPos: [m.pos, 3], aNrm: [m.nrm, 3] }, m.idx), gl.UNSIGNED_INT, 0)
    }
    if (over) {
      gl.bindVertexArray(null)
      gl.stencilFunc(gl.ALWAYS, ARM3D_STENCIL, ARM3D_STENCIL)
      over()
    }
    gl.colorMask(true, true, true, true)
    gl.stencilMask(0)
    gl.stencilFunc(gl.EQUAL, ARM3D_STENCIL, ARM3D_STENCIL)
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP)
    gl.bindVertexArray(null)
  }

  /** The stencil test markUpperArm left on, off again. */
  endUpperArm(): void {
    this.gl.disable(this.gl.STENCIL_TEST)
    this.gl.stencilMask(255)
  }
}
