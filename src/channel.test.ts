import assert from 'node:assert/strict'
import test from 'node:test'
import { FigureChannel } from './channel'

test('live generation is per channel and missing values stay compatible', () => {
  const channel = new FigureChannel()
  channel.setGeneration(4)
  assert.equal(channel.generation(), 4)
  assert.equal(channel.isLive(4), true)
  assert.equal(channel.isLive(3), false)
  assert.equal(channel.isLive(undefined), true)
  const first = channel.newIntentId()
  const second = channel.newIntentId()
  assert.ok(first.startsWith('motion-4-'))
  assert.notEqual(first, second)
  assert.equal(new FigureChannel().isLive(3), false)
  channel.setGeneration(0)
  assert.equal(channel.generation(), 0)
})

test('stale generations are reported to the channel trace, not the run hub', () => {
  const drops: string[] = []
  const channel = new FigureChannel({ mark() {}, drop: reason => drops.push(reason), leaseExpiry() {}, frame() {} })
  channel.setGeneration(4)
  assert.equal(channel.acceptLive(4), true)
  assert.equal(channel.acceptLive(3), false)
  assert.deepEqual(drops, ['stale_generation'])
})

test('two channels do not share turns or state', () => {
  const a = new FigureChannel()
  const b = new FigureChannel()
  a.setGeneration(7)
  assert.equal(b.generation(), 0)
  a.writeState({ activity: 'idle', mood: { before: 1, after: 2, bandBefore: 'calm', bandAfter: 'calm', delta: 1, cause: 'x', revision: 1 } })
  assert.equal(b.currentState(), null)
})
