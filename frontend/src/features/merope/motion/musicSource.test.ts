import type { MusicMotionAudio, MusicMotionClock, MusicMotionVisibility } from './musicSource'
import assert from 'node:assert/strict'
import test from 'node:test'
import { RigMotionCoordinator } from './coordinator'
import {

  MusicMotionSource,

} from './musicSource'

function fakeClock(): MusicMotionClock & {
  time: number
  frames: Array<(t: number) => void>
} {
  const frames: Array<(t: number) => void> = []
  return {
    time: 0,
    frames,
    now: () => 0,
    raf: (callback) => {
      frames.push(callback)
      return frames.length
    },
    caf: () => {
      frames.length = 0
    },
  }
}

function silentAudio(paused = false): MusicMotionAudio {
  return {
    getCurrentAudio: () => ({ paused, currentTime: 1.2 }),
    getSpectrumBands: () => [0.4, 0.5, 0.3, 0.1, 0, 0, 0, 0],
    connectAudioToAnalyser: () => true,
  }
}

const visible: MusicMotionVisibility = {
  isPageVisible: () => true,
  onVisibility: () => () => {},
}

test('one sampler fans out to every mounted rig', () => {
  const coordinator = new RigMotionCoordinator()
  const source = new MusicMotionSource(
    coordinator,
    fakeClock(),
    silentAudio(),
    visible,
  )
  source.setPlayback(true, false)
  const seen: number[] = []
  const first = source.subscribe(() => {
    seen.push(1)
  })
  const second = source.subscribe(() => {
    seen.push(2)
  })
  assert.equal(source.listenerCount(), 2)
  source.sampleNow(80)
  assert.ok(seen.includes(1))
  assert.ok(seen.includes(2))
  first()
  second()
  assert.equal(source.listenerCount(), 0)
})

test('playing music claims mouth and body until speech takes the mouth', () => {
  const coordinator = new RigMotionCoordinator()
  const source = new MusicMotionSource(
    coordinator,
    fakeClock(),
    silentAudio(),
    visible,
  )
  source.setPlayback(true, false)
  const frame = source.sampleNow(80)
  assert.equal(coordinator.owner('mouth', 80), 'music')
  assert.equal(coordinator.owner('headBody', 80), 'music')
  assert.equal(frame.apply.writeMouth, true)
  assert.equal(frame.apply.writeGroove, true)

  coordinator.claim('speech', ['mouth'], { nowMs: 90 })
  const yielded = source.sampleNow(90)
  assert.equal(yielded.apply.writeMouth, false)
  assert.equal(yielded.apply.writeGroove, true)
  assert.equal(coordinator.owner('headBody', 90), 'music')
})

test('pause rests the mouth without dropping the music lease', () => {
  const coordinator = new RigMotionCoordinator()
  const source = new MusicMotionSource(
    coordinator,
    fakeClock(),
    silentAudio(true),
    visible,
  )
  source.setPlayback(true, false)
  const frame = source.sampleNow(80)
  assert.equal(frame.apply.restMouth, true)
  assert.equal(frame.apply.writeGroove, true)
  assert.equal(frame.apply.release, false)
  assert.equal(coordinator.owner('headBody', 80), 'music')
})
