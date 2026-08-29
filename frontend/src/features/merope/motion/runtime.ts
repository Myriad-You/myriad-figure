import type { MoodIntent, MotionFrame, PerformanceIntent, SpeechIntent } from './intents'
import type { MusicMotionSource, SingingFrame } from './musicSource'
import { AmbientMotionSource } from './ambientSource'
import { RigMotionCoordinator } from './coordinator'
import { MoodMotionSource } from './moodSource'
import { PerformanceMotionSource } from './performanceSource'
import { SpeechMotionSource } from './speechSource'

export type MotionFrameListener = (frame: MotionFrame) => void

/**
 * Single motion outlet for one coordinator. Sources publish intents here;
 * mounted rigs only subscribe.
 */
export class MotionRuntime {
  readonly coordinator: RigMotionCoordinator
  readonly speech: SpeechMotionSource
  readonly performance: PerformanceMotionSource
  readonly mood: MoodMotionSource
  readonly ambient: AmbientMotionSource
  private readonly musicSource: MusicMotionSource | null
  private readonly listeners = new Set<MotionFrameListener>()
  private retains = 0
  private unsubMusic: (() => void) | null = null
  private speechIntent: SpeechIntent | null = null
  private performanceIntent: PerformanceIntent | null = null
  private musicFrame: SingingFrame | null = null
  private moodIntent: MoodIntent | null = null

  constructor(
    coordinator: RigMotionCoordinator,
    musicSource: MusicMotionSource | null = null,
  ) {
    this.coordinator = coordinator
    this.musicSource = musicSource
    this.speech = new SpeechMotionSource(coordinator, (intent) => {
      this.speechIntent = intent
      this.emit()
    })
    this.performance = new PerformanceMotionSource(coordinator, (intent) => {
      this.performanceIntent = intent
      this.emit()
    })
    this.mood = new MoodMotionSource(coordinator, (intent) => {
      this.moodIntent = intent
      this.emit()
    })
    this.ambient = new AmbientMotionSource(coordinator)
  }

  retain(): () => void {
    this.retains += 1
    if (this.retains === 1) {
      this.speech.start()
      this.performance.start()
      this.ambient.claim()
      if (this.musicSource) {
        this.unsubMusic = this.musicSource.subscribe((frame) => {
          this.musicFrame = frame
          this.emit()
        })
      }
    }
    return () => {
      this.retains -= 1
      if (this.retains > 0) return
      this.retains = 0
      this.speech.stop()
      this.performance.stop()
      this.mood.release()
      this.ambient.release()
      this.unsubMusic?.()
      this.unsubMusic = null
      this.musicFrame = null
    }
  }

  frame(): MotionFrame {
    return {
      snapshot: this.coordinator.snapshot(),
      speech: this.speechIntent,
      performance: this.performanceIntent,
      music: this.musicFrame,
      mood: this.moodIntent,
    }
  }

  subscribe(listener: MotionFrameListener): () => void {
    this.listeners.add(listener)
    listener(this.frame())
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(): void {
    const frame = this.frame()
    for (const listener of this.listeners) listener(frame)
  }
}

export function createPreviewMotionRuntime(): MotionRuntime {
  return new MotionRuntime(new RigMotionCoordinator())
}
