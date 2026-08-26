export const COLLAR_ATTACHMENT_BODY = 0
export const COLLAR_ATTACHMENT_NECK = 1

interface LayerBounds {
  x: number
  y: number
  w: number
  h: number
}

interface ContactRow {
  y: number
  outerLeft: number
  innerLeft: number
  innerRight: number
  outerRight: number
}

export interface FrontCollarContactModel {
  handles: Float32Array
  attachments: Uint8Array
  targets: Float32Array
  contactPairs: Uint16Array
  gridX: readonly number[]
  gridY: readonly number[]
}

const ALPHA_THRESHOLD = 18
const MAX_CONTACT_SAMPLES = 6

/**
 * Extracts the open neck/collar seam from the front-collar alpha contour.
 * A usable high collar has two opaque panels separated by a transparent gap
 * around the horizontal centre. Once the panels meet, the contact seam ends.
 */
export function buildFrontCollarContactModel(
  rgba: Uint8ClampedArray,
  pixelWidth: number,
  pixelHeight: number,
  source: LayerBounds,
  neckCenterX = source.x + source.w / 2,
): FrontCollarContactModel | null {
  if (
    pixelWidth < 8 ||
    pixelHeight < 8 ||
    rgba.length < pixelWidth * pixelHeight * 4
  ) {
    return null
  }

  const rows: ContactRow[] = []
  const maximumY = Math.max(1, Math.floor(pixelHeight * 0.62))
  const minimumGap = Math.max(3, Math.round(pixelWidth * 0.025))
  const centerX = Math.max(
    1,
    Math.min(
      pixelWidth - 2,
      ((neckCenterX - source.x) / Math.max(1, source.w)) * pixelWidth,
    ),
  )
  let missedRows = 0
  for (let y = 0; y <= maximumY; y += 1) {
    const row = alphaContactRow(
      rgba,
      pixelWidth,
      y,
      centerX,
      minimumGap,
      ALPHA_THRESHOLD,
    )
    if (row) {
      rows.push(row)
      missedRows = 0
    } else if (rows.length > 0) {
      missedRows += 1
      if (missedRows > Math.max(3, Math.round(pixelHeight * 0.035))) break
    }
  }
  if (rows.length < 5) return null

  const samples = sampleContactRows(rows, MAX_CONTACT_SAMPLES)
  if (samples.length < 4) return null

  const handles: number[] = []
  const attachments: number[] = []
  const contactPairs: number[] = []
  const gridX: number[] = []
  const gridY: number[] = []
  const scaleX = source.w / pixelWidth
  const scaleY = source.h / pixelHeight
  for (const sample of samples) {
    const y = source.y + (sample.y + 0.5) * scaleY
    const outerLeft = source.x + sample.outerLeft * scaleX
    const innerLeft = source.x + (sample.innerLeft + 1) * scaleX
    const innerRight = source.x + sample.innerRight * scaleX
    const outerRight = source.x + (sample.outerRight + 1) * scaleX
    const firstHandle = handles.length / 2
    handles.push(outerLeft, y, innerLeft, y, innerRight, y, outerRight, y)
    attachments.push(
      COLLAR_ATTACHMENT_BODY,
      COLLAR_ATTACHMENT_NECK,
      COLLAR_ATTACHMENT_NECK,
      COLLAR_ATTACHMENT_BODY,
    )
    contactPairs.push(firstHandle + 1, firstHandle + 2)
    gridX.push(outerLeft, innerLeft, innerRight, outerRight)
    gridY.push(y)
  }

  const bottomY = source.y + source.h
  handles.push(
    source.x,
    bottomY,
    source.x + source.w / 2,
    bottomY,
    source.x + source.w,
    bottomY,
  )
  attachments.push(
    COLLAR_ATTACHMENT_BODY,
    COLLAR_ATTACHMENT_BODY,
    COLLAR_ATTACHMENT_BODY,
  )
  gridX.push(source.x, source.x + source.w / 2, source.x + source.w)
  gridY.push(bottomY)

  const restHandles = Float32Array.from(handles)
  return {
    handles: restHandles,
    attachments: Uint8Array.from(attachments),
    targets: restHandles.slice(),
    contactPairs: Uint16Array.from(contactPairs),
    gridX,
    gridY,
  }
}

/**
 * Rigid moving-least-squares deformation. Each output point gets a local
 * best-fit rotation and translation from the collar's body/neck handles.
 */
export function deformRigidMlsPoint(
  x: number,
  y: number,
  handles: Float32Array,
  targets: Float32Array,
  output: Float32Array,
  outputIndex: number,
): void {
  const handleCount = handles.length / 2
  let weightSum = 0
  let restCenterX = 0
  let restCenterY = 0
  let targetCenterX = 0
  let targetCenterY = 0

  for (let handle = 0; handle < handleCount; handle += 1) {
    const index = handle * 2
    const dx = x - handles[index]
    const dy = y - handles[index + 1]
    const distanceSquared = dx * dx + dy * dy
    if (distanceSquared < 1e-5) {
      output[outputIndex] = targets[index]
      output[outputIndex + 1] = targets[index + 1]
      return
    }
    const softenedDistance = distanceSquared + 1
    const weight = 1 / (softenedDistance * Math.sqrt(softenedDistance))
    weightSum += weight
    restCenterX += handles[index] * weight
    restCenterY += handles[index + 1] * weight
    targetCenterX += targets[index] * weight
    targetCenterY += targets[index + 1] * weight
  }
  if (weightSum <= 1e-8) {
    output[outputIndex] = x
    output[outputIndex + 1] = y
    return
  }

  restCenterX /= weightSum
  restCenterY /= weightSum
  targetCenterX /= weightSum
  targetCenterY /= weightSum
  let cosineTerm = 0
  let sineTerm = 0
  for (let handle = 0; handle < handleCount; handle += 1) {
    const index = handle * 2
    const dx = x - handles[index]
    const dy = y - handles[index + 1]
    const softenedDistance = dx * dx + dy * dy + 1
    const weight = 1 / (softenedDistance * Math.sqrt(softenedDistance))
    const restX = handles[index] - restCenterX
    const restY = handles[index + 1] - restCenterY
    const targetX = targets[index] - targetCenterX
    const targetY = targets[index + 1] - targetCenterY
    cosineTerm += weight * (restX * targetX + restY * targetY)
    sineTerm += weight * (restX * targetY - restY * targetX)
  }

  const rotationLength = Math.hypot(cosineTerm, sineTerm)
  if (rotationLength <= 1e-8) {
    output[outputIndex] = x + targetCenterX - restCenterX
    output[outputIndex + 1] = y + targetCenterY - restCenterY
    return
  }
  const cosine = cosineTerm / rotationLength
  const sine = sineTerm / rotationLength
  const localX = x - restCenterX
  const localY = y - restCenterY
  output[outputIndex] = targetCenterX + localX * cosine - localY * sine
  output[outputIndex + 1] = targetCenterY + localX * sine + localY * cosine
}

function alphaContactRow(
  rgba: Uint8ClampedArray,
  width: number,
  y: number,
  centerX: number,
  minimumGap: number,
  threshold: number,
): ContactRow | null {
  const centerLeft = Math.floor(centerX)
  const centerRight = Math.ceil(centerX)
  let innerLeft = centerLeft
  while (innerLeft >= 0 && alphaAt(rgba, width, innerLeft, y) <= threshold) {
    innerLeft -= 1
  }
  let innerRight = centerRight
  while (
    innerRight < width &&
    alphaAt(rgba, width, innerRight, y) <= threshold
  ) {
    innerRight += 1
  }
  if (
    innerLeft < 0 ||
    innerRight >= width ||
    innerRight - innerLeft - 1 < minimumGap
  ) {
    return null
  }

  let outerLeft = 0
  while (
    outerLeft < innerLeft &&
    alphaAt(rgba, width, outerLeft, y) <= threshold
  ) {
    outerLeft += 1
  }
  let outerRight = width - 1
  while (
    outerRight > innerRight &&
    alphaAt(rgba, width, outerRight, y) <= threshold
  ) {
    outerRight -= 1
  }
  if (outerLeft >= innerLeft || outerRight <= innerRight) return null
  return { y, outerLeft, innerLeft, innerRight, outerRight }
}

function alphaAt(
  rgba: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
): number {
  return rgba[(y * width + x) * 4 + 3]
}

function sampleContactRows(
  rows: readonly ContactRow[],
  maximumSamples: number,
): ContactRow[] {
  const count = Math.min(maximumSamples, rows.length)
  const samples: ContactRow[] = []
  for (let sample = 0; sample < count; sample += 1) {
    const target =
      rows[0].y + ((rows[rows.length - 1].y - rows[0].y) * sample) / (count - 1)
    let best = rows[0]
    for (const row of rows) {
      if (Math.abs(row.y - target) < Math.abs(best.y - target)) best = row
    }
    if (samples.at(-1)?.y !== best.y) samples.push(smoothContactRow(rows, best))
  }
  return samples
}

function smoothContactRow(
  rows: readonly ContactRow[],
  center: ContactRow,
): ContactRow {
  const nearby = rows.filter((row) => Math.abs(row.y - center.y) <= 2)
  return {
    y: center.y,
    outerLeft: median(nearby.map((row) => row.outerLeft)),
    innerLeft: median(nearby.map((row) => row.innerLeft)),
    innerRight: median(nearby.map((row) => row.innerRight)),
    outerRight: median(nearby.map((row) => row.outerRight)),
  }
}

function median(values: number[]): number {
  values.sort((left, right) => left - right)
  return values[Math.floor(values.length / 2)]
}
