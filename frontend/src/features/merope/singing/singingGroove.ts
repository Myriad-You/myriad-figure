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
 * Weight cruises side to side. Nod size comes from the live mix: vocals lift,
 * kick/bass dip, and a punch on rising beats. Turns ease instead of bouncing.
 */
export class SingingGrooveController {
  private readonly output: SingingGroovePose = { ...ZERO }
  private lastTime = Number.NaN
  private energy = 0.4
  private vocalFollow = 0
  private beatFollow = 0
  private nodPulse = 0
  private leanTarget = 0
  private leanSpeed = 0
  private leanDir = 0
  private cruise = 0.16
  private spanNow = 0.26
  private spanGoal = 0.26
  private turnAt = 0.82
  private cruiseClock = 0
  private nextCruiseAt = 0.6
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
    this.followSpectrum(dt, enabled, vocal, beat)

    if (enabled) this.driftLean(dt)
    else this.settleLean(dt)

    const pitch = enabled ? this.nodPitch() : 0
    stepSpring(this.neckZ, this.leanTarget, dt, 1.45, 1.04)
    stepSpring(this.neckX, this.leanTarget * 0.42, dt, 1.5, 1.04)
    stepSpring(this.neckY, pitch, dt, 2.25, 1.16)
    stepSpring(this.torso, this.neckZ.value * 0.55, dt, 0.95, 1.08)
    stepSpring(this.arm, 0, dt, 1.6, 0.9)

    this.output.angleX = this.neckX.value
    this.output.angleY = this.neckY.value
    this.output.angleZ = this.neckZ.value
    this.output.body = this.torso.value * 0.22
    this.output.armY = 0
    this.output.armPos = 0
    this.output.eyeX = this.neckX.value * 0.4
    this.output.brow = -this.neckY.value * 0.06
    return this.output
  }

  private followSpectrum(
    dt: number,
    enabled: boolean,
    vocal: number,
    beat: number,
  ): void {
    const vocalTarget = enabled ? vocal : 0
    const beatTarget = enabled ? beat : 0
    this.vocalFollow +=
      (vocalTarget - this.vocalFollow) * (1 - Math.exp(-1.35 * dt))
    const rise = enabled ? Math.max(0, beatTarget - this.beatFollow) : 0
    const beatRate = beatTarget > this.beatFollow ? 9 : 3.2
    this.beatFollow +=
      (beatTarget - this.beatFollow) * (1 - Math.exp(-beatRate * dt))
    this.nodPulse += rise * 14
    this.nodPulse +=
      (0 - this.nodPulse) * (1 - Math.exp(-(enabled ? 8.2 : 10) * dt))
    this.nodPulse = clamp(this.nodPulse, 0, 1)
  }

  /** Dip on rising beats, then come back up. Loud hits nod deeper. */
  private nodPitch(): number {
    const spanForNod = Math.max(this.spanNow, 0.16)
    const edge = clamp(Math.abs(this.leanTarget) / spanForNod, 0, 1)
    const lift = mix(0.16, 0.32, this.vocalFollow)
    const grooveDip = mix(0.01, 0.04, this.beatFollow)
    const hitDip = smootherstep(this.nodPulse) * mix(0.48, 0.7, this.beatFollow)
    const edgeDip = edge * mix(0.03, 0.06, this.energy)
    return clamp(lift - grooveDip - hitDip - edgeDip, -0.55, 0.32)
  }

  private driftLean(dt: number): void {
    if (this.leanDir === 0) {
      this.leanDir = this.unit() < 0.5 ? -1 : 1
      this.pickCruise()
      this.turnAt = this.mixRange(0.4, 0.96)
    }

    this.cruiseClock += dt
    if (this.cruiseClock >= this.nextCruiseAt) {
      this.cruiseClock = 0
      this.nextCruiseAt = this.mixRange(0.25, 1.1)
      this.pickCruise()
    }

    this.spanNow += (this.spanGoal - this.spanNow) * (1 - Math.exp(-0.7 * dt))
    if (Math.abs(this.spanNow - this.spanGoal) < 0.004) {
      this.spanGoal = mix(0.22, 0.3, this.energy) * mix(0.94, 1.08, this.unit())
    }

    const span = Math.max(this.spanNow, 0.16)
    const edge = Math.abs(this.leanTarget) / span
    const outward = Math.sign(this.leanTarget) === this.leanDir
    if (outward && (edge > this.turnAt || Math.abs(this.leanTarget) >= span)) {
      this.turnAround()
    }

    const slow = outward
      ? mix(1, 0.7, clamp((edge - 0.55) / 0.35, 0, 1))
      : 1
    const desired = this.leanDir * this.cruise * slow
    this.leanSpeed += (desired - this.leanSpeed) * (1 - Math.exp(-12 * dt))
    this.leanTarget = clamp(this.leanTarget + this.leanSpeed * dt, -span, span)
  }

  private settleLean(dt: number): void {
    this.leanSpeed += (0 - this.leanSpeed) * (1 - Math.exp(-2.1 * dt))
    this.leanTarget += this.leanSpeed * dt
    this.leanTarget += (0 - this.leanTarget) * (1 - Math.exp(-1.15 * dt))
  }

  private turnAround(): void {
    this.leanDir = -this.leanDir
    this.turnAt = this.mixRange(0.4, 0.96)
    this.pickCruise()
    this.cruiseClock = 0
    this.nextCruiseAt = this.mixRange(0.25, 1.1)
  }

  private pickCruise(): void {
    this.cruise = mix(0.14, 0.24, this.energy) * mix(0.82, 1.22, this.unit())
  }

  private mixRange(minimum: number, maximum: number): number {
    return mix(minimum, maximum, this.unit())
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

function smootherstep(value: number): number {
  const amount = unit(value)
  return amount * amount * amount * (amount * (amount * 6 - 15) + 10)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
