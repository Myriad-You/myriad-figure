import assert from 'node:assert/strict'
import { test } from 'node:test'
import { armScoreAt } from './armScore'

const WAVE = { out: 0.5, up: 0.5, forward: 0.2, swivel: 0.1 }
const aimOf = (_side: 'L' | 'R', gesture: string) => (gesture === 'wave' ? WAVE : null)

test('a scored arm hangs before its first cue, is at a gesture as drawn once the move is over, and hangs again after', () => {
  const score = { bpm: 120, arms: [{ at: 1, side: 'L' as const, to: 'wave', over: 2 }, { at: 5, side: 'L' as const, to: null }] }
  assert.equal(armScoreAt(score, 0.2, aimOf).arms.L, null)
  assert.deepEqual(armScoreAt(score, 1.5, aimOf).arms.L, { ...WAVE, hand: 'wave' })
  assert.deepEqual(armScoreAt(score, 2.4, aimOf).arms.L, { ...WAVE, hand: 'wave' })
  assert.equal(armScoreAt(score, 3.1, aimOf).arms.L, null)
  assert.equal('R' in armScoreAt(score, 1.5, aimOf).arms, false)
})

test('a move goes on without a jump from frame to frame, swinging forward on its way', () => {
  const score = { bpm: 60, arms: [{ at: 0, side: 'both' as const, to: { out: 0.6, up: 0.4, forward: 0.1 }, over: 2 }] }
  let last = armScoreAt(score, 0, aimOf).arms.R!
  let furthest = 0
  for (let t = 1 / 60; t <= 2.2; t += 1 / 60) {
    const a = armScoreAt(score, t, aimOf).arms.R!
    assert.ok(Math.hypot(a.out - last.out, a.up - last.up, a.forward - last.forward) < 0.03)
    furthest = Math.max(furthest, a.forward)
    last = a
  }
  assert.ok(furthest > 0.15)
  assert.ok(Math.abs(last.forward - 0.1) < 1e-9)
  assert.deepEqual(armScoreAt(score, 1, aimOf).arms.L, armScoreAt(score, 1, aimOf).arms.R)
})

test('a move cut short hands on from where it had got to', () => {
  const score = { bpm: 60, arms: [{ at: 0, side: 'L' as const, to: 'wave', over: 2 }, { at: 1, side: 'L' as const, to: { out: 0.2, up: 0, forward: 0.6 }, over: 1 }] }
  const before = armScoreAt(score, 1 - 1e-6, aimOf).arms.L!
  const after = armScoreAt(score, 1 + 1e-6, aimOf).arms.L!
  assert.ok(Math.hypot(after.out - before.out, after.up - before.up, after.forward - before.forward) < 1e-3)
})

test('a cue to a gesture the side was not drawn with is passed over', () => {
  const score = { bpm: 60, arms: [{ at: 0, side: 'L' as const, to: 'wave' }, { at: 2, side: 'L' as const, to: 'chin' }] }
  assert.deepEqual(armScoreAt(score, 3.5, aimOf).arms.L, { ...WAVE, hand: 'wave' })
})

test('the body is driven to each cue in its beats and keeps what a later cue does not name', () => {
  const score = { bpm: 60, arms: [], body: [{ at: 0, over: 2, drive: { torsoTurn: 0.4, body: 0.5 } }, { at: 4, drive: { torsoTurn: -0.4 } }] }
  assert.deepEqual(armScoreAt(score, 3, aimOf).drive, { torsoTurn: 0.4, body: 0.5 })
  assert.ok(Math.abs(armScoreAt(score, 1, aimOf).drive.torsoTurn! - 0.2) < 1e-9)
  assert.deepEqual(armScoreAt(score, 6, aimOf).drive, { torsoTurn: -0.4, body: 0.5 })
})

test('an arm let down and raised again wears only the new gesture’s hand', () => {
  const score = { bpm: 60, arms: [{ at: 0, side: 'L' as const, to: 'wave' }, { at: 4, side: 'L' as const, to: null }, { at: 8, side: 'L' as const, to: 'chin' }] }
  const aim = () => ({ out: 0.3, up: 0.4, forward: 0.2 })
  assert.equal(armScoreAt(score, 6, aim).arms.L, null)
  assert.equal(armScoreAt(score, 8.2, aim).arms.L?.hand, 'chin')
})

test('a first cue that lets a hanging arm down leaves it hanging', () => {
  const score = { bpm: 60, arms: [{ at: 0, side: 'R' as const, to: null }] }
  assert.equal(armScoreAt(score, 0.5, () => null).arms.R, null)
  assert.deepEqual(armScoreAt(score, Number.NaN, () => null).arms, {})
})
