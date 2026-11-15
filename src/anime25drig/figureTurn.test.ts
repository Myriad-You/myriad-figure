import assert from 'node:assert/strict'
import test from 'node:test'
import { FigureTurn, laggedTurn } from './figureTurn'

// A figure whose chest is at y = 300, hips at 600, legs 400 long.
const figure = () => new FigureTurn(300, 600, 400)
const FULL = 0.45

/** Plays a turn asked for at once and held, frame by frame as the player does: posed, its springs stepped, posed again to be drawn. */
function play(turn: FigureTurn, asked: number, seconds: number, fps = 60, each?: (turn: FigureTurn, frame: number) => void): void {
  for (let i = 0; i < seconds * fps; i += 1) {
    turn.step(asked)
    turn.follow(1 / fps, true)
    turn.step(asked)
    each?.(turn, i)
  }
}

test('a directed turn is led by the chest: the hips come after it, the hands after them, a hem last and furthest past; then all of it is where it was asked', () => {
  const turn = figure()
  play(turn, 0, 0.1)
  assert.equal(turn.active, false)
  const most = { hips: 0, arms: 0, hem: 0 }
  const caught = { hips: -1, arms: -1, hem: -1 }
  play(turn, FULL, 6, 60, (now, frame) => {
    // (The chest is where it is asked; the rest are behind it by their lags, then a little past.)
    const at = { hips: FULL + now.legLag, arms: FULL + now.armLag(600, 200), hem: FULL + now.trunkLag(720) }
    for (const part of ['hips', 'arms', 'hem'] as const) {
      if (caught[part] < 0 && at[part] >= FULL * 0.5) caught[part] = frame
      most[part] = Math.max(most[part], at[part] / FULL)
    }
    assert.equal(now.trunkLag(250), 0, 'the chest and what is above it lead')
    assert.ok(now.armLag(200, 200) === 0, 'an arm is its shoulder\'s at the shoulder')
  })
  assert.ok(caught.hips >= 3 && caught.arms > caught.hips && caught.hem > caught.arms, JSON.stringify(caught))
  assert.ok(most.hips > 1.03 && most.hips < 1.3, `the hips go a little past: ${most.hips}`)
  assert.ok(most.arms > most.hips && most.hem > most.arms && most.hem < 1.7, `the hands further, the hem furthest: ${JSON.stringify(most)}`)
  // Come to rest, nothing is behind: the figure is exactly the drawing of that angle it always was.
  assert.equal(turn.active, false)
  assert.equal(turn.legLag, 0)
  assert.equal(turn.trunkLag(720), 0)
  assert.equal(turn.hipsSpeed, 0)
  // Let go, it comes back the same way, and is exactly upright again.
  play(turn, 0, 0.15)
  assert.ok(turn.active && turn.legLag > 0.05, 'the hips still turned as the chest comes back')
  play(turn, 0, 6)
  assert.equal(turn.active, false)
})

test('down the trunk the lag grows: none at the chest, the hips\' at the hips, toward the hem\'s below', () => {
  const turn = figure()
  play(turn, 0, 0.1)
  play(turn, FULL, 0.1)
  assert.ok(turn.legLag < -0.05)
  assert.equal(turn.trunkLag(300), 0)
  assert.ok(turn.trunkLag(450) < 0 && turn.trunkLag(450) > turn.legLag)
  assert.equal(turn.trunkLag(600), turn.legLag)
  assert.ok(turn.trunkLag(720) < turn.legLag, 'a hem is further behind than the hips it hangs from')
  assert.equal(turn.trunkLag(720), turn.trunkLag(2000))
})

test('with no physics the whole body is where the turn is asked, at once; and every frame rate moves alike', () => {
  const held = figure()
  for (let i = 0; i < 30; i += 1) {
    held.step(FULL)
    held.follow(1 / 60, false)
    held.step(FULL)
    assert.equal(held.active, false)
  }
  const at = (fps: number) => {
    const turn = figure()
    play(turn, 0, 0.1, fps)
    play(turn, FULL, 0.2, fps)
    return turn.legLag
  }
  assert.ok(Math.abs(at(30) - at(120)) < 0.01, `${at(30)} ${at(120)}`)
})

test('a turn further round by a lag is the turn of the two angles together', () => {
  const out = { active: false, yawSine: 0, yawCosine: 1 }
  for (const [yaw, lag] of [[0.45, -0.3], [0, 0.2], [-0.4, 0.5]] as const) {
    laggedTurn({ yawSine: Math.sin(yaw), yawCosine: Math.cos(yaw) }, lag, out)
    assert.ok(out.active)
    assert.ok(Math.abs(out.yawSine - Math.sin(yaw + lag)) < 3e-3 && Math.abs(out.yawCosine - Math.cos(yaw + lag)) < 3e-3, `${yaw} ${lag}`)
  }
})
