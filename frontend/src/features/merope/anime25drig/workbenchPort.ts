import type { Anime25DDriver } from './driver'
import type { Anime25DDebugSnapshot } from './player'
import type { PoseCorrection } from './poseCorrections'

/** Anime2.5D-only authoring and diagnostics */
export interface Anime25DWorkbenchPort {
  previewPoseCorrections: (corrections: readonly PoseCorrection[] | null) => void
  setDriver: (partial: Partial<Anime25DDriver>) => void
  replaceDriver: (driver: Anime25DDriver) => void
  blinkNow: () => void
  debugSnapshot: () => Anime25DDebugSnapshot | null
}
