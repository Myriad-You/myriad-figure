// The 2.5D player and what a live page needs around it: playback data, speech and
// activity driver patches, when to run it, and the port a workbench edits it through.
// The public surface of this directory; everything else in it is internal.

export type { Anime25DArmCue, Anime25DArmScore, Anime25DArmScoreFrame, Anime25DBodyCue } from './armScore'
export { armScoreAt } from './armScore'
export { realizeAnime25DBehaviorPlan } from './behaviorRealizer'
export { activityExpressionDriverPatch } from './expressionPresets'
export { idleSpeechDriverPatch } from './performanceMotion'
export { Anime25DPlayer } from './player'
export { anime25DRuntimeKey, intersectionKeepsAnime25DVisible, shouldAnimateAnime25D, shouldUseAnime25DRuntime } from './runtimePolicy'
export { speechArticulationDriverPatch, speechEnergyDriverPatch } from './speechDriver'
export type { Anime25DWorkbenchPort } from './workbenchPort'
export type { Anime25DArmAim } from '@myriad-you/figure-player'
export type { Anime25DPose } from '@myriad-you/figure-player'
export { blendPoses, poseFromJSON, poseToJSON } from '@myriad-you/figure-player'
export type { Anime25DPlayback, Anime25DPlaybackDocument, Anime25DPlaybackV7 } from '@myriad-you/figure-player'
export { isAnime25DPlayback, readAnime25DPlayback, writeAnime25DPlayback } from '@myriad-you/figure-player'
export type { PoseCorrection } from '@myriad-you/figure-player/workbench'
