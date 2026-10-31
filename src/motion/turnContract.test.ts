import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// The figure's half of the site's realtime turn contract
// (Myriad: frontend/src/services/agent/realtimeTurn.contract.test.ts).
function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8')
}

test('a performance from an older turn generation is dropped', () => {
  assert.match(source('./performanceLifecycle.ts'), /acceptLiveMotionGeneration\(event\.generation\)/)
})

test('a performance plan already playing is not replayed', () => {
  assert.match(source('./performanceLifecycle.ts'), /activePlanKey/)
})

test('a cancelled speech releases its mouth lease', () => {
  assert.match(source('./speechLease.ts'), /release/)
})
