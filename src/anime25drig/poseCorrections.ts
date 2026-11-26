// Authoring a pose correction's patch on the head's shell: from where a point is at a pose to where it should be.
import type { Anime25DShellEllipsoid } from '@myriad-you/figure-player/internals'
import type { PoseCorrection } from '@myriad-you/figure-player/workbench'

/** Author from baseline/desired shell-local points at the SAME pose, before roll/blend. */
export function poseCorrectionPatch(
  head: Readonly<Anime25DShellEllipsoid>,
  rest: Readonly<{ x: number; y: number }>,
  baseline: Readonly<{ x: number; y: number }>,
  desired: Readonly<{ x: number; y: number }>,
  radius: Readonly<{ x: number; y: number }>,
): PoseCorrection['patches'][number] {
  return {
    x: (rest.x - head.centerX) / head.radiusX,
    y: (rest.y - head.centerY) / head.radiusY,
    radiusX: radius.x / head.radiusX,
    radiusY: radius.y / head.radiusY,
    dx: (desired.x - baseline.x) / head.radiusX,
    dy: (desired.y - baseline.y) / head.radiusY,
  }
}
