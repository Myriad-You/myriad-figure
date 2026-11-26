// Path geometry and painting for the drawn mouths.
import type { Anime25DMouthPathPoint, Anime25DRgb } from '@myriad-you/figure-player/internals'
import { clamp } from './mouthShared'

export function insetPath(
  path: readonly Anime25DMouthPathPoint[],
  scaleX: number,
  scaleY: number,
  offsetY: number,
): Anime25DMouthPathPoint[] {
  return path.map(([x, y]) => [x * scaleX, y * scaleY + offsetY])
}

export function pointInPolygon(
  x: number,
  y: number,
  polygon: readonly Anime25DMouthPathPoint[],
): boolean {
  let inside = false
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index++
  ) {
    const currentPoint = polygon[index]
    const previousPoint = polygon[previous]
    const crosses =
      currentPoint[1] > y !== previousPoint[1] > y &&
      x <
        ((previousPoint[0] - currentPoint[0]) * (y - currentPoint[1])) /
          (previousPoint[1] - currentPoint[1]) +
          currentPoint[0]
    if (crosses) inside = !inside
  }
  return inside
}

export function pointToPolylineDistance(
  x: number,
  y: number,
  points: readonly Anime25DMouthPathPoint[],
): number {
  let distance = Number.POSITIVE_INFINITY
  for (let index = 1; index < points.length; index += 1) {
    distance = Math.min(
      distance,
      pointToSegmentDistance(x, y, points[index - 1], points[index]),
    )
  }
  return distance
}

function pointToSegmentDistance(
  x: number,
  y: number,
  start: Anime25DMouthPathPoint,
  end: Anime25DMouthPathPoint,
): number {
  const deltaX = end[0] - start[0]
  const deltaY = end[1] - start[1]
  const lengthSquared = deltaX * deltaX + deltaY * deltaY
  const progress =
    lengthSquared > 0
      ? clamp(
          ((x - start[0]) * deltaX + (y - start[1]) * deltaY) / lengthSquared,
          0,
          1,
        )
      : 0
  return Math.hypot(
    x - (start[0] + deltaX * progress),
    y - (start[1] + deltaY * progress),
  )
}

export function paint(
  data: Uint8ClampedArray,
  offset: number,
  color: Readonly<Anime25DRgb>,
  alpha: number,
): void {
  const sourceAlpha = clamp(alpha, 0, 1)
  const destinationAlpha = data[offset + 3] / 255
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha)
  if (outputAlpha <= 0) return
  const retained = destinationAlpha * (1 - sourceAlpha)
  data[offset] = Math.round(
    (color.red * sourceAlpha + data[offset] * retained) / outputAlpha,
  )
  data[offset + 1] = Math.round(
    (color.green * sourceAlpha + data[offset + 1] * retained) / outputAlpha,
  )
  data[offset + 2] = Math.round(
    (color.blue * sourceAlpha + data[offset + 2] * retained) / outputAlpha,
  )
  data[offset + 3] = Math.round(outputAlpha * 255)
}
