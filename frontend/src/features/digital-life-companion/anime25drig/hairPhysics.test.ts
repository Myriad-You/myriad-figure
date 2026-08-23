import assert from 'node:assert/strict'
import test from 'node:test'
import { frontHairUpperMotionScale } from './hairPhysics'

test('reduces only composite front-hair upper motion and preserves its lower locks', () => {
  const face = { y0: 170, y1: 658 }
  const composite = { y: 113, h: 774 }
  const compact = { y: 113, h: 630 }
  const at = (progress: number) => composite.y + composite.h * progress

  assert.equal(frontHairUpperMotionScale(at(0.3), composite, face), 0.25)
  assert.equal(frontHairUpperMotionScale(at(0.45), composite, face), 0.25)
  assert.ok(
    Math.abs(frontHairUpperMotionScale(at(0.6), composite, face) - 0.625) <
      1e-9,
  )
  assert.equal(frontHairUpperMotionScale(at(0.75), composite, face), 1)
  assert.equal(frontHairUpperMotionScale(at(0.3), compact, face), 1)
})
