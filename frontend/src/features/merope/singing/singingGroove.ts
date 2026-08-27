import { mixBoundedExpressionChannel } from '../anime25drig/performanceExpression'
import { singingVocalEnergy } from './singingClock'

export interface SingingSpectrumDrive {
  bass: number
  beat: number
  vocal: number
}

export interface SingingGroovePose {
  angleX: number
  angleY: number
  angleZ: number
  body: number
  armY: number
  armPos: number
  eyeX: number
  brow: number
}

interface GrooveTarget {
  angleX: number
  angleY: number
  angleZ: number
  body: number
  armY: number
  armPos: number
  eyeX: number
  brow: number
}

interface Spring1 {
  value: number
  velocity: number
}

const ZERO: SingingGroovePose = {
  angleX: 0,
  angleY: 0,
  angleZ: 0,
  body: 0,
  armY: 0,
  armPos: 0,
  eyeX: 0,
  brow: 0,
}

export function singingSpectrumDrive(
  bands: readonly number[],
): SingingSpectrumDrive {
  const bass = unit(bands[0])
  const low = unit(bands[1])
  return {
    bass,
    beat: unit(bass * 0.62 + low * 0.38),
    vocal: singingVocalEnergy(bands),
  }
}

export function singingDriveAmount(drive: SingingSpectrumDrive): number {
  return unit(Math.max(drive.beat, drive.vocal * 0.92))
}

/**
 * Weight cruises side to side and eases around at the outside.
 * Instantly flipping speed at the wall reads as a shake.
 */
export class SingingGrooveController {
  private readonly output: SingingGroovePose = { ...ZERO }
  private lastTime = Number.NaN
  private energy = 0.4
  private leanTarget = 0
  private leanSpeed = 0
  private leanDir = 0
  private cruise = 0.034
  private spanNow = 0.18
  private spanGoal = 0.18
  private readonly neckX: Spring1 = { value: 0, velocity: 0 }
  private readonly neckZ: Spring1 = { value: 0, velocity: 0 }
  private readonly neckY: Spring1 = { value: 0, velocity: 0 }
  private readonly torso: Spring1 = { value: 0, velocity: 0 }
  private readonly arm: Spring1 = { value: 0, velocity: 0 }
  private weyl = 0.41

  sample(
    timeSeconds: number,
    enabled: boolean,
    drive: SingingSpectrumDrive | null,
  ): Readonly<SingingGroovePose> {
    const now = Number.isFinite(timeSeconds) ? Math.max(0, timeSeconds) : 0
    const dt = Number.isFinite(this.lastTime)
      ? clamp(now - this.lastTime, 0, 0.08)
      : 1 / 60
    this.lastTime = now
    const vocal = unit(drive?.vocal)
    const beat = unit(drive?.beat)
    this.energy +=
      ((enabled ? Math.max(vocal, beat * 0.4, 0.32) : 0) - this.energy) *
      (1 - Math.exp(-1.6 * dt))

    if (enabled) this.driftLean(dt)
    else this.settleLean(dt)

    const nod = enabled
      ? mix(0.4, 0.56, this.energy) + Math.abs(this.leanTarget) * 0.12
      : 0
    // Overdamped so the neck does not ring when weight turns around.
    stepSpring(this.neckZ, this.leanTarget, dt, 0.88, 1.05)
    stepSpring(this.neckX, this.leanTarget * 0.42, dt, 0.92, 1.05)
    stepSpring(this.neckY, nod, dt, 0.78, 1.02)
    stepSpring(this.torso, this.neckZ.value * 0.55, dt, 0.58, 1.1)
    stepSpring(this.arm, 0, dt, 1.6, 0.9)

    this.output.angleX = this.neckX.value
    this.output.angleY = this.neckY.value
    this.output.angleZ = this.neckZ.value
    // A little delayed weight, not a second shoulder swing.
    this.output.body = this.torso.value * 0.22
    this.output.armY = 0
    this.output.armPos = 0
    this.output.eyeX = this.neckX.value * 0.4
    this.output.brow = -this.neckY.value * 0.06
    return this.output
  }

  private driftLean(dt: number): void {
    if (this.leanDir === 0) this.leanDir = this.unit() < 0.5 ? -1 : 1

    this.spanNow += (this.spanGoal - this.spanNow) * (1 - Math.exp(-0.45 * dt))
    if (Math.abs(this.spanNow - this.spanGoal) < 0.003) {
      this.spanGoal = mix(0.14, 0.23, this.energy) * mix(0.88, 1.12, this.unit())
    }

    const span = Math.max(this.spanNow, 0.08)
    const edge = Math.abs(this.leanTarget) / span
    const outward = Math.sign(this.leanTarget) === this.leanDir
    if (outward && (edge > 0.86 || Math.abs(this.leanTarget) >= span)) {
      this.turnAround()
    }

    const slow = outward
      ? mix(1, 0.55, clamp((edge - 0.5) / 0.36, 0, 1))
      : 1
    const desired = this.leanDir * this.cruise * slow
    this.leanSpeed += (desired - this.leanSpeed) * (1 - Math.exp(-7 * dt))
    this.leanTarget = clamp(this.leanTarget + this.leanSpeed * dt, -span, span)
  }

  private settleLean(dt: number): void {
    this.leanSpeed += (0 - this.leanSpeed) * (1 - Math.exp(-2.1 * dt))
    this.leanTarget += this.leanSpeed * dt
    this.leanTarget += (0 - this.leanTarget) * (1 - Math.exp(-1.15 * dt))
  }

  private turnAround(): void {
    this.leanDir = -this.leanDir
    this.cruise = mix(0.026, 0.042, this.energy) * mix(0.86, 1.16, this.unit())
  }

  private unit(): number {
    this.weyl = (this.weyl + 0.6180339887) % 1
    return this.weyl
  }
}

export function applySingingGroove(
  target: GrooveTarget,
  pose: Readonly<SingingGroovePose>,
  amount: number,
): void {
  const scale = clamp(finiteOrZero(amount), 0, 1)
  if (scale <= 0) return
  target.angleX = mixChannel(target.angleX, pose.angleX, scale)
  target.angleY = mixChannel(target.angleY, pose.angleY, scale)
  target.angleZ = mixChannel(target.angleZ, pose.angleZ, scale)
  target.body = mixChannel(target.body, pose.body, scale)
  target.armY = mixChannel(target.armY, pose.armY, scale)
  target.armPos = mixChannel(target.armPos, pose.armPos, scale)
  target.eyeX = mixChannel(target.eyeX, pose.eyeX, scale)
  target.brow = mixChannel(target.brow, pose.brow, scale)
}

function stepSpring(
  state: Spring1,
  target: number,
  dt: number,
  frequencyHz: number,
  dampingRatio: number,
): void {
  if (dt <= 0) return
  let remain = dt
  const omega = Math.PI * 2 * frequencyHz
  while (remain > 0) {
    const step = Math.min(1 / 90, remain)
    const accel =
      -(omega * omega) * (state.value - target) -
      2 * dampingRatio * omega * state.velocity
    state.velocity += accel * step
    state.value += state.velocity * step
    remain -= step
  }
}

function mixChannel(base: number, offset: number, scale: number): number {
  return mixBoundedExpressionChannel(base, offset * scale, -1, 1, 0)
}

function unit(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * unit(amount)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
