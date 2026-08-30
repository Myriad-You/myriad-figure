import type { SpeechArticulation } from '../rig/articulation'
import type { RigCharacterHandle } from '../rig/RigCharacter'
import type { SingingSpectrumDrive } from '../singing/singingGroove'
import type { SingingApply } from './singingApply'
import { restSingingArticulation } from '../singing/singingClock'

export interface SingingRigWrite {
  singing: boolean
  spectrum: SingingSpectrumDrive | null
  articulation: SpeechArticulation | null
  restMouth: boolean
  speechActive: boolean | null
}

/**
 * Apply channel-gated singing to one mounted rig. Speech-owned mouth is
 * left untouched so visemes and occupancy stay with the speech controller.
 */
export function applySingingWrite(
  rig: Pick<
    RigCharacterHandle,
    | 'setSinging'
    | 'setSingingSpectrum'
    | 'setSpeechArticulation'
    | 'setSpeechActive'
  >,
  apply: SingingApply,
  drive: {
    spectrum: SingingSpectrumDrive | null
    articulation: SpeechArticulation
  },
): SingingRigWrite {
  const write: SingingRigWrite = {
    singing: apply.writeGroove,
    spectrum: apply.writeGroove ? drive.spectrum : null,
    articulation: apply.writeMouth ? drive.articulation : null,
    restMouth: apply.restMouth,
    speechActive: apply.writeMouth
      ? true
      : apply.release && apply.restMouth
        ? false
        : null,
  }
  if (apply.writeGroove) {
    rig.setSinging(true)
    rig.setSingingSpectrum(drive.spectrum)
  } else {
    rig.setSinging(false)
    rig.setSingingSpectrum(null)
  }
  if (apply.writeMouth) {
    rig.setSpeechActive(true)
    rig.setSpeechArticulation(drive.articulation)
  } else if (apply.restMouth) {
    rig.setSpeechArticulation(restSingingArticulation())
    if (apply.release) rig.setSpeechActive(false)
  }
  return write
}
