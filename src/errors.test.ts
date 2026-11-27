import assert from 'node:assert/strict'
import test from 'node:test'
import { poseFromJSON, readAnime25DPlayback, FIGURE_ERROR_TEXT as STAGE_ERROR_TEXT, FigureError as StageError } from '@myriad-you/figure-player'
import { FIGURE_ERROR_TEXT, FigureError, isFigureErrorCode } from './errors'
import { formatTemplate } from './rig/formatTemplate'

test('what the stage throws is a FigureError, with its code, params and message', () => {
  const thrown: unknown = new StageError('anime25dWebglFailed', { at: 1 })
  assert.ok(thrown instanceof FigureError)
  if (!(thrown instanceof FigureError)) return
  assert.equal(thrown.name, 'FigureError')
  assert.equal(thrown.code, 'anime25dWebglFailed')
  assert.deepEqual(thrown.params, { at: 1 })
  assert.equal(thrown.message, FIGURE_ERROR_TEXT.anime25dWebglFailed)
  assert.ok(isFigureErrorCode(thrown.code))
})

test('the figure\'s own errors keep every code; other errors are not FigureErrors', () => {
  const own = new FigureError('anime25dLayerTooWide', { id: 'hair', max: 4096 })
  assert.ok(own instanceof FigureError)
  assert.ok(own instanceof Error)
  assert.equal(own.message, 'Layer hair is wider than 4096.')
  assert.equal(new Error('x') instanceof FigureError, false)
  assert.equal((null as unknown) instanceof FigureError, false)
  assert.equal(isFigureErrorCode('psdTooLarge'), true)
})

test('a subclass of FigureError matches only its own instances', () => {
  class NarrowError extends FigureError {}
  const narrow = new NarrowError('psdTooLarge')
  assert.ok(narrow instanceof NarrowError)
  assert.ok(narrow instanceof FigureError)
  assert.equal(new FigureError('psdTooLarge') instanceof NarrowError, false)
  assert.equal(new StageError('anime25dWebglFailed') instanceof NarrowError, false)
})

const PARAMS = { field: 'shellProfile', version: 9, read: '7, 8' }

test('every code the player throws is a figure code, with words of its own that fill in its params', () => {
  for (const code of Object.keys(STAGE_ERROR_TEXT) as Array<keyof typeof STAGE_ERROR_TEXT>) {
    const thrown: unknown = new StageError(code, PARAMS)
    assert.ok(thrown instanceof FigureError, code)
    if (!(thrown instanceof FigureError)) continue
    assert.ok(isFigureErrorCode(thrown.code), code)
    const own = new FigureError(thrown.code, thrown.params)
    assert.equal(own.message, thrown.message, code)
    assert.notEqual(own.message, '', code)
    assert.doesNotMatch(own.message, /\{\w+\}/, code)
    assert.equal(formatTemplate(FIGURE_ERROR_TEXT[thrown.code], thrown.params), thrown.message, code)
  }
})

test('the player\'s refusals of a package or a pose arrive as FigureErrors with their code and words', () => {
  const caught = (run: () => unknown): unknown => {
    try {
      run()
    }
    catch (error) {
      return error
    }
    return null
  }
  const cases: Array<[unknown, string, string]> = [
    [caught(() => readAnime25DPlayback({ version: 9 } as never)), 'anime25dPlaybackVersion', 'This figure package is of version 9; this player reads versions 7, 8.'],
    [caught(() => readAnime25DPlayback({ version: 7, engine: 7 } as never)), 'anime25dPlaybackInvalid', 'This figure package is malformed at engine.'],
    [caught(() => poseFromJSON('{"version":3}')), 'anime25dPoseVersion', 'This pose is of version 3; this player reads versions 1, 2.'],
  ]
  for (const [error, code, message] of cases) {
    assert.ok(error instanceof FigureError, code)
    if (!(error instanceof FigureError)) continue
    assert.equal(error.code, code)
    assert.equal(new FigureError(error.code, error.params).message, message)
    assert.equal(error.message, message)
  }
})
