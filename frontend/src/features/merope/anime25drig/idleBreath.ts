export interface IdleBreathOffset {
  angleX: number
  angleY: number
  angleZ: number
  body: number
}

/** Phase-continuous idle sine. Mix with occupancy; never gate on authored.idle. */
export function idleBreathOffset(timeSeconds: number): IdleBreathOffset {
  const time = Number.isFinite(timeSeconds) ? timeSeconds : 0
  return {
    angleX: 0.13 * Math.sin(time * 0.42) + 0.05 * Math.sin(time * 1.13),
    angleY: 0.08 * Math.sin(time * 0.31 + 1.7),
    angleZ: 0.07 * Math.sin(time * 0.23 + 0.5),
    body: 0.1 * Math.sin(time * 0.19 + 2.1),
  }
}

export function applyIdleBreath(
  target: IdleBreathOffset,
  occupancy: number,
  timeSeconds: number,
): void {
  const amount = clamp01(occupancy)
  if (amount <= 0) return
  const breath = idleBreathOffset(timeSeconds)
  target.angleX = clamp(target.angleX + breath.angleX * amount, -1, 1)
  target.angleY = clamp(target.angleY + breath.angleY * amount, -1, 1)
  target.angleZ = clamp(target.angleZ + breath.angleZ * amount, -1, 1)
  target.body = clamp(target.body + breath.body * amount, -1, 1)
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
