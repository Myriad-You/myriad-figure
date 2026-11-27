// Building a rig: PSD and decomposition import, manifests, contracts and diagnostics.
// The public surface of this directory; everything else in it is internal.

export type { ArmVariantGesture } from './armVariants'
export { ARM_VARIANT_GESTURES } from './armVariants'
export type { SpeechArticulation, SpeechViseme } from './articulation'
export { diagnoseRig } from './diagnostics'
export type { RigMotionPort } from './motionPort'
export type { ArmVariantSource } from './psdImportClient'
export type { PreparedRigPsdImport, RigPsdImportOptions } from './psdImporter'
export { prepareRigPsdImport } from './psdImporter'
export type { DetectedSkeleton } from './skeleton'
export { attachTurnKeyforms } from './turnKeyformImport'
export type { MeropeRigManifest } from '@myriad-you/figure-player'
export type { AuthoredExpressionKind } from '@myriad-you/figure-player/contract'
export { AUTHORED_EXPRESSION_KINDS } from '@myriad-you/figure-player/contract'
export { isLiveMeropeManifest, isRigManifest, sameLiveFaceRuntime } from '@myriad-you/figure-player/contract'
export { isDocumentTurnKeyforms } from '@myriad-you/figure-player/contract'
export type { MeropeRigImportSource } from '@myriad-you/figure-player/contract'
