import type { SpeechArticulation } from '../rig/articulation'
import type { MotionLeaseHandle, RigMotionCoordinator } from './coordinator'
import type { SpeechIntent, SpeechTextChunk } from './intents'
import { MEROPE_SPEECH_EVENT, meropeSpeechEventDetail } from '../speechEvents'
import { SpeechLifecycleController } from '../speechLifecycle'
import { SpeechMotionLease } from './speechLease'

const REST: SpeechArticulation = { energy: 0, viseme: 'rest', amount: 0 }
const MAX_QUEUED_TEXT = 32

/**
 * One speech producer for a coordinator. Publishes semantic mouth intent
 * and a co-speech lease; never writes a rig.
 */
export class SpeechMotionSource {
  private readonly mouth: SpeechMotionLease
  private coSpeech: MotionLeaseHandle | null = null
  private controller: SpeechLifecycleController | null = null
  private textSeq = 0
  private queuedText: SpeechTextChunk[] = []
  private intent: SpeechIntent = {
    active: false,
    autoSpeech: false,
    energy: null,
    articulation: null,
    queuedText: [],
  }

  private listening = false

  constructor(
    private readonly coordinator: RigMotionCoordinator,
    private readonly onChange: (intent: SpeechIntent) => void,
  ) {
    this.mouth = new SpeechMotionLease(coordinator)
  }

  current(): SpeechIntent {
    return this.intent
  }

  start(): void {
    if (this.listening) return
    this.controller = new SpeechLifecycleController(
      {
        setSpeechActive: (active) => {
          this.intent = { ...this.intent, active }
          this.flush()
        },
        setAutoSpeech: (active) => {
          this.intent = { ...this.intent, autoSpeech: active }
          this.flush()
        },
        setSpeechEnergy: (energy) => {
          this.intent = { ...this.intent, energy, articulation: null }
          this.flush()
        },
        setSpeechArticulation: (articulation) => {
          this.intent = { ...this.intent, articulation, energy: null }
          this.flush()
        },
        enqueueSpeechText: (text, locale) => {
          this.textSeq += 1
          this.queuedText = [
            ...this.queuedText,
            { seq: this.textSeq, text, ...(locale ? { locale } : {}) },
          ].slice(-MAX_QUEUED_TEXT)
          this.intent = { ...this.intent, queuedText: this.queuedText }
          this.flush()
        },
      },
      undefined,
      undefined,
      (busy) => {
        this.mouth.setBusy(busy)
        if (busy) this.claimCoSpeech()
        else this.releaseCoSpeech()
        this.flush()
      },
    )
    if (typeof window !== 'undefined') {
      window.addEventListener(MEROPE_SPEECH_EVENT, this.onSpeech)
    }
    this.listening = true
  }

  stop(): void {
    if (!this.listening) return
    if (typeof window !== 'undefined') {
      window.removeEventListener(MEROPE_SPEECH_EVENT, this.onSpeech)
    }
    this.controller?.dispose()
    this.controller = null
    this.mouth.release()
    this.releaseCoSpeech()
    this.listening = false
    this.queuedText = []
    this.textSeq = 0
    this.intent = {
      active: false,
      autoSpeech: false,
      energy: null,
      articulation: REST,
      queuedText: [],
    }
    this.flush()
  }

  handleForTest(
    detail: Parameters<SpeechLifecycleController['handle']>[0],
  ): void {
    this.controller?.handle(detail)
  }

  private readonly onSpeech = (event: Event): void => {
    const detail = meropeSpeechEventDetail(
      (event as CustomEvent<unknown>).detail,
    )
    if (detail) this.controller?.handle(detail)
  }

  private claimCoSpeech(): void {
    this.coSpeech =
      this.coordinator.renew(this.coSpeech, ['expression', 'headBody']) ??
      this.coordinator.claim('coSpeech', ['expression', 'headBody'])
  }

  private releaseCoSpeech(): void {
    this.coordinator.release(this.coSpeech)
    this.coSpeech = null
  }

  private flush(): void {
    this.onChange(this.intent)
  }
}
