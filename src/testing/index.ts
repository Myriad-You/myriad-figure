// Fixtures and parts for tests that drive the figure from outside: synthetic
// PSDs, playback builders, the speech and touch pieces a test assembles itself.
// Not for production pages; anything here may change with the tests.

export { analyzeAnime25DMouthProfile } from '../anime25drig/mouthProfile'
export { buildAnime25DPlayback } from '../anime25drig/playback'
export { TouchGestureTracker } from '../interaction/touchGesture'
export type { MotionLeaseHandle } from '../motion/coordinator'
export { HumanPerformanceRuntime } from '../motion/humanPerformanceRuntime'
export { SpeechMotionSource } from '../motion/speechSource'
export type { Anime25DRigPsdOptions } from '../rig/anime25dImporter'
export { prepareAnime25DRigPsd } from '../rig/anime25dImporter'
export { syntheticSeeThroughPsd } from '../rig/anime25dImporter.fixture'
export { turnKeyformsFor } from '../rig/turnKeyformImport'
