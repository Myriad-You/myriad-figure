// Music as the body hears it: audio features, lyrics and the music signal.
// The public surface of this directory; everything else in it is internal.

export type { MotionAudioFeatures } from './audioMotionAnalysis'
export { analyzeMotionAudio } from './audioMotionAnalysis'
export type { LyricLine, WordLyricLine, WordLyricToken } from './lyrics'
export type { MusicMotionSignal } from './musicSignal'
