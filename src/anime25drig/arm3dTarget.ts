/** The modelled arm's own render target: antialiased colour with depth and stencil, and the textures it resolves to. */
export interface Arm3DTarget {
  width: number
  height: number
  msaa: WebGLFramebuffer
  color: WebGLRenderbuffer
  depth: WebGLRenderbuffer
  resolved: WebGLFramebuffer
  resolvedTexture: WebGLTexture
  mask: WebGLFramebuffer
  maskTexture: WebGLTexture
  /** The hand and its wrist alone: what closes a gap or a hole, not the sleeve or the drawing laid over the arm. */
  cover: WebGLFramebuffer
  coverTexture: WebGLTexture
}

export function arm3DTexture(gl: WebGL2RenderingContext, width: number, height: number, pixels: ArrayBufferView | null, mip: boolean, repeatS = false): WebGLTexture {
  const t = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, t)
  // Straight colour: the arm's shaders weigh it by its alpha themselves.
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1)
  if (mip) gl.generateMipmap(gl.TEXTURE_2D)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeatS ? gl.REPEAT : gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return t
}

export function createArm3DTarget(gl: WebGL2RenderingContext, width: number, height: number): Arm3DTarget {
  const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) as number)
  const color = gl.createRenderbuffer()
  gl.bindRenderbuffer(gl.RENDERBUFFER, color)
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, width, height)
  const depth = gl.createRenderbuffer()
  gl.bindRenderbuffer(gl.RENDERBUFFER, depth)
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH24_STENCIL8, width, height)
  gl.bindRenderbuffer(gl.RENDERBUFFER, null)
  const msaa = gl.createFramebuffer()
  gl.bindFramebuffer(gl.FRAMEBUFFER, msaa)
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color)
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, depth)
  const own = (filter: number): [WebGLFramebuffer, WebGLTexture] => {
    const t = arm3DTexture(gl, width, height, null, false)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    const fb = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0)
    return [fb, t]
  }
  const [resolved, resolvedTexture] = own(gl.LINEAR)
  const [mask, maskTexture] = own(gl.NEAREST)
  const [cover, coverTexture] = own(gl.LINEAR)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return { width, height, msaa, color, depth, resolved, resolvedTexture, mask, maskTexture, cover, coverTexture }
}

export function dropArm3DTarget(gl: WebGL2RenderingContext, t: Arm3DTarget): void {
  for (const fb of [t.msaa, t.resolved, t.mask, t.cover]) gl.deleteFramebuffer(fb)
  for (const rb of [t.color, t.depth]) gl.deleteRenderbuffer(rb)
  for (const tx of [t.resolvedTexture, t.maskTexture, t.coverTexture]) gl.deleteTexture(tx)
}

/**
 * The sleeve's cut over the drawing's ground (`clip`), held as near as `held` says, carried from this frame's
 * canvas back to the drawing; off without either (`blank` stands bound in its place).
 */
export function setArm3DGround(
  gl: WebGL2RenderingContext,
  at: (name: string) => WebGLUniformLocation | null,
  clip: { texture: WebGLTexture; rect: [number, number, number, number] } | null,
  held: { near: number; toDrawn: [number, number, number, number, number, number] | null } | undefined,
  blank: WebGLTexture,
): void {
  const toDrawn = clip && held?.toDrawn
  gl.uniform1f(at('uGroundOn'), toDrawn ? held!.near : 0)
  gl.activeTexture(gl.TEXTURE3)
  gl.bindTexture(gl.TEXTURE_2D, clip?.texture ?? blank)
  gl.uniform1i(at('uGround'), 3)
  gl.activeTexture(gl.TEXTURE0)
  gl.uniform4fv(at('uGroundRect'), clip?.rect ?? [0, 0, 1, 1])
  gl.uniform3f(at('uToDrawn0'), toDrawn ? toDrawn[0] : 1, toDrawn ? toDrawn[1] : 0, toDrawn ? toDrawn[2] : 0)
  gl.uniform3f(at('uToDrawn1'), toDrawn ? toDrawn[3] : 0, toDrawn ? toDrawn[4] : 1, toDrawn ? toDrawn[5] : 0)
}
