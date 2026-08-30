import type { PerformanceCue, RigMotionStyle } from '../../../services/agent/types'
import type { MoodIntent, MotionFrame, PerformanceIntent, SpeechIntent } from './intents'
import type { MusicMotionSource, SingingFrame } from './musicSource'
import { AmbientMotionSource } from './ambientSource'
import { AutonomyMotionSource } from './autonomySource'
import { RigMotionCoordinator } from './coordinator'
import { MoodMotionSource } from './moodSource'
import { PerformanceMotionSource } from './performanceSource'
import { SpeechMotionSource } from './speechSource'

export type MotionFrameListener = (frame: MotionFrame) => void

export interface RigSummaryFacts {
  capabilities: string[]
  recentIntents: PerformanceCue['intent'][]
  motionStyle: RigMotionStyle
  faceVisible: boolean
}

const MAX_RECENT = 6

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
  readonly autonomy: AutonomyMotionSource
  private readonly musicSource: MusicMotionSource | null
  private readonly listeners = new Set<MotionFrameListener>()
  private retains = 0
  private unsubMusic: (() => void) | null = null
  private speechIntent: SpeechIntent | null = null
  private performanceIntent: PerformanceIntent | null = null
  private musicFrame: SingingFrame | null = null
  private moodIntent: MoodIntent | null = null
  private autonomyIntent: PerformanceIntent | null = null
  private capabilities: string[] = []
  private recentIntents: PerformanceCue['intent'][] = []
  private motionStyle: RigMotionStyle = 'even'
  private previewClock: ReturnType<typeof setTimeout> | null = null
  private previewClockActive = false

  constructor(
    coordinator: RigMotionCoordinator,
    musicSource: MusicMotionSource | null = null,
    private readonly liveAutonomy = false,
  ) {
    this.coordinator = coordinator
    this.musicSource = musicSource
    this.speech = new SpeechMotionSource(coordinator, (intent) => {
      this.speechIntent = intent
      this.emit()
    })
    this.performance = new PerformanceMotionSource(coordinator, (intent) => {
      this.performanceIntent = intent
      this.rememberIntents(intent.directive?.plan.cues.map((cue) => cue.intent) ?? [])
      this.emit()
    })
    this.mood = new MoodMotionSource(coordinator, (intent) => {
      this.moodIntent = intent
      this.emit()
    })
    this.ambient = new AmbientMotionSource(coordinator)
    this.autonomy = new AutonomyMotionSource(
      coordinator,
      (intent) => {
        this.autonomyIntent = intent
        this.emit()
      },
      () => Boolean(this.speechIntent?.active),
    )
  }

  retain(): () => void {
    this.retains += 1
    if (this.retains === 1) {
      this.speech.start()
      this.performance.start()
      this.ambient.claim()
      if (this.liveAutonomy) this.autonomy.start()
      if (this.musicSource) {
        this.unsubMusic = this.musicSource.subscribe((frame) => {
          this.musicFrame = frame
          this.emit()
        })
      } else {
        this.startPreviewClock()
      }
    }
    return () => {
      this.retains -= 1
      if (this.retains > 0) return
      this.retains = 0
      this.stopPreviewClock()
      this.speech.stop()
      this.performance.stop()
      this.autonomy.stop()
      this.mood.release()
      this.ambient.release()
      this.unsubMusic?.()
      this.unsubMusic = null
      this.musicFrame = null
    }
  }

  setCapabilities(capabilities: readonly string[]): void {
    this.capabilities = [...new Set(capabilities)].slice(0, 12)
  }

  setMotionStyle(style: RigMotionStyle): void {
    this.motionStyle = style
  }

  summaryFacts(): RigSummaryFacts {
    return {
      capabilities: this.capabilities,
      recentIntents: this.recentIntents,
      motionStyle: this.motionStyle,
      faceVisible: this.retains > 0,
    }
  }

  frame(): MotionFrame {
    return {
      snapshot: this.coordinator.snapshot(),
      speech: this.speechIntent,
      performance: this.performanceIntent,
      music: this.musicFrame,
      mood: this.moodIntent,
      autonomy: this.autonomyIntent,
    }
  }

  subscribe(listener: MotionFrameListener): () => void {
    this.listeners.add(listener)
    listener(this.frame())
    return () => {
      this.listeners.delete(listener)
    }
  }

  private rememberIntents(intents: readonly PerformanceCue['intent'][]): void {
    if (intents.length === 0) return
    this.recentIntents = [...this.recentIntents, ...intents].slice(-MAX_RECENT)
  }

  private emit(): void {
    const frame = this.frame()
    for (const listener of this.listeners) listener(frame)
  }

  private startPreviewClock(): void {
    if (this.previewClockActive) return
    this.previewClockActive = true
    const step = () => {
      if (!this.previewClockActive) return
      const now =
        typeof performance !== 'undefined' ? performance.now() : Date.now()
      this.coordinator.tick(now)
      this.emit()
      const timer = setTimeout(step, 16)
      if (typeof timer === 'object' && 'unref' in timer) timer.unref()
      this.previewClock = timer
    }
    step()
  }

  private stopPreviewClock(): void {
    this.previewClockActive = false
    if (this.previewClock == null) return
    clearTimeout(this.previewClock)
    this.previewClock = null
  }
}

export function createPreviewMotionRuntime(): MotionRuntime {
  return new MotionRuntime(new RigMotionCoordinator())
}
