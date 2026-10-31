// Motion scheduling: the coordinator, the runtime and its sources, and how a frame reaches a rig.
// The public surface of this directory; everything else in it is internal.

export { applyMotionFrame, createMotionApplyState } from './applyFrame'
export type { RigBearing } from './bearing'
export type { BehaviorPlan } from './behavior'
export { RigMotionCoordinator } from './coordinator'
export type { MusicMotionAudio, MusicMotionClock, MusicMotionVisibility } from './musicSource'
export { MusicMotionSource } from './musicSource'
export type { MotionChannelPolicy } from './policy'
export { captureRigStateSummary } from './rigStateSummary'
export type { LiveFaceConsumer } from './runtime'
export { createLiveMotionRuntime, createPreviewMotionRuntime, MotionRuntime } from './runtime'
export type { ResolvedScore } from './scoreTimeline'
export { TouchMotionSource } from './touchSource'
