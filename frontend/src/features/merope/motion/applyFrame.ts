import type { RigCharacterHandle } from '../rig/RigCharacter'
import type { MotionFrame } from './intents'
import { applySingingWrite } from './applySnapshot'
import { policyFromOwners } from './policy'

export interface MotionApplyState {
  speechTextSeq: number
  performanceStartedAtMs: number | null
  speechOwnedMouth: boolean
}

export function createMotionApplyState(): MotionApplyState {
  return {
    speechTextSeq: 0,
    performanceStartedAtMs: null,
    speechOwnedMouth: false,
  }
}

/**
 * The only production writer. Sources never call the rig; each mounted
 * face consumes the same frame through this function.
 */
export function applyMotionFrame(
  rig: Pick<
    RigCharacterHandle,
    | 'setMotionPolicy'
    | 'setSpeechActive'
    | 'setAutoSpeech'
    | 'setSpeechEnergy'
    | 'setSpeechArticulation'
    | 'enqueueSpeechText'
    | 'playMotionPlan'
    | 'stopMotionPlan'
    | 'setSinging'
    | 'setSingingSpectrum'
  >,
  frame: MotionFrame,
  state: MotionApplyState,
): MotionApplyState {
  rig.setMotionPolicy(policyFromOwners(frame.snapshot.owners))
  applySpeech(rig, frame, state)
  applyPerformance(rig, frame, state)
  applyMusic(rig, frame)
  return state
}

function applySpeech(
  rig: Pick<
    RigCharacterHandle,
    | 'setSpeechActive'
    | 'setAutoSpeech'
    | 'setSpeechEnergy'
    | 'setSpeechArticulation'
    | 'enqueueSpeechText'
  >,
  frame: MotionFrame,
  state: MotionApplyState,
): void {
  const speechOwns = frame.snapshot.owners.mouth === 'speech'
  const speech = frame.speech
  if (speechOwns && speech) {
    rig.setSpeechActive(speech.active)
    rig.setAutoSpeech(speech.autoSpeech)
    if (speech.energy != null) rig.setSpeechEnergy(speech.energy)
    if (speech.articulation) rig.setSpeechArticulation(speech.articulation)
    for (const chunk of speech.queuedText) {
      if (chunk.seq <= state.speechTextSeq) continue
      rig.enqueueSpeechText(chunk.text, chunk.locale)
      state.speechTextSeq = chunk.seq
    }
    state.speechOwnedMouth = true
    return
  }
  if (state.speechOwnedMouth && !speechOwns) {
    rig.setAutoSpeech(false)
    if (frame.snapshot.owners.mouth !== 'music') rig.setSpeechActive(false)
    state.speechOwnedMouth = false
  }
}

function applyPerformance(
  rig: Pick<RigCharacterHandle, 'playMotionPlan' | 'stopMotionPlan'>,
  frame: MotionFrame,
  state: MotionApplyState,
): void {
  const directive = frame.performance?.directive ?? null
  const startedAtMs = frame.performance?.startedAtMs ?? 0
  if (directive) {
    if (state.performanceStartedAtMs !== startedAtMs) {
      rig.playMotionPlan(directive, startedAtMs)
      state.performanceStartedAtMs = startedAtMs
    }
    return
  }
  if (state.performanceStartedAtMs != null) {
    rig.stopMotionPlan()
    state.performanceStartedAtMs = null
  }
}

function applyMusic(
  rig: Pick<
    RigCharacterHandle,
    | 'setSinging'
    | 'setSingingSpectrum'
    | 'setSpeechArticulation'
    | 'setSpeechActive'
  >,
  frame: MotionFrame,
): void {
  if (!frame.music) return
  applySingingWrite(rig, frame.music.apply, {
    spectrum: frame.music.spectrum,
    articulation: frame.music.articulation,
  })
}
