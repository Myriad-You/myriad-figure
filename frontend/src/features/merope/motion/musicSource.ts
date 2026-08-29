import type { SpeechArticulation } from '../rig/articulation'
import type { SingingSpectrumDrive } from '../singing/singingGroove'
import type { SingingCue } from '../singing/singingTimeline'
import type { MotionLeaseHandle, RigMotionCoordinator } from './coordinator'
import type { SingingApply } from './singingApply'
import {
  restSingingArticulation,
  sampleSingingCue,
  singingArticulation,
  singingVocalEnergy,
} from '../singing/singingClock'
import { singingSpectrumDrive } from '../singing/singingGroove'
import { singingPlaybackGap } from '../singing/singingHold'
import { compileSingingTimeline } from '../singing/singingTimeline'
import { resolveSingingApply } from './singingApply'

export const SINGING_SAMPLE_INTERVAL_MS = 50
export const TRACK_SWITCH_HOLD_MS = 12_000
export const MUSIC_LEASE_TTL_MS = 250

export interface SingingFrame {
  apply: SingingApply
  spectrum: SingingSpectrumDrive | null
  articulation: SpeechArticulation
}

export interface MusicMotionClock {
  now: () => number
  raf: (callback: (time: number) => void) => number
  caf: (id: number) => void
}

export interface MusicMotionAudio {
  getCurrentAudio: () => { paused: boolean; currentTime: number } | null
  getSpectrumBands: () => number[]
  connectAudioToAnalyser: (audio: { paused: boolean }) => boolean
}

export interface MusicMotionVisibility {
  isPageVisible: () => boolean
  onVisibility: (callback: (visible: boolean) => void) => () => void
}

export interface MusicTrackInput {
  songId: string
  duration?: number
  verbatim?: Parameters<typeof compileSingingTimeline>[0]['verbatim']
  lines?: Parameters<typeof compileSingingTimeline>[0]['lines']
}

export type SingingFrameListener = (frame: SingingFrame) => void

/**
 * One sampler for every mounted face. Reuses the site audio analyser
 * (50ms cache) and publishes a channel-gated frame.
 */
export class MusicMotionSource {
  private readonly listeners = new Set<SingingFrameListener>()
  private readonly clock: MusicMotionClock
  private readonly audio: MusicMotionAudio
  private readonly visibility: MusicMotionVisibility
  private readonly coordinator: RigMotionCoordinator
  private playing = false
  private switching = false
  private songId = ''
  private cues: SingingCue[] = []
  private humming = true
  private compileGeneration = 0
  private connected = false
  private frame = 0
  private lastSample = 0
  private holdUntil = 0
  private pageVisible = true
  private unsubscribeVisibility: (() => void) | null = null
  private lastFrame: SingingFrame | null = null
  private musicLease: MotionLeaseHandle | null = null

  constructor(
    coordinator: RigMotionCoordinator,
    clock: MusicMotionClock,
    audio: MusicMotionAudio,
    visibility: MusicMotionVisibility,
  ) {
    this.coordinator = coordinator
    this.clock = clock
    this.audio = audio
    this.visibility = visibility
  }

  subscribe(listener: SingingFrameListener): () => void {
    this.listeners.add(listener)
    if (this.lastFrame) listener(this.lastFrame)
    this.start()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.stop()
    }
  }

  listenerCount(): number {
    return this.listeners.size
  }

  setPlayback(playing: boolean, switching: boolean): void {
    this.playing = playing
    if (playing) this.switching = false
    else this.switching = switching
    this.start()
  }

  markSwitching(): void {
    if (this.playing) return
    this.switching = true
  }

  setTrack(track: MusicTrackInput): void {
    const songId = track.songId
    if (songId !== this.songId) {
      if (this.songId) this.switching = true
      this.songId = songId
      this.cues = []
      this.humming = true
    }
    if (!songId) {
      this.compileGeneration += 1
      this.cues = []
      this.humming = true
      return
    }
    const generation = ++this.compileGeneration
    void compileSingingTimeline({
      verbatim: track.verbatim,
      lines: track.lines,
      songDuration: track.duration,
    }).then((cues) => {
      if (generation !== this.compileGeneration) return
      this.cues = cues
      this.humming = cues.length === 0
    })
  }

  sampleNow(timestamp: number = this.clock.now()): SingingFrame {
    const nowMs = timestamp
    const gap = singingPlaybackGap(this.playing, this.switching)
    let holdExpired = false
    if (gap === 'hold') {
      if (!this.holdUntil) this.holdUntil = timestamp + TRACK_SWITCH_HOLD_MS
      holdExpired = timestamp >= this.holdUntil
    } else {
      this.holdUntil = 0
    }

    const audio = this.audio.getCurrentAudio()
    const audioPaused = !audio || audio.paused
    if (audio && !this.connected) {
      this.connected = this.audio.connectAudioToAnalyser(audio)
    }

    if (gap === 'stop' || holdExpired) {
      this.releaseMusic()
    } else {
      this.holdMusic(nowMs)
    }

    const snapshot = this.coordinator.snapshot(nowMs)
    const apply = resolveSingingApply({
      gap,
      holdExpired,
      audioPaused,
      mouthOwner: snapshot.owners.mouth,
      headBodyOwner: snapshot.owners.headBody,
    })

    let spectrum: SingingSpectrumDrive | null = null
    let articulation = restSingingArticulation()
    if (!apply.release && audio && !audioPaused) {
      const time = Number.isFinite(audio.currentTime) ? audio.currentTime : 0
      const bands = this.audio.getSpectrumBands()
      const energy = singingVocalEnergy(bands)
      const hasSpectrum = bands.some((band) => band > 0.01)
      spectrum = hasSpectrum ? singingSpectrumDrive(bands) : null
      const cue = this.humming ? null : sampleSingingCue(this.cues, time)
      articulation = singingArticulation({
        cue,
        energy: hasSpectrum ? energy : null,
        humming: this.humming,
      })
    }

    const frame: SingingFrame = { apply, spectrum, articulation }
    this.lastFrame = frame
    for (const listener of this.listeners) listener(frame)
    return frame
  }

  private start(): void {
    if (this.frame || this.listeners.size === 0) return
    this.pageVisible = this.visibility.isPageVisible()
    if (!this.unsubscribeVisibility) {
      this.unsubscribeVisibility = this.visibility.onVisibility((visible) => {
        this.pageVisible = visible
        if (visible) this.start()
        else this.pauseLoop(true)
      })
    }
    if (!this.pageVisible) return
    const loop = (timestamp: number) => {
      if (!this.listeners.size) {
        this.frame = 0
        return
      }
      if (!this.pageVisible) {
        this.pauseLoop(true)
        return
      }
      if (timestamp - this.lastSample >= SINGING_SAMPLE_INTERVAL_MS) {
        this.lastSample = timestamp
        this.sampleNow(timestamp)
      }
      this.frame = this.clock.raf(loop)
    }
    this.frame = this.clock.raf(loop)
  }

  private pauseLoop(release: boolean): void {
    if (this.frame) {
      this.clock.caf(this.frame)
      this.frame = 0
    }
    this.holdUntil = 0
    if (release) {
      this.releaseMusic()
      const frame: SingingFrame = {
        apply: {
          release: true,
          writeGroove: false,
          writeMouth: false,
          restMouth: this.coordinator.owner('mouth') !== 'speech',
        },
        spectrum: null,
        articulation: restSingingArticulation(),
      }
      this.lastFrame = frame
      for (const listener of this.listeners) listener(frame)
    }
  }

  private stop(): void {
    this.pauseLoop(true)
    this.unsubscribeVisibility?.()
    this.unsubscribeVisibility = null
    this.connected = false
    this.lastFrame = null
  }

  private holdMusic(nowMs: number): void {
    this.musicLease =
      this.coordinator.renew(this.musicLease, ['mouth', 'headBody'], {
        nowMs,
        ttlMs: MUSIC_LEASE_TTL_MS,
      }) ??
      this.coordinator.claim('music', ['mouth', 'headBody'], {
        nowMs,
        ttlMs: MUSIC_LEASE_TTL_MS,
      })
  }

  private releaseMusic(): void {
    this.coordinator.release(this.musicLease)
    this.musicLease = null
  }
}
