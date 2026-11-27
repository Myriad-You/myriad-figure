import assert from 'node:assert/strict'
import test from 'node:test'
import { FigureChannel } from '../channel'
import { dispatchMeropeState, resolveLoadedMeropeAffect } from './performanceEvents'

test('state streams and late GETs converge on the newest mood, and reset between owners', () => {
  const channel = new FigureChannel()
  const initial = { mood: 30, arousal: 70, moodRevision: 10, activity: 'idle' }
  assert.deepEqual(resolveLoadedMeropeAffect(channel, initial), { mood: 30, arousal: 70 })
  const next = {
    mood: { before: 30, after: 35, arousalBefore: 70, arousalAfter: 50,
      bandBefore: 'tense', bandAfter: 'sad', delta: 5, cause: 'user_appraisal', revision: 12 },
    activity: 'idle',
  }
  dispatchMeropeState(channel, next)
  dispatchMeropeState(channel, { ...next, mood: { ...next.mood, after: 0, revision: 11 } })
  dispatchMeropeState(channel, { ...next, mood: { ...next.mood, after: 0 } })
  assert.equal(channel.currentState()?.mood.after, 35)
  assert.deepEqual(resolveLoadedMeropeAffect(channel, initial), { mood: 35, arousal: 50 })
  assert.deepEqual(resolveLoadedMeropeAffect(channel, { mood: 58, arousal: 50, moodRevision: 15 }), { mood: 58, arousal: 50 })
  assert.equal(channel.currentState()?.mood.revision, 15)
  channel.resetState()
  assert.deepEqual(resolveLoadedMeropeAffect(channel, { mood: 70, arousal: 48, moodRevision: 1 }), { mood: 70, arousal: 48 })
})
