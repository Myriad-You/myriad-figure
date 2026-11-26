import type { Anime25DDriver } from '@myriad-you/figure-player'

type ActivityExpressionDriver = Pick<
  Anime25DDriver,
  | 'headYaw'
  | 'headPitch'
  | 'headRoll'
  | 'lidL'
  | 'lidR'
  | 'eyeDizzy'
  | 'eyeSqueeze'
  | 'eyeCry'
  | 'anger'
  | 'speechless'
  | 'maniac'
  | 'silly'
  | 'lovestruck'
  | 'gazeX'
  | 'gazeY'
  | 'irisScale'
  | 'browLift'
  | 'browTiltL'
  | 'browTiltR'
  | 'browTilt'
>

const NEUTRAL_ACTIVITY_EXPRESSION: Readonly<ActivityExpressionDriver> = {
  headYaw: 0,
  headPitch: 0,
  headRoll: 0,
  lidL: 1,
  lidR: 1,
  eyeDizzy: 0,
  eyeSqueeze: 0,
  eyeCry: 0,
  anger: 0,
  speechless: 0,
  maniac: 0,
  silly: 0,
  lovestruck: 0,
  gazeX: 0,
  gazeY: 0,
  irisScale: 1,
  browLift: 0,
  browTiltL: 0,
  browTiltR: 0,
  browTilt: 0,
}

export const THINKING_ACTIVITY_EXPRESSION: Readonly<ActivityExpressionDriver> =
  {
    headYaw: -0.12,
    headPitch: 0.1,
    headRoll: -0.18,
    lidL: 0.78,
    lidR: 0.9,
    eyeDizzy: 0,
    eyeSqueeze: 0,
    eyeCry: 0,
    anger: 0,
    speechless: 0,
    maniac: 0,
    silly: 0,
    lovestruck: 0,
    gazeX: 0.58,
    gazeY: -0.42,
    irisScale: 0.94,
    browLift: 0.24,
    browTiltL: 0.48,
    browTiltR: -0.12,
    browTilt: 0,
  }

export const DIZZY_EXPRESSION_PRESET: Readonly<Partial<Anime25DDriver>> = {
  eyeDizzy: 1,
}

export const SQUEEZE_EXPRESSION_PRESET: Readonly<Partial<Anime25DDriver>> = {
  eyeSqueeze: 1,
}

export const CRY_EXPRESSION_PRESET: Readonly<Partial<Anime25DDriver>> = {
  eyeCry: 1,
  browLift: 0.28,
  browTilt: -0.34,
}

export const ANGRY_EXPRESSION_PRESET: Readonly<Partial<Anime25DDriver>> = {
  anger: 1,
  speechless: 0,
}

export const SPEECHLESS_EXPRESSION_PRESET: Readonly<Partial<Anime25DDriver>> = {
  anger: 0,
  speechless: 1,
}

export const MANIAC_EXPRESSION_PRESET: Readonly<Partial<Anime25DDriver>> = {
  anger: 0,
  speechless: 0,
  maniac: 1,
  lidL: 1,
  lidR: 0.94,
}

export const SILLY_EXPRESSION_PRESET: Readonly<Partial<Anime25DDriver>> = {
  anger: 0,
  speechless: 0,
  maniac: 0,
  silly: 1,
}

export const LOVESTRUCK_EXPRESSION_PRESET: Readonly<Partial<Anime25DDriver>> = {
  anger: 0,
  speechless: 0,
  maniac: 0,
  silly: 0,
  lovestruck: 1,
  lidL: 1,
  lidR: 1,
}

export const THINKING_EXPRESSION_PRESET: Readonly<Partial<Anime25DDriver>> = {
  ...THINKING_ACTIVITY_EXPRESSION,
  thinking: true,
  headYaw: -0.15,
  headPitch: 0.12,
  headRoll: -0.22,
  gazeX: 0.68,
  gazeY: -0.48,
  jaw: 0,
  lipCurve: -0.16,
}

export function activityExpressionDriverPatch(
  thinking: boolean,
): Readonly<ActivityExpressionDriver> {
  return thinking ? THINKING_ACTIVITY_EXPRESSION : NEUTRAL_ACTIVITY_EXPRESSION
}

type ThinkingExpressionKey = keyof ActivityExpressionDriver | 'lipCurve'
const THINKING_EXPRESSION_KEYS: readonly ThinkingExpressionKey[] = [
  ...Object.keys(THINKING_ACTIVITY_EXPRESSION) as (keyof ActivityExpressionDriver)[],
  'lipCurve',
]

/** Ownership follows writes, never numeric coincidence with a preset. */
export class ThinkingExpressionOwnership {
  private readonly previous = new Map<ThinkingExpressionKey, number>()

  apply(target: Anime25DDriver, patch: Partial<Anime25DDriver>, speaking: boolean): void {
    if (patch.thinking === false) this.release(target)
    for (const key of THINKING_EXPRESSION_KEYS) {
      if (!Object.hasOwn(patch, key)) continue
      if (patch.thinking === true) {
        if (!this.previous.has(key)) this.previous.set(key, target[key])
      } else {
        // Even writing the same number is an explicit takeover.
        this.previous.delete(key)
      }
    }
    Object.assign(target, patch)
    if (speaking) this.release(target)
  }

  release(target: Anime25DDriver): void {
    for (const [key, value] of this.previous) target[key] = value
    this.previous.clear()
    target.thinking = false
  }

  clear(): void { this.previous.clear() }
}
