import {
  mixBoundedExpressionChannel,
  mixEyeOpen,
} from './performanceExpression'

export type RandomActionEnergy = 'idle' | 'excited'

export type RandomActionName =
  | 'acknowledge'
  | 'curious'
  | 'openGesture'
  | 'pleased'
  | 'beam'
  | 'sparkle'
  | 'glance'
  | 'cheer'
  | 'dreamy'
  | 'coy'
  | 'smug'
  | 'squint'

export interface RandomActionFrame {
  angleX: number
  angleY: number
  angleZ: number
  body: number
  eyeX: number
  eyeY: number
  brow: number
  browAngSym: number
  eyeOpen: number
  irisScale: number
  armY: number
  armPos: number
  ambientScale: number
}

interface RandomActionTarget {
  angleX: number
  angleY: number
  angleZ: number
  body: number
  eyeX: number
  eyeY: number
  brow: number
  browAngSym: number
  eyeOpenL: number
  eyeOpenR: number
  irisScale: number
  armY: number
  armPos: number
}

interface ActionDefinition {
  name: RandomActionName
  minimumDuration: number
  maximumDuration: number
  weight?: number
}

type RandomSource = () => number

const IDLE_ACTIONS: readonly ActionDefinition[] = [
  { name: 'acknowledge', minimumDuration: 1.45, maximumDuration: 1.75 },
  { name: 'curious', minimumDuration: 2, maximumDuration: 2.55 },
  { name: 'openGesture', minimumDuration: 2, maximumDuration: 2.5 },
  { name: 'pleased', minimumDuration: 1.8, maximumDuration: 2.3, weight: 2.4 },
]

const EXCITED_ACTIONS: readonly ActionDefinition[] = [
  { name: 'beam', minimumDuration: 1.05, maximumDuration: 1.55, weight: 3.2 },
  {
    name: 'sparkle',
    minimumDuration: 0.85,
    maximumDuration: 1.35,
    weight: 2.4,
  },
  { name: 'glance', minimumDuration: 0.8, maximumDuration: 1.25, weight: 0.7 },
  { name: 'cheer', minimumDuration: 1.15, maximumDuration: 1.7, weight: 3.2 },
  { name: 'dreamy', minimumDuration: 1.1, maximumDuration: 1.7, weight: 0.7 },
  { name: 'coy', minimumDuration: 0.9, maximumDuration: 1.4, weight: 2.2 },
  { name: 'smug', minimumDuration: 0.95, maximumDuration: 1.45, weight: 1.6 },
  { name: 'squint', minimumDuration: 0.7, maximumDuration: 1.15, weight: 0.6 },
]

const NEUTRAL_FRAME: RandomActionFrame = {
  angleX: 0,
  angleY: 0,
  angleZ: 0,
  body: 0,
  eyeX: 0,
  eyeY: 0,
  brow: 0,
  browAngSym: 0,
  eyeOpen: 0,
  irisScale: 0,
  armY: 0,
  armPos: 0,
  ambientScale: 1,
}

const RELEASE_DURATION = 0.32

/**
 * Plays complete, low-frequency idle action clips independently from ambient
 * gaze. The output object is reused so this adds no per-frame allocations.
 */
export class RandomActionController {
  private readonly output: RandomActionFrame = { ...NEUTRAL_FRAME }
  private readonly actionFrom: RandomActionFrame = { ...NEUTRAL_FRAME }
  private readonly releaseFrom: RandomActionFrame = { ...NEUTRAL_FRAME }
  private initialized = false
  private available = false
  private activeIndex = -1
  private lastIndex = -1
  private actionStartedAt = 0
  private actionDuration = 1
  private actionDirection = 1
  private actionIntensity = 1
  private nextActionAt = Number.POSITIVE_INFINITY
  private releaseStartedAt = 0
  private releasing = false
  private energy: RandomActionEnergy = 'idle'
  private drive = 1

  constructor(private readonly random: RandomSource = Math.random) {}

  sample(
    timeSeconds: number,
    enabled: boolean,
    blocked: boolean,
    energy: RandomActionEnergy = 'idle',
    drive = 1,
  ): Readonly<RandomActionFrame> {
    const now = finiteTime(timeSeconds)
    this.drive = clamp(Number.isFinite(drive) ? drive : 1, 0, 1)
    const available = enabled && !blocked
    if (!this.initialized) {
      this.initialized = true
      this.available = available
      this.energy = energy
      if (available) this.scheduleFirstAction(now)
    }

    if (energy !== this.energy) {
      if (this.activeIndex >= 0) {
        this.resolveAction(now)
        this.beginRelease(now)
      }
      this.energy = energy
      this.lastIndex = -1
      if (available) this.scheduleFirstAction(now)
    }

    if (!available) {
      if (this.activeIndex >= 0) {
        this.resolveAction(now)
        this.beginRelease(now)
      }
      this.available = false
      this.nextActionAt = Number.POSITIVE_INFINITY
      return this.resolveRelease(now)
    }

    if (!this.available) {
      this.available = true
      this.scheduleFirstAction(now)
    }

    if (this.releasing) this.resolveRelease(now)
    if (this.activeIndex >= 0) {
      if (now < this.actionStartedAt + this.actionDuration) {
        return this.resolveAction(now)
      }
      this.activeIndex = -1
      if (this.energy !== 'excited') writeNeutral(this.output)
    }

    if (now >= this.nextActionAt) {
      this.beginAction(now)
      return this.resolveAction(now)
    }
    return this.output
  }

  getActiveAction(): RandomActionName | null {
    return this.activeIndex >= 0
      ? (this.catalog()[this.activeIndex]?.name ?? null)
      : null
  }

  private catalog(): readonly ActionDefinition[] {
    return this.energy === 'excited' ? EXCITED_ACTIONS : IDLE_ACTIONS
  }

  private scheduleFirstAction(now: number): void {
    this.nextActionAt =
      now +
      (this.energy === 'excited'
        ? this.randomRange(0.28, 0.8)
        : this.randomRange(1.2, 2))
  }

  private beginAction(now: number): void {
    this.releasing = false
    this.activeIndex = this.nextActionIndex()
    this.lastIndex = this.activeIndex
    const actions = this.catalog()
    const action = actions[this.activeIndex] ?? actions[0]
    this.actionStartedAt = now
    this.actionDuration = this.randomRange(
      action.minimumDuration,
      action.maximumDuration,
    )
    this.actionDirection = this.randomUnit() < 0.5 ? -1 : 1
    this.actionIntensity =
      this.energy === 'excited'
        ? this.randomRange(0.78, 1) * mix(0.62, 1.12, this.drive)
        : this.randomRange(0.9, 1.08)
    this.nextActionAt =
      now +
      this.actionDuration +
      (this.energy === 'excited'
        ? this.randomRange(0.45, 1.15)
        : this.randomRange(3.8, 6.5))
    if (this.energy === 'excited') {
      copyFrame(this.actionFrom, this.output)
    } else {
      writeNeutral(this.output)
    }
  }

  private nextActionIndex(): number {
    const actions = this.catalog()
    if (actions.length <= 1) return 0
    let total = 0
    for (let index = 0; index < actions.length; index += 1) {
      if (index === this.lastIndex) continue
      total += actionWeight(actions[index])
    }
    let pick = this.randomUnit() * total
    for (let index = 0; index < actions.length; index += 1) {
      if (index === this.lastIndex) continue
      pick -= actionWeight(actions[index])
      if (pick <= 0) return index
    }
    return this.lastIndex === 0 ? 1 : 0
  }

  private resolveAction(now: number): Readonly<RandomActionFrame> {
    const action = this.catalog()[this.activeIndex]
    if (!action) return this.output
    const progress = clamp(
      (now - this.actionStartedAt) / this.actionDuration,
      0,
      1,
    )
    const hold = this.energy === 'excited'
    const motion = stagedEnvelope(progress, hold ? 0.3 : 0.2, hold ? 1 : 0.68)
    const face = stagedEnvelope(progress, hold ? 0.26 : 0.16, hold ? 1 : 0.7)
    const gesture = stagedEnvelope(
      progress,
      hold ? 0.32 : 0.24,
      hold ? 1 : 0.66,
    )
    const direction = this.actionDirection
    const intensity = this.actionIntensity
    writeNeutral(this.output)

    switch (action.name) {
      case 'acknowledge': {
        const nod = nodCurve(progress)
        this.output.angleY = 0.22 * nod * intensity
        this.output.angleZ = direction * 0.035 * motion * intensity
        this.output.body = 0.055 * motion * intensity
        this.output.brow = 0.12 * face * intensity
        this.output.eyeOpen = -0.11 * face * intensity
        this.output.ambientScale = 1 - 0.58 * Math.max(motion, nod)
        break
      }
      case 'curious':
        this.output.angleX = direction * 0.08 * motion * intensity
        this.output.angleY = -0.055 * motion * intensity
        this.output.angleZ = direction * 0.2 * motion * intensity
        this.output.body = -direction * 0.09 * motion * intensity
        this.output.brow = 0.18 * face * intensity
        this.output.browAngSym = direction * 0.1 * face * intensity
        this.output.eyeOpen = -0.055 * face * intensity
        this.output.irisScale = -0.035 * face * intensity
        this.output.armY = 0.08 * gesture * intensity
        this.output.armPos = -0.03 * gesture * intensity
        this.output.ambientScale = 1 - 0.7 * motion
        break
      case 'openGesture':
        this.output.angleX = direction * 0.06 * motion * intensity
        this.output.angleY = -0.07 * motion * intensity
        this.output.angleZ = -direction * 0.08 * motion * intensity
        this.output.body = direction * 0.13 * motion * intensity
        this.output.brow = 0.14 * face * intensity
        this.output.eyeOpen = -0.1 * face * intensity
        this.output.irisScale = 0.012 * face * intensity
        this.output.armY = 0.32 * gesture * intensity
        this.output.armPos = -0.1 * gesture * intensity
        this.output.ambientScale = 1 - 0.72 * motion
        break
      case 'pleased':
        this.output.angleX = direction * 0.04 * motion * intensity
        this.output.angleY = 0.03 * motion * intensity
        this.output.angleZ = direction * 0.14 * motion * intensity
        this.output.body = -direction * 0.06 * motion * intensity
        this.output.brow = 0.18 * face * intensity
        this.output.browAngSym = -0.08 * face * intensity
        this.output.eyeOpen = -0.42 * face * intensity
        this.output.irisScale = 0.02 * face * intensity
        this.output.armY = 0.12 * gesture * intensity
        this.output.armPos = -0.04 * gesture * intensity
        this.output.ambientScale = 1 - 0.64 * motion
        break
      case 'beam':
        this.output.brow = 0.3 * face * intensity
        this.output.browAngSym = -0.07 * face * intensity
        this.output.eyeOpen = -0.24 * face * intensity
        this.output.irisScale = 0.028 * face * intensity
        this.output.ambientScale = 1 - 0.08 * face
        break
      case 'sparkle':
        this.output.brow = 0.34 * face * intensity
        this.output.eyeOpen = 0.18 * face * intensity
        this.output.irisScale = 0.05 * face * intensity
        this.output.ambientScale = 1 - 0.08 * face
        break
      case 'glance':
        this.output.brow = 0.16 * face * intensity
        this.output.browAngSym = direction * 0.09 * face * intensity
        this.output.eyeOpen = -0.05 * face * intensity
        this.output.ambientScale = 1 - 0.08 * face
        break
      case 'cheer':
        this.output.brow = 0.36 * face * intensity
        this.output.browAngSym = -0.1 * face * intensity
        this.output.eyeOpen = 0.14 * face * intensity
        this.output.irisScale = 0.045 * face * intensity
        this.output.ambientScale = 1 - 0.08 * face
        break
      case 'dreamy':
        this.output.eyeOpen = -0.2 * face * intensity
        this.output.irisScale = 0.045 * face * intensity
        this.output.brow = 0.14 * face * intensity
        this.output.ambientScale = 1 - 0.07 * face
        break
      case 'coy':
        this.output.eyeOpen = -0.14 * face * intensity
        this.output.brow = 0.12 * face * intensity
        this.output.browAngSym = direction * 0.08 * face * intensity
        this.output.ambientScale = 1 - 0.07 * face
        break
      case 'smug':
        this.output.brow = 0.1 * face * intensity
        this.output.browAngSym = direction * 0.12 * face * intensity
        this.output.eyeOpen = -0.18 * face * intensity
        this.output.irisScale = 0.02 * face * intensity
        this.output.ambientScale = 1 - 0.07 * face
        break
      case 'squint':
        this.output.eyeOpen = -0.34 * face * intensity
        this.output.brow = 0.22 * face * intensity
        this.output.irisScale = -0.02 * face * intensity
        this.output.ambientScale = 1 - 0.08 * face
        break
    }
    if (this.energy === 'excited') {
      this.blendFromPrevious(smootherstep(progress / 0.34))
    }
    return this.output
  }

  private blendFromPrevious(amount: number): void {
    if (amount >= 1) return
    for (const key of ACTION_OFFSET_KEYS) {
      this.output[key] = mix(this.actionFrom[key], this.output[key], amount)
    }
    this.output.ambientScale = mix(
      this.actionFrom.ambientScale,
      this.output.ambientScale,
      amount,
    )
  }

  private beginRelease(now: number): void {
    copyFrame(this.releaseFrom, this.output)
    this.activeIndex = -1
    this.releaseStartedAt = now
    this.releasing = true
  }

  private resolveRelease(now: number): Readonly<RandomActionFrame> {
    if (!this.releasing) {
      writeNeutral(this.output)
      return this.output
    }
    const progress = smootherstep(
      (now - this.releaseStartedAt) / RELEASE_DURATION,
    )
    for (const key of ACTION_OFFSET_KEYS) {
      this.output[key] = this.releaseFrom[key] * (1 - progress)
    }
    this.output.ambientScale = mix(this.releaseFrom.ambientScale, 1, progress)
    if (progress >= 1) {
      this.releasing = false
      writeNeutral(this.output)
    }
    return this.output
  }

  private randomRange(minimum: number, maximum: number): number {
    return minimum + (maximum - minimum) * this.randomUnit()
  }

  private randomUnit(): number {
    const value = this.random()
    return Number.isFinite(value) ? clamp(value, 0, 1) : 0.5
  }
}

function actionWeight(action: ActionDefinition): number {
  const weight = action.weight
  if (weight == null || !Number.isFinite(weight) || weight <= 0) return 1
  return weight
}

const ACTION_OFFSET_KEYS = [
  'angleX',
  'angleY',
  'angleZ',
  'body',
  'eyeX',
  'eyeY',
  'brow',
  'browAngSym',
  'eyeOpen',
  'irisScale',
  'armY',
  'armPos',
] as const

/** Composes only the channels owned by a finite random action clip. */
export function applyRandomActionFrame(
  target: RandomActionTarget,
  frame: Readonly<RandomActionFrame>,
  scale = 1,
): void {
  const amount = clamp(finiteOrZero(scale), 0, 1)
  target.angleX = mixChannel(target.angleX, frame.angleX, amount)
  target.angleY = mixChannel(target.angleY, frame.angleY, amount)
  target.angleZ = mixChannel(target.angleZ, frame.angleZ, amount)
  target.body = mixChannel(target.body, frame.body, amount)
  target.eyeX = mixChannel(target.eyeX, frame.eyeX, amount)
  target.eyeY = mixChannel(target.eyeY, frame.eyeY, amount)
  target.brow = mixChannel(target.brow, frame.brow, amount)
  target.browAngSym = mixChannel(target.browAngSym, frame.browAngSym, amount)
  target.eyeOpenL = mixEyeOpen(target.eyeOpenL, frame.eyeOpen * amount)
  target.eyeOpenR = mixEyeOpen(target.eyeOpenR, frame.eyeOpen * amount)
  target.irisScale = mixBoundedExpressionChannel(
    target.irisScale,
    frame.irisScale * amount,
    0.5,
    1.3,
    1,
  )
  target.armY = mixChannel(target.armY, frame.armY, amount)
  target.armPos = mixChannel(target.armPos, frame.armPos, amount)
}

function mixChannel(base: number, offset: number, scale: number): number {
  return mixBoundedExpressionChannel(base, offset * scale, -1, 1, 0)
}

function nodCurve(progress: number): number {
  if (progress < 0.24) return smootherstep(progress / 0.24)
  if (progress < 0.44)
    return mix(1, 0.16, smootherstep((progress - 0.24) / 0.2))
  if (progress < 0.64)
    return mix(0.16, 0.72, smootherstep((progress - 0.44) / 0.2))
  return mix(0.72, 0, smootherstep((progress - 0.64) / 0.36))
}

function stagedEnvelope(
  progress: number,
  enterEnd: number,
  exitStart: number,
): number {
  if (progress < enterEnd) return smootherstep(progress / enterEnd)
  if (progress <= exitStart) return 1
  return 1 - smootherstep((progress - exitStart) / (1 - exitStart))
}

function copyFrame(
  target: RandomActionFrame,
  source: Readonly<RandomActionFrame>,
): void {
  for (const key of ACTION_OFFSET_KEYS) target[key] = source[key]
  target.ambientScale = source.ambientScale
}

function writeNeutral(target: RandomActionFrame): void {
  for (const key of ACTION_OFFSET_KEYS) target[key] = 0
  target.ambientScale = 1
}

function smootherstep(value: number): number {
  const bounded = clamp(value, 0, 1)
  return bounded * bounded * bounded * (bounded * (bounded * 6 - 15) + 10)
}

function finiteTime(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
