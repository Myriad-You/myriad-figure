import assert from 'node:assert/strict'
import test from 'node:test'
import { arm3DDraped, arm3DDrapeOf, Arm3DDrapeTurn, turnArm3DDrape } from './arm3dDrape'

// A left arm (the picture's left: the body is to its right) hanging from (100, 100) to (100, 200), 10 thick.
const S = [100, 100]
const E = [100, 200]
//                              on the arm outward  the body  by the hand
const REST = Float32Array.from([100, 150, 60, 180, 160, 150, 80, 320])

test('cloth on the upper arm is what lies on the arm and outward of it, not the body or what hangs by the hand', () => {
  const drape = arm3DDrapeOf(REST, S, E, 10, -1)!
  assert.deepEqual([...drape.idx], [0, 1])
  assert.ok(drape.weight[0] > 0.9)
  assert.ok(Math.abs(drape.weight[1] - 1) < 1e-6)
  assert.ok(drape.free[1] > drape.free[0])
  assert.equal(arm3DDrapeOf(Float32Array.from([160, 150]), S, E, 10, -1), null)
})

test('cloth on a hanging arm leaves the layer exactly its own', () => {
  const cloth = arm3DDraped(arm3DDrapeOf(REST, S, E, 10, -1)!)
  const turn = new Arm3DDrapeTurn()
  const deformed = REST.slice()
  for (let i = 0; i < 30; i += 1) {
    turn.step([0, 1, 0], [0, 1, 0], -1, 1 / 60)
    assert.equal(turnArm3DDrape(cloth, deformed, S, turn), false)
  }
  assert.deepEqual([...deformed], [...REST])
})

test('cloth turns with the arm, the hem after it, and comes back to the layer\'s own', () => {
  const cloth = arm3DDraped(arm3DDrapeOf(REST, S, E, 10, -1)!)
  const turn = new Arm3DDrapeTurn()
  const deformed = REST.slice()
  // The arm out to the picture's left: the cloth is taken round, not thrown, and the hem comes after.
  for (let i = 0; i < 12; i += 1) turn.step([-1, 0, 0], [0, 1, 0], -1, 1 / 60)
  assert.ok(turn.with > 0.8)
  assert.ok(turn.hem < turn.with * 0.8)
  for (let i = 0; i < 240; i += 1) {
    turn.step([-1, 0, 0], [0, 1, 0], -1, 1 / 60)
    // A frame the layer is not deformed anew leaves what was written: it is not turned twice over.
    assert.equal(turnArm3DDrape(cloth, deformed, S, turn), true)
  }
  assert.ok(Math.abs(turn.hem - turn.with) < 1e-3)
  // What lay down the arm now lies out to the left of the shoulder.
  assert.ok(deformed[0] < 70 && deformed[1] < 130)
  assert.deepEqual([...deformed.slice(4)], [...REST.slice(4)])
  for (let i = 0; i < 600; i += 1) {
    turn.step([0, 1, 0], [0, 1, 0], -1, 1 / 60)
    turnArm3DDrape(cloth, deformed, S, turn)
  }
  assert.equal(turn.still, true)
  assert.deepEqual([...deformed], [...REST])
})

test('cloth on a layer deformed anew each frame is turned from that frame\'s vertices', () => {
  const cloth = arm3DDraped(arm3DDrapeOf(REST, S, E, 10, -1)!)
  const turn = new Arm3DDrapeTurn()
  const deformed = REST.slice()
  let x = 0
  for (let i = 0; i < 240; i += 1) {
    // The layer sways: each frame its own vertices again, a little aside.
    x = 3 * Math.sin(i / 10)
    for (let k = 0; k < REST.length; k += 2) {
      deformed[k] = REST[k] + x
      deformed[k + 1] = REST[k + 1]
    }
    turn.step([-1, 0, 0], [0, 1, 0], -1, 1 / 60)
    turnArm3DDrape(cloth, deformed, [S[0] + x, S[1]], turn)
  }
  // (100, 150) a quarter turn less what the cloth keeps back, about the shoulder where it now is.
  const a = cloth.drape.weight[0] * turn.with
  assert.ok(Math.abs(deformed[0] - (S[0] + x - 50 * Math.sin(a))) < 0.05)
  assert.ok(Math.abs(deformed[1] - (S[1] + 50 * Math.cos(a))) < 0.05)
})

test('cloth on the picture\'s right goes out to the right', () => {
  // The same arm on the other side: the body to its left.
  const rest = Float32Array.from([100, 150, 140, 180, 40, 150])
  const drape = arm3DDrapeOf(rest, S, E, 10, 1)!
  assert.deepEqual([...drape.idx], [0, 1])
  const cloth = arm3DDraped(drape)
  const turn = new Arm3DDrapeTurn()
  const deformed = rest.slice()
  for (let i = 0; i < 240; i += 1) {
    turn.step([1, 0, 0], [0, 1, 0], 1, 1 / 60)
    turnArm3DDrape(cloth, deformed, S, turn)
  }
  assert.ok(turn.with < -0.8)
  assert.ok(deformed[0] > 130 && deformed[1] < 130)
})

test('an arm raised by the side and let down by the front leaves its cloth as it was', () => {
  const cloth = arm3DDraped(arm3DDrapeOf(REST, S, E, 10, -1)!)
  const turn = new Arm3DDrapeTurn()
  const deformed = REST.slice()
  const go = (du: number[]): void => {
    turn.step(du, [0, 1, 0], -1, 1 / 60)
    turnArm3DDrape(cloth, deformed, S, turn)
  }
  // Up by the side to overhead,
  for (let i = 0; i <= 60; i += 1) go([-Math.sin(i / 60 * Math.PI), Math.cos(i / 60 * Math.PI), 0])
  assert.ok(turn.with > 1)
  // down by the front, a little to the body's side of the viewer,
  for (let i = 0; i <= 60; i += 1) go([0.02, -Math.cos(i / 60 * Math.PI), Math.sin(i / 60 * Math.PI)])
  // and hanging.
  for (let i = 0; i < 600; i += 1) go([0, 1, 0])
  assert.equal(turn.still, true)
  assert.deepEqual([...deformed], [...REST])
})

test('an arm overhead turns its cloth outward whichever side of upright it is', () => {
  for (const x of [-0.01, 0.01]) {
    const turn = new Arm3DDrapeTurn()
    for (let i = 0; i < 60; i += 1) turn.step([x, -1, 0], [0, 1, 0], -1, 1 / 60)
    assert.ok(turn.with > 1)
  }
})

test('cloth is not taken far toward the body', () => {
  const turn = new Arm3DDrapeTurn()
  for (let i = 0; i < 60; i += 1) turn.step([1, 0.2, 0], [0, 1, 0], -1, 1 / 60)
  assert.ok(turn.with < 0 && turn.with > -0.36)
})

test('an arm pointed at the viewer gives its cloth no turn', () => {
  const turn = new Arm3DDrapeTurn()
  for (let i = 0; i < 60; i += 1) turn.step([-0.05, 0.05, 0.99], [0, 1, 0], -1, 1 / 60)
  assert.equal(turn.with, 0)
})
