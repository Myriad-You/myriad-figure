// The head roll a director's tilt asks for, as the driver's headRoll.
import { HEAD_ROLL_RADIANS, HEAD_TILT_RADIANS } from '@myriad/figure-player/internals'

const HEAD_TILT_KNEE = 0.45

/** The driver's `headRoll` that rolls the head by `radians` (headRollRadians undone), up to the full tilt. */
export function headRollForRadians(radians: number): number {
  const roll = Math.min(HEAD_TILT_RADIANS, Math.abs(radians))
  const knee = HEAD_TILT_KNEE * HEAD_ROLL_RADIANS
  if (roll <= knee) return Math.sign(radians) * roll / HEAD_ROLL_RADIANS
  // roll = knee + linear·p + curve·p², p the share of the way past the knee.
  const linear = (1 - HEAD_TILT_KNEE) * HEAD_ROLL_RADIANS
  const curve = HEAD_TILT_RADIANS - HEAD_ROLL_RADIANS
  const past = (-linear + Math.sqrt(linear * linear + 4 * curve * (roll - knee))) / (2 * curve)
  return Math.sign(radians) * (HEAD_TILT_KNEE + (1 - HEAD_TILT_KNEE) * past)
}
