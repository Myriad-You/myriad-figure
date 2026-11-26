import assert from 'node:assert/strict'
import test from 'node:test'
import { IDENTITY_DRIVER } from '@myriad/figure-player'
import { bearingDriverPatch } from './performanceExpression'
import {
  speechArticulationDriverPatch,
  speechEnergyDriverPatch,
} from './speechDriver'

test('keeps authored energy separate from preview speech', () => {
  assert.deepEqual(speechEnergyDriverPatch(null), {
    jaw: 0,
    mouthWide: 0,
    mouthRound: 0,
    mouthNarrow: 0,
    mouthSeal: 0,
    talking: false,
  })
  assert.deepEqual(speechEnergyDriverPatch(1.4), {
    jaw: 1,
    mouthWide: 0,
    mouthRound: 0,
    mouthNarrow: 0,
    mouthSeal: 0,
    talking: false,
  })
  assert.deepEqual(speechEnergyDriverPatch(Number.NaN), {
    jaw: 0,
    mouthWide: 0,
    mouthRound: 0,
    mouthNarrow: 0,
    mouthSeal: 0,
    talking: false,
  })
})

test('maps authored visemes without enabling random speech', () => {
  assert.deepEqual(
    speechArticulationDriverPatch({ energy: null, viseme: 'rest', amount: 1 }),
    {
      jaw: 0,
      mouthWide: 0,
      mouthRound: 0,
      mouthNarrow: 0,
      mouthSeal: 0,
      talking: false,
    },
  )
  assert.deepEqual(
    speechArticulationDriverPatch({
      energy: null,
      viseme: 'wide',
      amount: 0.8,
    }),
    {
      jaw: 0.54 * 0.8,
      mouthWide: 0.8,
      mouthRound: 0,
      mouthNarrow: 0,
      mouthSeal: 0,
      talking: false,
    },
  )
  assert.deepEqual(
    speechArticulationDriverPatch({
      energy: null,
      viseme: 'round',
      amount: 0.5,
    }),
    {
      jaw: 0.64 * 0.5,
      mouthWide: 0,
      mouthRound: 0.5,
      mouthNarrow: 0,
      mouthSeal: 0,
      talking: false,
    },
  )
})

test('speech, singing and musical rest preserve the current negative bearing', () => {
  const driver = { ...IDENTITY_DRIVER }
  for (const expression of ['subdued', 'withdrawn', 'tense'] as const) {
    const bearing = bearingDriverPatch({
      expression,
      posture: 'neutral',
      motionEnergy: 1,
      attention: 0.4,
    })
    Object.assign(driver, bearing)
    for (const viseme of [
      'open',
      'wide',
      'round',
      'narrow',
      'closed',
      'rest',
    ] as const) {
      const articulation = speechArticulationDriverPatch({
        energy: 0.7,
        viseme,
        amount: 0.8,
      })
      assert.equal(Object.hasOwn(articulation, 'lipCurve'), false)
      Object.assign(driver, articulation)
      assert.equal(driver.lipCurve, bearing.lipCurve)
      assert.equal(driver.browTilt, bearing.browTilt)
      if (viseme === 'open') assert.ok(driver.jaw > 0.5)
      if (viseme === 'rest') assert.equal(driver.jaw, 0)
    }
  }
  driver.lipCurve = 0.3
  Object.assign(
    driver,
    speechArticulationDriverPatch({ energy: 0.8, viseme: 'open', amount: 1 }),
  )
  assert.equal(driver.lipCurve, 0.3)
})
