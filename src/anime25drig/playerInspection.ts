import type { BodyLift } from './bodyLift'
import type { CollarClipMesh } from './collarRuntime'
import type { Anime25DDriver } from './driver'
import type { Anime25DGpuLayer } from './layerGpuBinding'
import type { Anime25DRenderFrame } from './renderer'
import { applyBodyLift } from './bodyLift'

export interface Anime25DPoint { x: number, y: number }

/** One drawn layer this frame. Positions are pixel-canvas coordinates, copied out. */
export interface Anime25DLayerView {
  name: string
  role: string
  group: string
  side: string | null
  opacity: number
  /** The mesh as drawn in the source art. */
  rest: Float32Array
  /** Where each vertex is placed this frame, before the shared body stage (see Anime25DInspection.draw). */
  placed: Float32Array
  indices: Uint16Array
  /** The layer's own transform (column-major 3×3) that `placed` already includes. */
  transform: Float32Array
  /** Hair only: where the surface would be without its own follow-through, placed the same way. */
  hairBase: Float32Array | null
  /** Rides the face's surface: eyes, brows, mouth and the like. */
  onFaceSurface: boolean
  /** Its edge is sewn to the skin of the layer it meets: an exposed shoulder. */
  skinContact: boolean
  /** Hangs from a point on another layer: an earring, a clip. */
  hangsFrom: { host: string, rest: Anime25DPoint, placed: Anime25DPoint } | null
  /** Where the art is cut by the canvas edge together with another layer, the layer it stays joined to. */
  sharesCutWith: string | null
}

/** What the player drew this frame, for tests and inspectors. Every array is a copy. */
export interface Anime25DInspection {
  driver: Anime25DDriver
  posture: {
    /** The torso's upward extension this frame, in pixels. */
    lift: number
    /** The torso's sagittal lean this frame. */
    pitch: number
    /** The torso's own turn this frame. */
    torsoYaw: number
    /** The lean, in radians, the shoulders and everything above them take. */
    lean: number
  }
  layers: Anime25DLayerView[]
  /** A high collar's opening around the neck, drawn as its own mesh. */
  collarAperture: { rest: Float32Array, placed: Float32Array, indices: Uint16Array } | null
  /** The band of the face's top edge the crown hair shows through; null when the art gives no evidence for one. */
  crownBand: { start: number, end: number } | null
  /** Where the GPU draws a placed point: the lean, lift and pitch every layer takes. */
  draw: (point: Anime25DPoint) => Anime25DPoint
}

export interface Anime25DInspectionInput {
  current: Anime25DDriver
  layers: readonly Anime25DGpuLayer[]
  collarClip: CollarClipMesh | null
  renderFrame: Readonly<Anime25DRenderFrame>
  torsoYaw: number
}

export function inspectAnime25DFrame(input: Anime25DInspectionInput): Anime25DInspection {
  const frame = input.renderFrame
  const lift: Readonly<BodyLift> | undefined = frame.bodyLift ? { ...frame.bodyLift } : undefined
  const lean = Math.atan2(frame.bodyRotationSine, frame.bodyRotationCosine)
  const { bodyPivotX: pivotX, bodyPivotY: pivotY, bodyBendHeight: bend } = frame
  const face = input.layers.find(layer => layer.source.role === 'face')
  const crown = face?.crownOccluders?.[0]
  return {
    driver: { ...input.current },
    posture: { lift: lift?.amount ?? 0, pitch: lift?.pitch ?? 0, torsoYaw: input.torsoYaw, lean },
    layers: input.layers.map(layer => viewLayer(layer)),
    collarAperture: input.collarClip
      ? { rest: input.collarClip.rest.slice(), placed: input.collarClip.deformed.slice(), indices: input.collarClip.indices.slice() }
      : null,
    crownBand: crown ? { start: crown.start, end: crown.end } : null,
    // The vertex shader's body stage, step for step (webglRuntime VERTEX_SHADER).
    draw(point) {
      const dx = point.x - pivotX
      const dy = point.y - pivotY
      const share = bend > 0 ? smoothstep(-dy / bend) : 1
      const c = Math.cos(lean * share)
      const s = Math.sin(lean * share)
      const out = { x: pivotX + dx * c - dy * s, y: pivotY + dx * s + dy * c }
      applyBodyLift(out, lift)
      return out
    },
  }
}

function viewLayer(layer: Anime25DGpuLayer): Anime25DLayerView {
  const m = layer.layerTransform
  const place = (points: Float32Array) => {
    const out = new Float32Array(points.length)
    for (let i = 0; i < points.length; i += 2) {
      out[i] = m[0]! * points[i]! + m[3]! * points[i + 1]! + m[6]!
      out[i + 1] = m[1]! * points[i]! + m[4]! * points[i + 1]! + m[7]!
    }
    return out
  }
  const attachment = layer.attachment
  const placed = place(layer.deformed)
  return {
    name: layer.source.name,
    role: layer.source.role,
    group: layer.source.group,
    side: layer.source.side ?? null,
    opacity: layer.frameOpacity,
    rest: layer.rest.slice(),
    placed,
    indices: layer.indices.slice(),
    transform: m.slice(),
    hairBase: layer.hairSurface ? place(layer.hairSurface.base) : null,
    onFaceSurface: layer.secondaryDeformation.facialSurface,
    skinContact: Boolean(layer.surfaceContact),
    hangsFrom: attachment
      ? {
          host: attachment.hostName,
          rest: { x: attachment.x, y: attachment.y },
          // A keyed or bending piece moves its own vertices too: its root is where its own mesh puts it.
          placed: carryRestPoint(layer.rest, layer.indices, placed, attachment.x, attachment.y),
        }
      : null,
    sharesCutWith: layer.cropBoundary?.host.source.name ?? null,
  }
}

/**
 * A rest point carried by its mesh: barycentric in the rest triangle that
 * holds it, or, for a point just off the mesh (a root on its top edge), in
 * the triangle it is least outside of.
 */
function carryRestPoint(rest: Float32Array, indices: Uint16Array, positions: Float32Array, x: number, y: number): Anime25DPoint {
  let best = { outside: Infinity, a: 0, b: 0, c: 0, u: 0, v: 0 }
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]!; const b = indices[i + 1]!; const c = indices[i + 2]!
    const ax = rest[a * 2]!; const ay = rest[a * 2 + 1]!
    const e0x = rest[b * 2]! - ax; const e0y = rest[b * 2 + 1]! - ay
    const e1x = rest[c * 2]! - ax; const e1y = rest[c * 2 + 1]! - ay
    const d = e0x * e1y - e1x * e0y
    if (Math.abs(d) < 1e-9) continue
    const u = ((x - ax) * e1y - e1x * (y - ay)) / d
    const v = (e0x * (y - ay) - (x - ax) * e0y) / d
    const outside = Math.max(0, -u) + Math.max(0, -v) + Math.max(0, u + v - 1)
    if (outside < best.outside) best = { outside, a, b, c, u, v }
    if (outside === 0) break
  }
  const { a, b, c, u, v } = best
  const w = 1 - u - v
  return {
    x: positions[a * 2]! * w + positions[b * 2]! * u + positions[c * 2]! * v,
    y: positions[a * 2 + 1]! * w + positions[b * 2 + 1]! * u + positions[c * 2 + 1]! * v,
  }
}

function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t))
  return x * x * (3 - 2 * x)
}
