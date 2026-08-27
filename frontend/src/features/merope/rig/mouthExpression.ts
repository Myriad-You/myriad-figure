export type MouthExpressionKind =
  'open' | 'wide' | 'round' | 'narrow' | 'cry' | 'maniac'

export interface MouthExpressionSize {
  width: number
  height: number
}

export interface MouthExpressionPalette {
  line: Rgb
  cavity: Rgb
  fill: Rgb
}

interface Rgb {
  red: number
  green: number
  blue: number
}

type Point = readonly [x: number, y: number]

const FALLBACK_LINE = { red: 104, green: 57, blue: 75 }
const FALLBACK_CAVITY = { red: 91, green: 45, blue: 65 }
const FALLBACK_FILL = { red: 232, green: 139, blue: 151 }

/** Sizes regular glyphs from the neutral mouth and the extreme laugh from the face. */
export function mouthExpressionGeneratedSizes(
  source: {
    width: number
    height: number
  },
  face?: { width: number; height: number; mouthToChin?: number },
): Record<MouthExpressionKind, MouthExpressionSize> {
  const sourceWidth = Math.max(1, source.width - 4)
  const sourceHeight = Math.max(1, source.height - 4)
  const openWidth = clampInt(Math.round(sourceWidth * 0.96), 24, 128)
  const wideWidth = clampInt(Math.round(sourceWidth * 1.24), 28, 152)
  const roundWidth = clampInt(Math.round(sourceWidth * 0.76), 20, 112)
  const narrowWidth = clampInt(Math.round(sourceWidth * 1.08), 24, 136)
  const cryWidth = clampInt(Math.round(sourceWidth * 1.3), 30, 160)
  const faceWidth = Math.max(1, face?.width ?? 1)
  const maniacPreferredWidth = Math.max(sourceWidth * 1.62, faceWidth * 0.29)
  const maniacWidth = clampInt(
    Math.round(
      face
        ? Math.min(maniacPreferredWidth, faceWidth * 0.33)
        : maniacPreferredWidth,
    ),
    64,
    280,
  )
  const maniacUnboundedHeight = Math.max(
    sourceHeight * 2.7,
    maniacWidth * 0.64,
    Math.max(1, face?.height ?? 1) * 0.162,
  )
  const mouthToChin = face?.mouthToChin
  const maniacHeightLimit =
    mouthToChin && mouthToChin > 0
      ? Math.max(
          42,
          (mouthToChin - Math.max(2, (face?.height ?? 1) * 0.01)) / 0.44,
        )
      : 220
  return {
    open: {
      width: openWidth,
      height: clampInt(
        Math.round(Math.max(sourceHeight * 1.5, openWidth * 0.62)),
        16,
        96,
      ),
    },
    wide: {
      width: wideWidth,
      height: clampInt(
        Math.round(Math.max(sourceHeight * 1.08, wideWidth * 0.4)),
        14,
        72,
      ),
    },
    round: {
      width: roundWidth,
      height: clampInt(
        Math.round(Math.max(sourceHeight * 1.62, roundWidth * 0.94)),
        18,
        104,
      ),
    },
    narrow: {
      width: narrowWidth,
      height: clampInt(
        Math.round(Math.max(sourceHeight * 0.88, narrowWidth * 0.27)),
        12,
        52,
      ),
    },
    cry: {
      width: cryWidth,
      height: clampInt(
        Math.round(Math.max(sourceHeight * 2, cryWidth * 0.64)),
        22,
        120,
      ),
    },
    maniac: {
      width: maniacWidth,
      height: clampInt(
        Math.round(Math.min(maniacUnboundedHeight, maniacHeightLimit)),
        42,
        220,
      ),
    },
  }
}

/** Samples only color identity; generated geometry remains deterministic. */
export function sampleMouthExpressionPalette(
  source: Uint8ClampedArray | undefined,
): MouthExpressionPalette {
  if (!source || source.length < 4) {
    return {
      line: FALLBACK_LINE,
      cavity: FALLBACK_CAVITY,
      fill: FALLBACK_FILL,
    }
  }
  const visible: Array<Rgb & { luminance: number }> = []
  for (let index = 0; index < source.length; index += 4) {
    if (source[index + 3] < 40) continue
    const red = source[index]
    const green = source[index + 1]
    const blue = source[index + 2]
    visible.push({
      red,
      green,
      blue,
      luminance: red * 0.299 + green * 0.587 + blue * 0.114,
    })
  }
  if (visible.length === 0) {
    return {
      line: FALLBACK_LINE,
      cavity: FALLBACK_CAVITY,
      fill: FALLBACK_FILL,
    }
  }
  visible.sort((left, right) => left.luminance - right.luminance)
  const darkCount = Math.max(1, Math.ceil(visible.length * 0.08))
  const sampledLine = average(visible.slice(0, darkCount))
  const lineLuminance = luminance(sampledLine)
  const line =
    lineLuminance <= 145
      ? mixColor(sampledLine, FALLBACK_LINE, 0.18)
      : FALLBACK_LINE
  const warmPixels = visible.filter(
    (color) => color.red > color.green * 1.04 && color.red > color.blue * 0.96,
  )
  const sampledFill = average(warmPixels.length > 0 ? warmPixels : visible)
  const fill = mixColor(sampledFill, FALLBACK_FILL, 0.72)
  return {
    line,
    cavity: mixColor(line, FALLBACK_CAVITY, 0.58),
    fill,
  }
}

/**
 * Draws cel-style anime mouth variants without canvas, gradients, or runtime AI.
 * Four sub-pixel samples keep the checked-in result stable and cheap to import.
 */
export function createMouthExpressionBitmap(
  kind: MouthExpressionKind,
  requestedSize: Readonly<MouthExpressionSize>,
  palette: Readonly<MouthExpressionPalette>,
): { width: number; height: number; data: Uint8ClampedArray } {
  const width = clampInt(
    Math.round(requestedSize.width),
    16,
    kind === 'maniac' ? 360 : 160,
  )
  const height = clampInt(
    Math.round(requestedSize.height),
    12,
    kind === 'maniac' ? 300 : 120,
  )
  const data = new Uint8ClampedArray(width * height * 4)
  const outer = mouthOuterPath(kind)
  const inner = insetPath(
    outer,
    kind === 'maniac'
      ? 0.97
      : kind === 'cry'
        ? 0.83
        : kind === 'narrow'
          ? 0.8
          : 0.78,
    kind === 'maniac'
      ? 0.955
      : kind === 'cry'
        ? 0.76
        : kind === 'narrow'
          ? 0.58
          : 0.75,
    kind === 'maniac'
      ? 0.006
      : kind === 'cry'
        ? 0.035
        : kind === 'wide'
          ? 0.045
          : 0.025,
  )
  const samples: readonly Point[] = [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.25, 0.75],
    [0.75, 0.75],
  ]
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let outerCoverage = 0
      let innerCoverage = 0
      let tongueCoverage = 0
      for (const [offsetX, offsetY] of samples) {
        const px = ((x + offsetX) / width - 0.5) * 2.2
        const py = ((y + offsetY) / height - 0.5) * 2.2
        if (pointInPolygon(px, py, outer)) outerCoverage += 0.25
        if (pointInPolygon(px, py, inner)) {
          innerCoverage += 0.25
          if (
            kind !== 'cry' &&
            kind !== 'narrow' &&
            py > tongueBoundary(kind, px)
          ) {
            tongueCoverage += 0.25
          }
        }
      }
      if (outerCoverage <= 0) continue
      const offset = (y * width + x) * 4
      if (outerCoverage > 0) paint(data, offset, palette.line, outerCoverage)
      if (innerCoverage > 0) {
        paint(
          data,
          offset,
          kind === 'cry' ? palette.fill : palette.cavity,
          innerCoverage,
        )
      }
      if (tongueCoverage > 0) {
        paint(data, offset, palette.fill, tongueCoverage)
      }
    }
  }
  return { width, height, data }
}

function mouthOuterPath(kind: MouthExpressionKind): Point[] {
  if (kind === 'wide') return wideOuterPath()
  if (kind === 'round') return roundOuterPath()
  if (kind === 'narrow') return narrowOuterPath()
  if (kind === 'cry') return cryOuterPath()
  if (kind === 'maniac') return maniacOuterPath()
  return openOuterPath()
}

function tongueBoundary(kind: MouthExpressionKind, x: number): number {
  if (kind === 'round') return 0.3 - 0.12 * (1 - x * x)
  if (kind === 'wide') return 0.2 - 0.12 * (1 - x * x)
  if (kind === 'maniac') return 0.08 - 0.1 * (1 - x * x)
  return 0.24 - 0.16 * (1 - x * x)
}

function openOuterPath(): Point[] {
  return [
    [-0.2, -0.82],
    [0.22, -0.8],
    [0.54, -0.62],
    [0.7, -0.27],
    [0.67, 0.2],
    [0.48, 0.58],
    [0.15, 0.78],
    [-0.2, 0.76],
    [-0.5, 0.56],
    [-0.67, 0.19],
    [-0.68, -0.28],
    [-0.51, -0.63],
  ]
}

/** Broad, slightly uneven anime vowel shape for E/I-family articulation. */
function wideOuterPath(): Point[] {
  return [
    [-0.91, -0.2],
    [-0.7, -0.45],
    [-0.34, -0.57],
    [0.08, -0.54],
    [0.46, -0.49],
    [0.82, -0.27],
    [0.94, 0.02],
    [0.78, 0.3],
    [0.39, 0.48],
    [-0.02, 0.5],
    [-0.43, 0.43],
    [-0.79, 0.23],
    [-0.93, -0.02],
  ]
}

/** Compact rounded O/U-family shape; intentionally not a perfect ellipse. */
function roundOuterPath(): Point[] {
  return [
    [-0.4, -0.77],
    [-0.08, -0.91],
    [0.28, -0.79],
    [0.53, -0.51],
    [0.62, -0.08],
    [0.55, 0.38],
    [0.3, 0.72],
    [-0.04, 0.86],
    [-0.36, 0.72],
    [-0.58, 0.39],
    [-0.62, -0.06],
    [-0.57, -0.46],
  ]
}

/** Restrained consonant/in-between shape used instead of collapsing the open art. */
function narrowOuterPath(): Point[] {
  return [
    [-0.91, -0.12],
    [-0.62, -0.31],
    [-0.21, -0.37],
    [0.2, -0.34],
    [0.61, -0.28],
    [0.9, -0.08],
    [0.79, 0.16],
    [0.39, 0.28],
    [-0.05, 0.31],
    [-0.5, 0.25],
    [-0.82, 0.12],
  ]
}

function cryOuterPath(): Point[] {
  return [
    [-0.88, -0.18],
    [-0.78, -0.48],
    [-0.51, -0.61],
    [-0.25, -0.45],
    [0, -0.23],
    [0.24, -0.46],
    [0.53, -0.59],
    [0.8, -0.46],
    [0.9, -0.14],
    [0.84, 0.25],
    [0.61, 0.54],
    [0.26, 0.66],
    [-0.08, 0.69],
    [-0.43, 0.63],
    [-0.73, 0.48],
    [-0.89, 0.18],
  ]
}

/**
 * Front-facing anime laugh with a deep cavity and heavy lower tongue.
 * Cubic sampling avoids the sticker-like polygon facets of ordinary visemes.
 */
function maniacOuterPath(): Point[] {
  const output: Point[] = []
  appendCubic(
    output,
    [-0.88, -0.72],
    [-0.48, -0.84],
    [0.48, -0.84],
    [0.88, -0.72],
  )
  appendCubic(output, [0.88, -0.72], [0.93, -0.16], [0.75, 0.55], [0.43, 0.82])
  appendCubic(output, [0.43, 0.82], [0.2, 0.98], [-0.2, 0.98], [-0.43, 0.82])
  appendCubic(
    output,
    [-0.43, 0.82],
    [-0.75, 0.55],
    [-0.93, -0.16],
    [-0.88, -0.72],
  )
  return output
}

function appendCubic(
  output: Point[],
  from: Point,
  controlA: Point,
  controlB: Point,
  to: Point,
): void {
  if (output.length === 0) output.push(from)
  for (let step = 1; step <= 7; step += 1) {
    const t = step / 7
    const inverse = 1 - t
    const fromWeight = inverse * inverse * inverse
    const controlAWeight = 3 * inverse * inverse * t
    const controlBWeight = 3 * inverse * t * t
    const toWeight = t * t * t
    output.push([
      from[0] * fromWeight +
        controlA[0] * controlAWeight +
        controlB[0] * controlBWeight +
        to[0] * toWeight,
      from[1] * fromWeight +
        controlA[1] * controlAWeight +
        controlB[1] * controlBWeight +
        to[1] * toWeight,
    ])
  }
}

function insetPath(
  path: readonly Point[],
  scaleX: number,
  scaleY: number,
  offsetY: number,
): Point[] {
  return path.map(([x, y]) => [x * scaleX, y * scaleY + offsetY])
}

function pointInPolygon(
  x: number,
  y: number,
  polygon: readonly Point[],
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

function paint(
  data: Uint8ClampedArray,
  offset: number,
  color: Readonly<Rgb>,
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

function average(colors: readonly Rgb[]): Rgb {
  if (colors.length === 0) return FALLBACK_FILL
  let red = 0
  let green = 0
  let blue = 0
  for (const color of colors) {
    red += color.red
    green += color.green
    blue += color.blue
  }
  return {
    red: Math.round(red / colors.length),
    green: Math.round(green / colors.length),
    blue: Math.round(blue / colors.length),
  }
}

function mixColor(
  left: Readonly<Rgb>,
  right: Readonly<Rgb>,
  amount: number,
): Rgb {
  return {
    red: Math.round(left.red + (right.red - left.red) * amount),
    green: Math.round(left.green + (right.green - left.green) * amount),
    blue: Math.round(left.blue + (right.blue - left.blue) * amount),
  }
}

function luminance(color: Readonly<Rgb>): number {
  return color.red * 0.299 + color.green * 0.587 + color.blue * 0.114
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function clampInt(value: number, minimum: number, maximum: number): number {
  return Math.round(clamp(value, minimum, maximum))
}
