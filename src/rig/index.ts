// Building a rig: PSD and decomposition import, manifests, contracts and diagnostics.
// The public surface of this directory; everything else in it is internal.

export type { SpeechArticulation, SpeechViseme } from './articulation'
export type { AuthoredExpressionKind } from './authoredExpression'
export { AUTHORED_EXPRESSION_KINDS } from './authoredExpression'
export { diagnoseRig } from './diagnostics'
export { isLiveMeropeManifest, isRigManifest, sameLiveFaceRuntime } from './manifestValidation'
export type { RigMotionPort } from './motionPort'
export type { PreparedRigPsdImport, RigPsdImportOptions } from './psdImporter'
export { prepareRigPsdImport } from './psdImporter'
export type { DetectedSkeleton } from './skeleton'
export { attachTurnKeyforms, isDocumentTurnKeyforms } from './turnKeyformImport'
export type { MeropeRigImportSource, MeropeRigManifest } from './types'
