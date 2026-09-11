import assert from 'node:assert/strict'
import test from 'node:test'
import { bindAttachmentMesh, sampleAttachmentMesh } from './attachmentMesh'

test('samples the current final host geometry including later hair motion', () => {
  const rest = new Float32Array([0, 0, 10, 0, 0, 10])
  const mesh = {
    rest,
    deformed: rest.slice(),
    indices: new Uint16Array([0, 1, 2]),
  }
  const sample = bindAttachmentMesh(mesh, 2, 3)!
  assert.ok(sample)
  const point = { x: 0, y: 0 }
  sampleAttachmentMesh(sample, point)
  assert.deepEqual(point, { x: 2, y: 3 })
  for (let frame = 1; frame <= 3; frame++) {
    for (let i = 0; i < rest.length; i += 2) {
      mesh.deformed[i] = rest[i] + frame * 5
      mesh.deformed[i + 1] = rest[i + 1] - frame * 2
    }
    sampleAttachmentMesh(sample, point)
    assert.ok(Math.abs(point.x - (2 + frame * 5)) < 1e-6)
    assert.ok(Math.abs(point.y - (3 - frame * 2)) < 1e-6)
  }
  assert.equal(bindAttachmentMesh(mesh, 20, 20), null)
  assert.deepEqual([...rest], [0, 0, 10, 0, 0, 10])
})
