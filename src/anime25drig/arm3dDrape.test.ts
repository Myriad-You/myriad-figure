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
    turn.step([0, 1, 0], [0, 1, 0], 1 / 60)
    assert.equal(turnArm3DDrape(cloth, deformed, S, turn), false)
  }
  assert.deepEqual([...deformed], [...REST])
})

test('cloth turns with the arm, the hem after it, and comes back to the layer\'s own', () => {
  const cloth = arm3DDraped(arm3DDrapeOf(REST, S, E, 10, -1)!)
  const turn = new Arm3DDrapeTurn()
  const deformed = REST.slice()
  // The arm out to the picture's left.
  turn.step([-1, 0, 0], [0, 1, 0], 1 / 60)
  assert.ok(turn.with > 0.8)
  assert.ok(turn.hem < turn.with * 0.2)
  for (let i = 0; i < 240; i += 1) {
    turn.step([-1, 0, 0], [0, 1, 0], 1 / 60)
    // A frame the layer is not deformed anew leaves what was written: it is not turned twice over.
    assert.equal(turnArm3DDrape(cloth, deformed, S, turn), true)
  }
  assert.ok(Math.abs(turn.hem - turn.with) < 1e-3)
  // What lay down the arm now lies out to the left of the shoulder.
  assert.ok(deformed[0] < 70 && deformed[1] < 130)
  assert.deepEqual([...deformed.slice(4)], [...REST.slice(4)])
  for (let i = 0; i < 600; i += 1) {
    turn.step([0, 1, 0], [0, 1, 0], 1 / 60)
    turnArm3DDrape(cloth, deformed, S, turn)
  }
  assert.equal(turn.still, true)
  assert.deepEqual([...deformed], [...REST])
})

test('an arm pointed at the viewer gives its cloth no turn', () => {
  const turn = new Arm3DDrapeTurn()
  turn.step([-0.05, 0.05, 0.99], [0, 1, 0], 1 / 60)
  assert.equal(turn.with, 0)
})
