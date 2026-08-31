import type {
  MusicMotionAudio,
  MusicMotionClock,
  MusicMotionVisibility,
} from './musicSource'
import assert from 'node:assert/strict'
import test from 'node:test'
import { RigMotionCoordinator } from './coordinator'
import {
  MUSIC_LEASE_TTL_MS,
  MusicMotionSource,
  TRACK_SWITCH_HOLD_MS,
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

test('hiding the page releases music so a later sample can reclaim it', () => {
  const coordinator = new RigMotionCoordinator()
  let pageVisible = true
  const listeners = new Set<(visible: boolean) => void>()
  const source = new MusicMotionSource(
    coordinator,
    fakeClock(),
    silentAudio(),
    {
      isPageVisible: () => pageVisible,
      onVisibility: (callback) => {
        listeners.add(callback)
        return () => listeners.delete(callback)
      },
    },
  )
  source.setPlayback(true, false)
  source.subscribe(() => {})
  source.sampleNow(80)
  assert.equal(coordinator.owner('headBody', 80), 'music')
  pageVisible = false
  for (const listener of listeners) listener(false)
  assert.equal(coordinator.owner('headBody', 80), 'idle')
})

test('a track-switch hold then expires and drops the music lease', () => {
  const coordinator = new RigMotionCoordinator()
  const source = new MusicMotionSource(
    coordinator,
    fakeClock(),
    silentAudio(),
    visible,
  )
  source.setPlayback(true, false)
  source.sampleNow(80)
  assert.equal(coordinator.owner('headBody', 80), 'music')
  source.setPlayback(false, true)
  const held = source.sampleNow(90)
  assert.equal(held.apply.release, false)
  assert.equal(held.apply.writeGroove, true)
  const expired = source.sampleNow(90 + TRACK_SWITCH_HOLD_MS)
  assert.equal(expired.apply.release, true)
  assert.equal(coordinator.owner('headBody', 90 + TRACK_SWITCH_HOLD_MS), 'idle')
})

test('music renews one lease instead of stacking a new claim every sample', () => {
  const coordinator = new RigMotionCoordinator()
  const source = new MusicMotionSource(
    coordinator,
    fakeClock(),
    silentAudio(),
    visible,
  )
  source.setPlayback(true, false)
  source.sampleNow(80)
  source.sampleNow(80 + MUSIC_LEASE_TTL_MS - 10)
  const leases = coordinator
    .snapshot(80 + MUSIC_LEASE_TTL_MS - 10)
    .leases.filter((lease) => lease.source === 'music')
  assert.equal(leases.length, 1)
})

test('reconnects the analyser when the player swaps its audio element', () => {
  const connected: object[] = []
  let current: { paused: boolean; currentTime: number } = {
    paused: false,
    currentTime: 1.2,
  }
  const audio: MusicMotionAudio = {
    getCurrentAudio: () => current,
    getSpectrumBands: () => [0.4, 0.5, 0.3, 0.1, 0, 0, 0, 0],
    connectAudioToAnalyser: (element) => {
      connected.push(element)
      return true
    },
  }
  const source = new MusicMotionSource(
    new RigMotionCoordinator(),
    fakeClock(),
    audio,
    visible,
  )
  source.setPlayback(true, false)
  source.sampleNow(10)
  source.sampleNow(20)
  assert.equal(connected.length, 1)

  // The player rebuilt its element; the analyser must follow it there.
  current = { paused: false, currentTime: 0 }
  source.sampleNow(30)
  assert.equal(connected.length, 2)
  assert.equal(connected[1], current)
})
