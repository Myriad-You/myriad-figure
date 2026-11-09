import type { V3 } from './arm3dMath'
import type { Arm3DMesh } from './arm3dMesh'
import type { Arm3DPose, Arm3DShape } from './arm3dMotion'
import type { Arm3DPicture } from './arm3dPrepare'
import type { Arm3DTarget } from './arm3dTarget'
import { handExactness, len, similarity2D, smoothstep, sub } from './arm3dMath'
import { ARM3D_AROUND, ARM3D_RINGS, arm3DBareFromElbow, arm3DHandMesh, arm3DSleeveMesh, arm3DWristMesh } from './arm3dMesh'
import { ringFill } from './arm3dPrepare'
import { BAKE_FS, BAKE_VS, COMPOSITE_FS, FULL_VS, GAP2_FS, GAP_FS, HAND_FS, HAND_VS, HELD_FS, HELD_VS, SLEEVE_FS, SLEEVE_VS, WHOLE_FS } from './arm3dShaders'
import { arm3DTexture, createArm3DTarget, dropArm3DTarget } from './arm3dTarget'

/** The trial drew the figure 540 pixels wide; its pixel-sized measures (outlines, the gap's reach) scale from there. */
const TRIAL_WIDTH = 540
const BAKE_W = 1024
const BAKE_H = 2048
/** A stencil bit of the figure's own buffer: the upper arm, where what the portrait draws over it stays in front. */
export const ARM3D_STENCIL = 16

/** One gesture's arm, bound: its model, its textures and where its pictures lie on its meshes. */
export interface Arm3DBound {
  shape: Arm3DShape
  sleeve: WebGLTexture
  hand: WebGLTexture
  /** The gesture's layer itself: seen through where it drew what the portrait has, so opaque where it drew the hand. */
  drawn: WebGLTexture
  /** The gesture's whole drawn hand, if its import kept one, and where it lies (offset, scale) on the gesture's layer. */
  full: WebGLTexture | null
  fullMap: [number, number, number, number]
  /** The drawn pose's place to the gesture layer's texture: u = (x - [0]) * [2], v = (y - [1]) * [3]. */
  drawnPic: [number, number, number, number]
  armMask: WebGLTexture
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
  /** Each sleeve vertex's place on the playback canvas (a share of it) as the arm hangs. */
  hangPic: Float32Array
  palm: Array<[number, number]> | null
  wristTone: [number, number, number]
  /** The drawn pose's hand, for how near the hand is to it. */
  drawnHand: V3[]
  /** The gesture's drawing of its upper arm and elbow alone (in the gesture layer's texture space), laid under the arm held there. */
  held: WebGLTexture
  /** The same where the body under the drawn arm keeps the portrait's arm: laid on whether or not the sleeve covers it. */
  heldBeside: WebGLTexture
  /** The drawn forearm of a gesture holding it still, laid over the arm after its hand; null for a wave. */
  heldFore: WebGLTexture | null
}

interface Program {
  program: WebGLProgram
  attributes: Map<string, number>
  uniforms: Map<string, WebGLUniformLocation | null>
}

export interface Arm3DFrame {
  pose: Arm3DPose
  hanging: number
  /** 1 with the arm where it hangs (its wrist), 0 once well away from it. */
  restNear: number
  view: { width: number; height: number }
  /** The picture's foot on the playback canvas, left to right: nothing of the arm below it. */
  foot: Array<[number, number]>
  /** The picture's left and right edges where they cut it (±Infinity where not): nothing of the arm past them. */
  sides: [number, number]
  /** The gesture layer's mesh as drawn this frame (canvas), its texture places, and how near the arm is held to the drawing. */
  held?: { pos: Float32Array; uv: Float32Array; idx: ArrayLike<number>; near: number }
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
    for (const t of [bound.sleeve, bound.hand, bound.drawn, bound.full, bound.armMask, bound.held, bound.heldBeside, bound.heldFore]) {
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

  /**
   * The sleeve's one texture, made on the very mesh it is worn on: the portrait where it lies hanging (the
   * upper arm from the whole picture, its sleeve there may be drawn with the body; past it only the arm),
   * then the gesture's picture where it lies raised; first come, first kept. What none shows (the back, the
   * sides) takes the colour already on its ring.
   */
  bakeSleeve(shape: Arm3DShape, px: number, view: { width: number; height: number }, passes: Array<{ src: WebGLTexture; rect: [number, number, number, number]; pose: Arm3DPose; rest: number; minFace: number; maskFrom: number; vmax: number }>): WebGLTexture {
    const gl = this.gl
    const p = this.bakeProgram
    const out = arm3DTexture(gl, BAKE_W, BAKE_H, null, false)
    const fb = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out, 0)
    gl.viewport(0, 0, BAKE_W, BAKE_H)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.disable(gl.STENCIL_TEST)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE_MINUS_DST_ALPHA, gl.ONE)
    gl.useProgram(p.program)
    for (const pass of passes) {
      const m = arm3DSleeveMesh(shape, pass.pose, pass.rest, px)
      const pic: number[] = []
      for (let i = 0; i < m.pos.length / 3; i += 1) pic.push(m.pos[i * 3] / view.width, m.pos[i * 3 + 1] / view.height)
      // The two tubes only (the elbow's balls and the cuff's end have their own v).
      const n = this.upload(p, { aPos: [m.pos, 3], aNrm: [m.nrm, 3], aUv: [m.uv, 2], aPic: [pic, 2] }, m.idx.slice(0, 2 * (ARM3D_RINGS / 2) * ARM3D_AROUND * 6))
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, pass.src)
      gl.uniform1i(this.uniform(p, 'uSrc'), 0)
      gl.uniform4fv(this.uniform(p, 'uRect'), pass.rect)
      gl.uniform1f(this.uniform(p, 'uMinFace'), pass.minFace)
      gl.uniform1f(this.uniform(p, 'uMaskFrom'), pass.maskFrom)
      gl.uniform1f(this.uniform(p, 'uVmax'), pass.vmax)
      gl.drawElements(gl.TRIANGLES, n, gl.UNSIGNED_INT, 0)
    }
    const px8 = new Uint8Array(BAKE_W * BAKE_H * 4)
    gl.readPixels(0, 0, BAKE_W, BAKE_H, gl.RGBA, gl.UNSIGNED_BYTE, px8)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.deleteFramebuffer(fb)
    ringFill(px8, BAKE_W, BAKE_H)
    gl.bindTexture(gl.TEXTURE_2D, out)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, BAKE_W, BAKE_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, px8)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    // Seen slanting round the sleeve's sides the texture is squeezed one way only; a plain mip blurred it both ways.
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic')
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)))
    gl.bindVertexArray(null)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    return out
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
    const px = frame.view.width / TRIAL_WIDTH
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
    this.drawSleeve(bound, pose, frame, px, line)
    if (frame.held && frame.held.near > 0.004) this.drawHeld(bound, frame)
    const hand = this.drawHand(bound, pose, frame, px, line)
    if (bound.heldFore && frame.held && frame.held.near > 0.004) {
      // Wherever the modelled hand is not (its stencil): the drawn heel of the hand where the model's palm falls
      // short of it too, which a cut-out of the drawn hand left open on the body under it.
      gl.enable(gl.STENCIL_TEST)
      gl.stencilFunc(gl.NOTEQUAL, 1, 255)
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP)
      this.drawHeld(bound, frame, bound.heldFore)
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
    gl.uniform1f(this.uniform(c, 'uAlpha'), 1)
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
  }

  private drawSleeve(bound: Arm3DBound, pose: Arm3DPose, frame: Arm3DFrame, px: number, line: number[]): void {
    const gl = this.gl
    const p = this.sleeveProgram
    const m = arm3DSleeveMesh(bound.shape, pose, frame.hanging, px)
    const n = m.pos.length / 3
    const pic = new Float32Array(n * 2)
    pic.set(bound.hangPic.subarray(0, Math.min(bound.hangPic.length, n * 2)))
    // Points the hanging sleeve has not (past the elbow, bent) take where they are now.
    for (let i = bound.hangPic.length / 2; i < n; i += 1) {
      pic[i * 2] = m.pos[i * 3] / frame.view.width
      pic[i * 2 + 1] = m.pos[i * 3 + 1] / frame.view.height
    }
    gl.useProgram(p.program)
    const count = this.upload(p, { aPos: [m.pos, 3], aNrm: [m.nrm, 3], aUv: [m.uv, 2], aPic: [pic, 2] }, m.idx)
    this.common(p, frame, px)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, bound.sleeve)
    gl.uniform1i(this.uniform(p, 'uTex'), 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, bound.armMask)
    gl.uniform1i(this.uniform(p, 'uArmMask'), 1)
    gl.activeTexture(gl.TEXTURE0)
    gl.uniform4fv(this.uniform(p, 'uMaskRect'), bound.maskRect)
    gl.uniform1f(this.uniform(p, 'uRest'), frame.hanging)
    // Lifting only the wrist, the forearm came out in front of the upper sleeve only near the hand: the sleeve
    // cut it off half way (b00 pointing with the left hand), where the drawing has it across the sleeve.
    const fold = wristOverUpper(bound.shape, pose)
    gl.uniform1f(this.uniform(p, 'uFold'), fold.over * fold.ru * 2.5)
    gl.uniform1f(this.uniform(p, 'uRestEnd'), bound.shape.restEnd)
    gl.uniform1f(this.uniform(p, 'uOpen'), arm3DBareFromElbow(bound.shape) ? 0.5 : 1)
    gl.uniform1f(this.uniform(p, 'uFadeTop'), 0.26)
    gl.uniform1f(this.uniform(p, 'uTopSoft'), 0.03)
    gl.uniform3fv(this.uniform(p, 'uLine'), line)
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
  private drawHeld(bound: Arm3DBound, frame: Arm3DFrame, only?: WebGLTexture): void {
    const gl = this.gl
    const p = this.heldProgram
    const held = frame.held!
    gl.useProgram(p.program)
    const count = this.upload(p, { aPos: [held.pos, 2], aUv: [held.uv, 2] }, Array.from(held.idx))
    gl.uniform2f(this.uniform(p, 'uSize'), frame.view.width, frame.view.height)
    gl.activeTexture(gl.TEXTURE0)
    gl.uniform1i(this.uniform(p, 'uHeld'), 0)
    gl.uniform1f(this.uniform(p, 'uAlpha'), held.near)
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
    const wrist = arm3DWristMesh(d, pose)
    const n = hand.pos.length / 3
    const fits = bound.handPic.length === n * 2
    const wristFits = bound.wristPic.length === wrist.pos.length / 3 * 2 && bound.wristHangPic.length === bound.wristPic.length
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
    gl.bindTexture(gl.TEXTURE_2D, bound.full)
    gl.uniform1i(this.uniform(p, 'uFull'), 3)
    gl.uniform4f(this.uniform(p, 'uFullMap'), ...bound.fullMap)
    gl.uniform1f(this.uniform(p, 'uHasFull'), bound.full ? 1 : 0)
    gl.uniform1f(this.uniform(p, 'uHanging'), frame.hanging)
    gl.uniform1f(this.uniform(p, 'uRestNear'), frame.restNear)
    gl.activeTexture(gl.TEXTURE0)
    gl.uniform1f(this.uniform(p, 'uExact'), handExactness(bound.drawnHand, pose.hand, px, 1, 4))
    gl.uniform1f(this.uniform(p, 'uNear'), handExactness(bound.drawnHand, pose.hand, px, 2, 12))
    gl.uniform3fv(this.uniform(p, 'uLit'), d.skin.map((c) => c / 255))
    gl.uniform3fv(this.uniform(p, 'uShade'), d.shade.map((c) => c / 255 * 0.97))
    gl.uniform3fv(this.uniform(p, 'uWristTone'), bound.wristTone)
    // Only a forearm bare from the elbow: one in a sleeve stays inside its cuff.
    const fold = wristOverUpper(d, pose)
    gl.uniform1f(this.uniform(p, 'uFold'), arm3DBareFromElbow(d) ? fold.over * fold.ru * 2.5 : 0)
    gl.uniform1f(this.uniform(p, 'uAlpha'), 1)
    // The drawings line a hand thinly, in a warm shade of the skin: a full dark line makes each finger a tube.
    const skinLine = line.map((c, i) => c * 0.35 + d.shade[i] / 255 * 0.55)
    type Part = [Arm3DMesh, Float32Array | null, Float32Array | null, Float32Array | null, Float32Array | null]
    const parts: Part[] = [
      wristFits ? [wrist, bound.wristPic, bound.wristWt, bound.wristHangPic, bound.wristHangWt] : [wrist, null, null, null, null],
      [hand, fits ? bound.handPic : null, fits ? bound.handWt : null, null, null],
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
    for (const m of [arm3DWristMesh(d, pose), hand]) {
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
    const exact = bound.full ? handExactness(bound.drawnHand, pose.hand, px, 1, 4) : 0
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
   */
  markUpperArm(bound: Arm3DBound, frame: Arm3DFrame): void {
    const gl = this.gl
    const px = frame.view.width / TRIAL_WIDTH
    const pose = liftForearm(bound.shape, frame.pose)
    gl.enable(gl.STENCIL_TEST)
    gl.stencilMask(ARM3D_STENCIL)
    gl.clearStencil(0)
    gl.clear(gl.STENCIL_BUFFER_BIT)
    gl.colorMask(false, false, false, false)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE)
    const s = this.sleeveProgram
    gl.useProgram(s.program)
    this.common(s, frame, px)
    gl.uniform1f(this.uniform(s, 'uRest'), 0)
    gl.uniform1f(this.uniform(s, 'uFadeTop'), 0.0001)
    gl.uniform1f(this.uniform(s, 'uTopSoft'), 0.03)
    gl.uniform4f(this.uniform(s, 'uSolid'), 1, 1, 1, 1)
    const sleeve = arm3DSleeveMesh(bound.shape, pose, frame.hanging, px)
    const along = (lo: number, hi: number) => {
      const keep: number[] = []
      for (let i = 0; i < sleeve.idx.length; i += 3) {
        const v = sleeve.uv[sleeve.idx[i] * 2 + 1]
        if (v >= lo && v < hi) keep.push(sleeve.idx[i], sleeve.idx[i + 1], sleeve.idx[i + 2])
      }
      return keep
    }
    const attrs = { aPos: [sleeve.pos, 3], aNrm: [sleeve.nrm, 3], aUv: [sleeve.uv, 2], aPic: [new Float32Array(sleeve.pos.length / 3 * 2), 2] } as Record<string, [ArrayLike<number>, number]>
    gl.stencilFunc(gl.ALWAYS, ARM3D_STENCIL, ARM3D_STENCIL)
    gl.uniform1f(this.uniform(s, 'uPush'), 2 * px)
    gl.drawElements(gl.TRIANGLES, this.upload(s, attrs, along(-Infinity, 0.36)), gl.UNSIGNED_INT, 0)
    gl.stencilFunc(gl.ALWAYS, 0, ARM3D_STENCIL)
    gl.uniform1f(this.uniform(s, 'uPush'), 0)
    gl.drawElements(gl.TRIANGLES, this.upload(s, attrs, along(0.5, Infinity)), gl.UNSIGNED_INT, 0)
    const h = this.handProgram
    gl.useProgram(h.program)
    this.common(h, frame, px)
    gl.uniform1f(this.uniform(h, 'uPush'), px)
    gl.uniform1f(this.uniform(h, 'uAlpha'), 1)
    gl.uniform4f(this.uniform(h, 'uSolid'), 1, 1, 1, 1)
    for (const m of [arm3DWristMesh(bound.shape, pose), arm3DHandMesh(bound.shape, pose, bound.palm)]) {
      gl.drawElements(gl.TRIANGLES, this.upload(h, { aPos: [m.pos, 3], aNrm: [m.nrm, 3] }, m.idx), gl.UNSIGNED_INT, 0)
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

/** How far the wrist lies over the upper arm on screen (0–1), and the upper arm's radius there. */
function wristOverUpper(d: Arm3DShape, pose: Arm3DPose) {
  const se = sub(pose.e, pose.s)
  const l2 = se[0] * se[0] + se[1] * se[1]
  const t = Math.max(0, Math.min(1, ((pose.w[0] - pose.s[0]) * se[0] + (pose.w[1] - pose.s[1]) * se[1]) / Math.max(1e-6, l2)))
  const ru = d.radius[Math.round(t * (d.radius.length / 2 - 1))]
  const off = Math.hypot(pose.w[0] - (pose.s[0] + se[0] * t), pose.w[1] - (pose.s[1] + se[1] * t))
  return { se, t, ru, over: 1 - smoothstep(ru, ru * 1.5, off) }
}

/**
 * Folded back up over the upper arm, the forearm lies in front of it, as a bent arm's does: the pictures say
 * nothing of their depths there, and the upper sleeve came through the forearm and hand. Only where the
 * wrist is over the upper arm on screen, and only toward the viewer, so nothing moves on screen.
 */
function liftForearm(d: Arm3DShape, pose: Arm3DPose): Arm3DPose {
  const { se, t, ru, over } = wristOverUpper(d, pose)
  const lift = over * Math.max(0, ru * 1.1 - (pose.w[2] - (pose.s[2] + se[2] * t)))
  if (lift <= 0) return pose
  return { s: pose.s, e: pose.e, w: [pose.w[0], pose.w[1], pose.w[2] + lift], hand: pose.hand.map((q) => [q[0], q[1], q[2] + lift] as V3) }
}
