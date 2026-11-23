/** Uploads pixels into the bound texture as they are, not premultiplied again; the upload setting is put back whatever happens. */
export function uploadPixels(gl: WebGL2RenderingContext, width: number, height: number, pixels: ArrayBufferView | null): void {
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
  try {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  }
  finally {
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1)
  }
}

/** A texture of its own, bound and filled by `fill`; one that could not be filled is not left behind. */
export function createFilledTexture(gl: WebGL2RenderingContext, fill: () => void): WebGLTexture {
  const texture = gl.createTexture()
  if (!texture) throw new Error('texture not made')
  try {
    gl.bindTexture(gl.TEXTURE_2D, texture)
    fill()
    return texture
  }
  catch (error) {
    gl.deleteTexture(texture)
    throw error
  }
}

/** Already premultiplied pixels as a texture of their own, sampled smoothly and held at its edges. */
export function createPixelTexture(gl: WebGL2RenderingContext, width: number, height: number, pixels: Uint8Array): WebGLTexture {
  return createFilledTexture(gl, () => {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    uploadPixels(gl, width, height, pixels)
  })
}
