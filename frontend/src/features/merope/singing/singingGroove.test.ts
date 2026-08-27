import assert from 'node:assert/strict'
import test from 'node:test'
import {
  singingDriveAmount,
  SingingGrooveController,
  singingSpectrumDrive,
} from './singingGroove'

test('maps bass to beat and mids to vocal without letting kick own the voice', () => {
  const kick = singingSpectrumDrive([1, 0, 0, 0, 0, 0, 0, 0])
  assert.ok(kick.beat > 0.5)
  assert.equal(kick.vocal, 0)
  const voice = singingSpectrumDrive([0, 1, 1, 0.4, 0, 0, 0, 0])
  assert.ok(voice.vocal > 0.5)
  assert.ok(singingDriveAmount(voice) > 0.5)
})

test('a brief disable keeps the leaned pose instead of yanking back to center', () => {
  const controller = new SingingGrooveController()
  const drive = { bass: 0.4, beat: 0.4, vocal: 0.5 }
  let pose = controller.sample(0, true, drive)
  for (let step = 1; step <= 60 * 4; step += 1) {
    pose = controller.sample(step / 60, true, drive)
  }
  const leaned = { ...pose }
  assert.ok(Math.abs(leaned.angleZ) > 0.04)
  const held = { ...controller.sample(4 + 1 / 60, false, null) }
  assert.ok(Math.abs(held.angleZ) > Math.abs(leaned.angleZ) * 0.85)
  const resumed = { ...controller.sample(4 + 2 / 60, true, drive) }
  assert.ok(Math.abs(resumed.angleZ) > 0.03)
  assert.equal(Math.sign(resumed.angleZ), Math.sign(leaned.angleZ))
})

test('turning singing off eases the lean back instead of collapsing it', () => {
  const controller = new SingingGrooveController()
  const drive = { bass: 0.4, beat: 0.4, vocal: 0.5 }
  let pose = controller.sample(0, true, drive)
  for (let step = 1; step <= 60 * 5; step += 1) {
    pose = controller.sample(step / 60, true, drive)
  }
  const leaned = { ...pose }
  assert.ok(Math.abs(leaned.angleZ) > 0.04)

  const first = { ...controller.sample(5 + 1 / 60, false, null) }
  assert.ok(Math.abs(first.angleZ) > Math.abs(leaned.angleZ) * 0.9)

  let afterOne = first
  for (let step = 2; step <= 60; step += 1) {
    afterOne = { ...controller.sample(5 + step / 60, false, null) }
  }
  assert.ok(Math.abs(afterOne.angleZ) < Math.abs(leaned.angleZ))
  assert.ok(Math.abs(afterOne.angleZ) > Math.abs(leaned.angleZ) * 0.2)

  let afterFour = afterOne
  for (let step = 61; step <= 60 * 4; step += 1) {
    afterFour = { ...controller.sample(5 + step / 60, false, null) }
  }
  assert.ok(Math.abs(afterFour.angleZ) < 0.025)
})

test('weight keeps drifting both ways without parking', () => {
  const controller = new SingingGrooveController()
  const drive = { bass: 0.4, beat: 0.4, vocal: 0.5 }
  let minZ = 0
  let maxZ = 0
  let minBody = 0
  let maxBody = 0
  let longestStill = 0
  let stillRun = 0
  let previous = 0
  let previousDelta = 0
  let harshReversals = 0
  for (let step = 0; step <= 60 * 20; step += 1) {
    const pose = controller.sample(step / 60, true, drive)
    minZ = Math.min(minZ, pose.angleZ)
    maxZ = Math.max(maxZ, pose.angleZ)
    minBody = Math.min(minBody, pose.body)
    maxBody = Math.max(maxBody, pose.body)
    const delta = pose.angleZ - previous
    if (step > 90 && Math.abs(delta) < 0.00035) {
      stillRun += 1
      longestStill = Math.max(longestStill, stillRun)
    } else {
      stillRun = 0
    }
    if (
      step > 90 &&
      previousDelta !== 0 &&
      Math.sign(delta) !== 0 &&
      Math.sign(delta) !== Math.sign(previousDelta) &&
      Math.abs(delta) > 0.0028 &&
      Math.abs(previousDelta) > 0.0028
    ) {
      harshReversals += 1
    }
    previousDelta = delta
    previous = pose.angleZ
  }
  assert.ok(minZ < -0.04)
  assert.ok(maxZ > 0.04)
  assert.ok(minBody < -0.015)
  assert.ok(maxBody > 0.015)
  assert.ok(longestStill < 80)
  assert.equal(harshReversals, 0)
})
