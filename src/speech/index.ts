// Speech as the body sees it: prosody, visemes and the speech events a page dispatches.
// The public surface of this directory; everything else in it is internal.

export type { SpeechProsodyPlan, SpeechProsodyTimeline } from './prosody'
export { speechProsodyTimeline } from './prosody'
export type { MeropeSpeechEventDetail, MeropeSpeechSource, SpeechUtteranceInput } from './speechEvents'
export { dispatchMeropeSpeech, dispatchMeropeSpeechUtterance, MEROPE_SPEECH_EVENT, meropeSpeechEventDetail } from './speechEvents'
export { alignTextProsody } from './textProsody'
export { estimateAutoSpeechDurationMs } from './textTiming'
export type { TextVisemeCue } from './textVisemes'
export { compileTextVisemes } from './textVisemes'
export type { VisemeSpan } from './visemeTimeline'
export { alignVisemeTimeline, alignVisemeTimelineToAudio, audioVoicing, textTimeOnAudio, VISEME_SILENCE_ENERGY, visemeAmount, visemeAt } from './visemeTimeline'
