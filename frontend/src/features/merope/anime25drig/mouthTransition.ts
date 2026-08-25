export type SpeechMouthMaterial =
  | 'mouthClose'
  | 'mouthOpen'
  | 'mouthWide'
  | 'mouthRound'
  | 'mouthNarrow'

export interface MouthTransitionInput {
  mouthOpen: number
  mouthWide: number
  mouthRound: number
  mouthNarrow: number
  mouthSeal: number
  mouthEase: number
}

export interface MouthTransitionSample {
  material: SpeechMouthMaterial
  from: SpeechMouthMaterial
  to: SpeechMouthMaterial
  bridge: number
  widthScale: number
  heightScale: number
  shapeNeutralization: number
}

const MATERIALS: readonly SpeechMouthMaterial[] = [
  'mouthClose',
  'mouthOpen',
  'mouthWide',
  'mouthRound',
  'mouthNarrow',
]

interface BridgeProfile {
  width: number
  height: number
  neutralization: number
  switchMargin: number
}

const DEFAULT_BRIDGE: BridgeProfile = {
  width: 0.98,
  height: 0.94,
  neutralization: 0.3,
  switchMargin: 0.08,
}

/**
 * Chooses one visible raster mouth while preserving a continuous shared mesh.
 * The two strongest visemes form a dominance bridge, so a texture swap lands
 * near their common pose instead of at an arbitrary global threshold.
 */
export class MouthTransitionController {
  private readonly scores = new Float32Array(MATERIALS.length)
  private readonly output: MouthTransitionSample = {
    material: 'mouthClose',
    from: 'mouthClose',
    to: 'mouthClose',
    bridge: 0,
    widthScale: 1,
    heightScale: 1,
    shapeNeutralization: 0,
  }
  private activeIndex = 0

  sample(input: MouthTransitionInput): Readonly<MouthTransitionSample> {
    resolveMouthMaterialScores(input, this.scores)
    let strongest = 0
    let runnerUp = 1
    if (this.scores[runnerUp] > this.scores[strongest]) {
      strongest = 1
      runnerUp = 0
    }
    for (let index = 2; index < this.scores.length; index += 1) {
      if (this.scores[index] > this.scores[strongest]) {
        runnerUp = strongest
        strongest = index
      } else if (this.scores[index] > this.scores[runnerUp]) {
        runnerUp = index
      }
    }

    const profile = bridgeProfile(MATERIALS[strongest], MATERIALS[runnerUp])
    const switchProfile = bridgeProfile(
      MATERIALS[strongest],
      MATERIALS[this.activeIndex],
    )
    if (
      strongest !== this.activeIndex &&
      this.scores[strongest] >
        this.scores[this.activeIndex] + switchProfile.switchMargin
    ) {
      this.activeIndex = strongest
    }

    const strongestScore = this.scores[strongest]
    const runnerUpScore = this.scores[runnerUp]
    const pairTotal = strongestScore + runnerUpScore
    const balance =
      pairTotal > 1e-5
        ? 1 - Math.abs(strongestScore - runnerUpScore) / pairTotal
        : 0
    const bridge = smootherstep((balance - 0.28) / 0.72)

    this.output.material = MATERIALS[this.activeIndex]
    this.output.from = MATERIALS[runnerUp]
    this.output.to = MATERIALS[strongest]
    this.output.bridge = bridge
    this.output.widthScale = 1 - (1 - profile.width) * bridge
    this.output.heightScale = 1 - (1 - profile.height) * bridge
    this.output.shapeNeutralization = profile.neutralization * bridge
    return this.output
  }
}

export function dominantMouthMaterial(
  input: MouthTransitionInput,
): SpeechMouthMaterial {
  const scores = new Float32Array(MATERIALS.length)
  resolveMouthMaterialScores(input, scores)
  let strongest = 0
  for (let index = 1; index < scores.length; index += 1) {
    if (scores[index] > scores[strongest]) strongest = index
  }
  return MATERIALS[strongest]
}

function resolveMouthMaterialScores(
  input: MouthTransitionInput,
  output: Float32Array,
): void {
  const seal = clamp01(input.mouthSeal)
  const presence = mouthMaterialPresence(input) * (1 - smootherstep(seal))
  const shapeTotal =
    clamp01(input.mouthWide) +
    clamp01(input.mouthRound) +
    clamp01(input.mouthNarrow)
  const shapeScale = shapeTotal > 1 ? 1 / shapeTotal : 1
  const wide = clamp01(input.mouthWide) * shapeScale
  const round = clamp01(input.mouthRound) * shapeScale
  const narrow = clamp01(input.mouthNarrow) * shapeScale
  const ordinary = Math.max(0, 1 - wide - round - narrow)
  output[0] = 1 - presence
  output[1] = presence * ordinary
  output[2] = presence * wide
  output[3] = presence * round
  output[4] = presence * narrow
}

function mouthMaterialPresence(input: MouthTransitionInput): number {
  return smootherstep(
    (clamp01(input.mouthOpen) - 0.035) /
      (0.14 + clamp01(input.mouthEase) * 0.04),
  )
}

function bridgeProfile(
  first: SpeechMouthMaterial,
  second: SpeechMouthMaterial,
): BridgeProfile {
  if (first === 'mouthClose' || second === 'mouthClose') {
    return {
      width: 0.97,
      height: 0.82,
      neutralization: 0.5,
      switchMargin: 0.04,
    }
  }
  const wideRound =
    (first === 'mouthWide' && second === 'mouthRound') ||
    (first === 'mouthRound' && second === 'mouthWide')
  if (wideRound) {
    return {
      width: 0.9,
      height: 0.88,
      neutralization: 0.72,
      switchMargin: 0.08,
    }
  }
  if (first === 'mouthRound' || second === 'mouthRound') {
    return {
      width: 0.93,
      height: 0.9,
      neutralization: 0.58,
      switchMargin: 0.08,
    }
  }
  if (first === 'mouthNarrow' || second === 'mouthNarrow') {
    return {
      width: 0.95,
      height: 0.9,
      neutralization: 0.44,
      switchMargin: 0.07,
    }
  }
  return DEFAULT_BRIDGE
}

function smootherstep(value: number): number {
  const bounded = clamp01(value)
  return bounded * bounded * bounded * (bounded * (bounded * 6 - 15) + 10)
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}
