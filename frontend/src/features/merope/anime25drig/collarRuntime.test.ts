import type { CollarClipMesh, CollarMotionPose } from './collarRuntime'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  deformCollarClipMesh,
  uploadCollarClipMesh,
} from './collarRuntime'

test('keeps collar CPU deformation separate from its GPU upload', () => {
  const rest = new Float32Array([80, 90, 120, 90, 84, 128, 116, 128])
  const clip: CollarClipMesh = {
    rest,
    deformed: rest.slice(),
    vao: {} as WebGLVertexArrayObject,
    vertexBuffer: {} as WebGLBuffer,
    uvBuffer: {} as WebGLBuffer,
    indexBuffer: {} as WebGLBuffer,
    indexCount: 6,
  }
  const pose: CollarMotionPose = {
    neckPivotX: 100,
    neckPivotY: 150,
    neckFollowTop: 82,
    neckFollowSpan: 70,
    faceCenterY: 92,
    faceScale: 0.82,
    angleX: 0.54,
    angleY: -0.37,
    headRotationCosine: Math.cos(0.13),
    headRotationSine: Math.sin(0.13),
    bodyBreathOffset: 1.1,
    headBreathOffset: 0.4,
  }
  let binds = 0
  let uploads = 0
  let uploaded: Float32Array | null = null
  const gl = {
    ARRAY_BUFFER: 1,
    bindBuffer() {
      binds += 1
    },
    bufferSubData(_target: number, _offset: number, data: Float32Array) {
      uploads += 1
      uploaded = data
    },
  } as unknown as WebGL2RenderingContext

  deformCollarClipMesh(clip, pose, 0.95)
  assert.notDeepEqual(clip.deformed, rest)
  assert.deepEqual({ binds, uploads }, { binds: 0, uploads: 0 })

  uploadCollarClipMesh(gl, clip)
  assert.deepEqual({ binds, uploads }, { binds: 1, uploads: 1 })
  assert.equal(uploaded, clip.deformed)
})
