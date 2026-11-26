// Expression mouths painted in a portrait's own lips.
import type { LipCut, MouthExpressionKind, PaintedLips } from '@myriad/figure-player/internals'
import type { MouthExpressionSize } from './mouthShared'
import { LIP_CUT_OFFSET, lipCut, mouthExpressionOuterPath, paintLipMouth, soften } from '@myriad/figure-player/internals'

type Point = readonly [x: number, y: number]

/**
 * Every mouth a face with painted lips gets painted in them, the expression
 * mouths (crying, laughing, tongue out) as well as the speaking ones: a cel
 * glyph with a dark rim reads as a sticker on such a face, whatever the
 * expression.
 */
export const LIP_MOUTH_KINDS: ReadonlySet<MouthExpressionKind> = new Set(['open', 'wide', 'round', 'narrow', 'cry', 'maniac', 'silly'])

/**
 * Where the lips part in an expression mouth. A wail and a laugh open wide
 * inside thin lips; a tongue out shows no teeth.
 */
const EXPRESSION_LIP_CUTS: Readonly<Partial<Record<MouthExpressionKind, LipCut>>> = {
  cry: { openingX: 0.8, openingY: 0.72, lineX: 0.86, lineY: 0.8, teethMinimum: 0.16 },
  maniac: { openingX: 0.88, openingY: 0.84, lineX: 0.92, lineY: 0.89, teethMinimum: 0.2 },
  silly: { openingX: 0.76, openingY: 0.66, lineX: 0.83, lineY: 0.74, teethMinimum: 0 },
}

/** A lip mouth opens to this share of its width; the glyph heights assume a cel line. */
const LIP_HEIGHT_SHARE: Readonly<Partial<Record<MouthExpressionKind, number>>> = {
  open: 0.5,
  wide: 0.3,
  round: 0.78,
  narrow: 0.2,
}

/** The glyph's width, with a height that suits lips rather than a cel line. */
export function lipMouthSize(kind: MouthExpressionKind, size: Readonly<MouthExpressionSize>): MouthExpressionSize {
  const share = LIP_HEIGHT_SHARE[kind]
  if (!share) return size
  return { width: size.width, height: Math.max(10, Math.round(size.width * share)) }
}

export function createLipMouthBitmap(
  kind: MouthExpressionKind,
  requestedSize: Readonly<MouthExpressionSize>,
  painted: Readonly<PaintedLips>,
): { width: number; height: number; data: Uint8ClampedArray } {
  const large = kind === 'maniac'
  const width = Math.max(16, Math.min(large ? 360 : 200, Math.round(requestedSize.width)))
  const height = Math.max(10, Math.min(large ? 300 : 160, Math.round(requestedSize.height)))
  const outer = mouthExpressionOuterPath(kind)
  const cut = EXPRESSION_LIP_CUTS[kind] ?? lipCut(kind === 'narrow' ? 1 : 0, kind === 'round' ? 1 : 0)
  const opening = scalePath(outer, cut.openingX, cut.openingY, LIP_CUT_OFFSET)
  const lipLine = scalePath(outer, cut.lineX, cut.lineY, LIP_CUT_OFFSET)
  const data = new Uint8ClampedArray(width * height * 4)
  const openingTop = Math.min(...opening.map(([, y]) => y))
  const openingBottom = Math.max(...opening.map(([, y]) => y))
  paintLipMouth(data, width, height, painted, {
    toShape: (x, y, out) => {
      out.x = (x / width - 0.5) * 2.2
      out.y = (y / height - 0.5) * 2.2
    },
    openingRows: ((openingBottom - openingTop) / 2.2) * height,
    openingTop,
    openingBottom,
    teethMinimum: cut.teethMinimum,
    teethFollowLip: kind in EXPRESSION_LIP_CUTS,
    inOuter: (x, y) => pointInPolygon(x, y, outer),
    inLipLine: (x, y) => pointInPolygon(x, y, lipLine),
    inOpening: (x, y) => pointInPolygon(x, y, opening),
  })
  return { width, height, data: soften(data, width, height) }
}

function scalePath(path: readonly Point[], scaleX: number, scaleY: number, offsetY: number): Point[] {
  return path.map(([x, y]) => [x * scaleX, y * scaleY + offsetY] as const)
}

function pointInPolygon(x: number, y: number, polygon: readonly Point[]): boolean {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [xi, yi] = polygon[index]
    const [xj, yj] = polygon[previous]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
