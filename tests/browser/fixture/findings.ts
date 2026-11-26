import type { PreparedRigPsdImport } from '../../../src/rig/psdImporter'

/** What an import found against the portrait, and where it framed the figure: all it gives besides the rig and the pictures. */
export function findingsOf({ partCount, reconciliation, motionExposure, documentFrame }: PreparedRigPsdImport) {
  return { partCount, reconciliation, motionExposure, documentFrame }
}
