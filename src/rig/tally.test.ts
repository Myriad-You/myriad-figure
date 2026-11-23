import assert from 'node:assert/strict'
import test from 'node:test'
import { tally } from './tally'

test('votes counted in runs read back as votes counted one at a time, keys in the order first met', () => {
  let state = 5
  const random = () => {
    state = (state * 1103515245 + 12345) & 0x7FFFFFFF
    return state / 0x7FFFFFFF
  }
  const keys = [null, 'face', 'top', 'neck', ''] as const
  for (let round = 0; round < 200; round += 1) {
    const plain = new Map<string | null, number>()
    const fast = tally<string | null>()
    let key: string | null = keys[Math.floor(random() * keys.length)]!
    for (let i = Math.floor(random() * 60); i > 0; i -= 1) {
      // Mostly runs of one key.
      if (random() < 0.3) key = keys[Math.floor(random() * keys.length)]!
      plain.set(key, (plain.get(key) ?? 0) + 1)
      fast.vote(key)
    }
    assert.deepEqual([...fast.counts()], [...plain])
  }
})
