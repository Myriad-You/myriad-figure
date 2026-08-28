import assert from 'node:assert/strict'
import test from 'node:test'
import { createAtlasTexture } from './webglRuntime'

test('uploads a packed character atlas through one WebGL texture allocation', () => {
  const calls = { create: 0, image: 0, parameters: 0 }
  const texture = {} as WebGLTexture
  const gl = {
    TEXTURE_2D: 1,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 2,
    TEXTURE_MIN_FILTER: 3,
    TEXTURE_MAG_FILTER: 4,
    TEXTURE_WRAP_S: 5,
    TEXTURE_WRAP_T: 6,
    LINEAR: 7,
    CLAMP_TO_EDGE: 8,
    RGBA: 9,
    UNSIGNED_BYTE: 10,
    createTexture() {
      calls.create += 1
      return texture
    },
    bindTexture() {},
    pixelStorei() {},
    texParameteri() {
      calls.parameters += 1
    },
    texImage2D() {
      calls.image += 1
    },
  } as unknown as WebGL2RenderingContext

  assert.equal(createAtlasTexture(gl, {} as HTMLImageElement), texture)
  assert.deepEqual(calls, { create: 1, image: 1, parameters: 4 })
})
