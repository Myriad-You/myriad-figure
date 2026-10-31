import type { PerformanceBaseline, PerformanceCue, ScoreDirection, ScoreSide, SpeechPhrase } from './types'
import assert from 'node:assert/strict'
import test from 'node:test'
import contract from '@myriad/core/shared/merope_performance_contract.json' with { type: 'json' }

// The page that directs her writes these types and core's contract judges
// them. Each record must name every member of its type and nothing else, so
// the compiler holds the type to the record and this test holds the record to
// the contract.
const vocabularies: Record<string, [Record<string, true>, string[]]> = {
  baselineExpressions: [
    { withdrawn: true, subdued: true, steady: true, warm: true, tense: true } satisfies Record<PerformanceBaseline['expression'], true>,
    contract.baselineExpressions,
  ],
  postures: [
    { closed: true, neutral: true, open: true } satisfies Record<PerformanceBaseline['posture'], true>,
    contract.postures,
  ],
  cueIntents: [
    {
      greet: true,
      respond: true,
      question: true,
      delight: true,
      emphasize: true,
      listen: true,
      notify: true,
      think: true,
      dizzy: true,
      cry: true,
      angry: true,
      speechless: true,
      maniac: true,
      silly: true,
      lovestruck: true,
    } satisfies Record<PerformanceCue['intent'], true>,
    contract.cueIntents,
  ],
  cuePriorities: [
    {
      greet: true,
      respond: true,
      question: true,
      delight: true,
      emphasize: true,
      listen: true,
      notify: true,
      think: true,
      dizzy: true,
      cry: true,
      angry: true,
      speechless: true,
      maniac: true,
      silly: true,
      lovestruck: true,
    } satisfies Record<PerformanceCue['intent'], true>,
    Object.keys(contract.cuePriorities),
  ],
  interruptModes: [
    { 'replace': true, 'queue': true, 'if-lower': true } satisfies Record<PerformanceCue['interrupt'], true>,
    contract.interruptModes,
  ],
  phraseIntents: [
    { 'ask': true, 'hesitate': true, 'tease': true, 'explain': true, 'check-in': true, 'laugh': true, 'none': true } satisfies Record<SpeechPhrase['intent'], true>,
    contract.phraseIntents,
  ],
  scoreSides: [
    { left: true, right: true, both: true } satisfies Record<ScoreSide, true>,
    contract.scoreSides,
  ],
  scoreDirections: [
    {
      'left': true,
      'right': true,
      'up': true,
      'down': true,
      'up-left': true,
      'up-right': true,
      'down-left': true,
      'down-right': true,
    } satisfies Record<ScoreDirection, true>,
    contract.scoreDirections,
  ],
}

for (const [name, [members, words]] of Object.entries(vocabularies)) {
  test(`the ${name} type names exactly core's words`, () => {
    assert.deepEqual(Object.keys(members).sort(), [...words].sort())
  })
}
