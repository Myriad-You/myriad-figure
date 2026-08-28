import assert from 'node:assert/strict'
import test from 'node:test'
import { createAtlasTexture, createIndexedDeformableMesh } from './webglRuntime'

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

test('keeps positions dynamic while uploading UVs and indices only once', () => {
  const uploads: Array<{ usage: number; bytes: number }> = []
  let nextBuffer = 0
  const gl = {
    ARRAY_BUFFER: 1,
    ELEMENT_ARRAY_BUFFER: 2,
    DYNAMIC_DRAW: 3,
    STATIC_DRAW: 4,
    FLOAT: 5,
    createVertexArray: () => ({ vao: true }),
    createBuffer: () => ({ id: (nextBuffer += 1) }),
    getAttribLocation: (_program: unknown, name: string) =>
      name === 'a_pos' ? 0 : 1,
    bindVertexArray() {},
    bindBuffer() {},
    bufferData(_target: number, data: ArrayBufferView, usage: number) {
      uploads.push({ usage, bytes: data.byteLength })
    },
    enableVertexAttribArray() {},
    vertexAttribPointer() {},
  } as unknown as WebGL2RenderingContext

  const mesh = createIndexedDeformableMesh(
    gl,
    {} as WebGLProgram,
    new Float32Array([0, 0, 1, 1]),
    new Float32Array([0, 0, 1, 1]),
    new Uint16Array([0, 1, 0]),
  )

  assert.ok(mesh.positionBuffer)
  assert.ok(mesh.uvBuffer)
  assert.deepEqual(uploads, [
    { usage: 3, bytes: 16 },
    { usage: 4, bytes: 16 },
    { usage: 4, bytes: 6 },
  ])
})
