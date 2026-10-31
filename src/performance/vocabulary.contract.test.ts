import assert from 'node:assert/strict'
import test from 'node:test'
import contract from '../../contracts/merope_performance_contract.json' with { type: 'json' }
import {
  BASELINE_EXPRESSIONS,
  CUE_INTENTS,
  INTERRUPT_MODES,
  PHRASE_INTENTS,
  POSTURES,
  SCORE_DIRECTIONS,
  SCORE_SIDES,
} from './vocabulary'

const lists: [string, readonly string[], readonly string[]][] = [
  ['baselineExpressions', BASELINE_EXPRESSIONS, contract.baselineExpressions],
  ['postures', POSTURES, contract.postures],
  ['cueIntents', CUE_INTENTS, contract.cueIntents],
  ['cuePriorities', CUE_INTENTS, Object.keys(contract.cuePriorities)],
  ['interruptModes', INTERRUPT_MODES, contract.interruptModes],
  ['phraseIntents', PHRASE_INTENTS, contract.phraseIntents],
  ['scoreSides', SCORE_SIDES, contract.scoreSides],
  ['scoreDirections', SCORE_DIRECTIONS, contract.scoreDirections],
]

for (const [name, words, coreWords] of lists) {
  test(`the figure reads core's ${name} word for word`, () => {
    assert.deepEqual([...words].sort(), [...coreWords].sort())
  })
}
