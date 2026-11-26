import assert from 'node:assert/strict'
import test from 'node:test'
import { FigureError as StageError } from '@myriad-you/figure-player'
import { FIGURE_ERROR_TEXT, FigureError, isFigureErrorCode } from './errors'

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
