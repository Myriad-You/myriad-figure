import type { Anime25DDriver } from './driver'
import type { PoseCorrection } from './poseCorrections'
import type { Anime25DPlayback } from './types'
import { WORKBENCH_DRIVER } from './driver'
import { isPoseCorrections, poseCorrectionCornerKey } from './poseCorrections'

export const POSE_CORRECTION_REGIONS = ['leftEye', 'rightEye', 'mouth', 'chin', 'frontCrown', 'rearCrown'] as const
export type PoseCorrectionRegion = typeof POSE_CORRECTION_REGIONS[number]

export function capturePoseCorrection(playback: Anime25DPlayback, driver: Anime25DDriver, region: PoseCorrectionRegion): PoseCorrection | null {
  const at: PoseCorrection['at'] = {}
  for (const axis of ['angleX', 'angleY'] as const) {
    if (Math.abs(driver[axis]) >= 0.05) at[axis] = Math.round(driver[axis] * 100) / 100
  }
  if (region === 'leftEye' && driver.eyeOpenL <= 0.95) at.eyeCloseL = Math.round((1 - driver.eyeOpenL) * 100) / 100
  if (region === 'rightEye' && driver.eyeOpenR <= 0.95) at.eyeCloseR = Math.round((1 - driver.eyeOpenR) * 100) / 100
  if (region === 'mouth' && driver.mouthOpen >= 0.05) at.mouthOpen = Math.round(driver.mouthOpen * 100) / 100
  const head = playback.shellProfile.head
  const anchors = playback.anchors
  const eye = region === 'leftEye' ? anchors.eyeL : region === 'rightEye' ? anchors.eyeR : undefined
  if ((region === 'leftEye' || region === 'rightEye') && !eye) return null
  const crown = region === 'frontCrown' || region === 'rearCrown'
  const surface = crown ? region === 'frontCrown' ? 'front-hair' : 'back-hair' : 'head'
  if (!playback.layers.some(l => crown ? l.role === surface : l.role === 'face')) return null
  const x = eye?.icx ?? (region === 'mouth' ? anchors.mouth.cx : head.centerX)
  const y = eye?.closeY ?? (region === 'mouth' ? anchors.mouth.cy : crown ? head.centerY - head.radiusY * 0.85 : anchors.face.y1 - head.radiusY * 0.08)
  const correction: PoseCorrection = {
    surface, at,
    patches: [{ x: (x - head.centerX) / head.radiusX, y: (y - head.centerY) / head.radiusY,
      radiusX: crown ? 0.7 : 0.55, radiusY: crown ? 0.55 : 0.4, dx: 0, dy: 0 }],
  }
  return isPoseCorrections([correction]) ? correction : null
}

export function appendPoseCorrectionPatch(current: readonly PoseCorrection[], candidate: PoseCorrection): { corrections: PoseCorrection[]; index: number; patch: number } | null {
  const corrections = structuredClone(current) as PoseCorrection[]
  let index = corrections.findIndex(c => poseCorrectionCornerKey(c) === poseCorrectionCornerKey(candidate))
  if (index < 0) { index = corrections.length; corrections.push(structuredClone(candidate)) }
  else corrections[index].patches.push(...structuredClone(candidate.patches))
  return isPoseCorrections(corrections) ? { corrections, index, patch: corrections[index].patches.length - 1 } : null
}

export function poseCorrectionPreviewDriver(correction: PoseCorrection, current: Anime25DDriver = WORKBENCH_DRIVER): Anime25DDriver {
  const { eyeCloseL, eyeCloseR, ...angles } = correction.at
  return { ...current, ...angles,
    ...(eyeCloseL !== undefined ? { eyeOpenL: 1 - eyeCloseL } : {}),
    ...(eyeCloseR !== undefined ? { eyeOpenR: 1 - eyeCloseR } : {}),
    angleZ: 0, idle: false, blink: false, rand: false, talk: false, mouse: false, phys: false,
  }
}
