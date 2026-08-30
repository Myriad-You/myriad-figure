import { mixBoundedExpressionChannel } from './performanceExpression'

export interface OccupancyOffset {
  angleX: number
  angleY: number
  angleZ: number
  body: number
  armY: number
  armPos: number
  eyeX: number
  eyeY: number
  brow: number
}

export interface OccupancyLayer {
  offset: Readonly<OccupancyOffset>
  occupancy: number
}

const ZERO_OFFSET: OccupancyOffset = {
  angleX: 0,
  angleY: 0,
  angleZ: 0,
  body: 0,
  armY: 0,
  armPos: 0,
  eyeX: 0,
  eyeY: 0,
  brow: 0,
}

const KEYS = [
  'angleX',
  'angleY',
  'angleZ',
  'body',
  'armY',
  'armPos',
  'eyeX',
  'eyeY',
  'brow',
] as const

/** Rest plus occupancy-weighted offsets. High occupancy compresses, it does not drop layers. */
export function composeOccupancyOffsets(
  layers: readonly OccupancyLayer[],
  output: OccupancyOffset = { ...ZERO_OFFSET },
): OccupancyOffset {
  for (const key of KEYS) output[key] = 0
  for (const layer of layers) {
    const amount = clamp01(layer.occupancy)
    if (amount <= 0) continue
    for (const key of KEYS) {
      output[key] = mixBoundedExpressionChannel(
        output[key],
        layer.offset[key] * amount,
        -1,
        1,
        0,
      )
    }
  }
  return output
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}
