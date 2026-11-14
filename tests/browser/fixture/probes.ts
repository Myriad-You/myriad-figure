// Replays of the figure through its public surface only: drive the player with
// targets and ticks, then read what it drew (inspect(), pixels). Typed and
// type-checked, so a renamed internal cannot turn a probe into a silent skip.
// Each probe runs on a synthetic package in CI and on real art when given.
import type { Anime25DDriver } from '../../../src/anime25drig/driver'
import type { Anime25DInspection, Anime25DLayerView, Anime25DPoint } from '../../../src/anime25drig/playerInspection'
import type { PoseCorrection } from '../../../src/anime25drig/poseCorrections'
import type { Anime25DPlayback } from '../../../src/anime25drig/types'
import type { MotionChannelPolicy } from '../../../src/motion/policy'
import type { MeropeRigManifest } from '../../../src/rig/types'
import { writePsd } from 'ag-psd'
import { applyBodyLift, BODY_LIFT_GLSL, bodyPitchUniform } from '../../../src/anime25drig/bodyLift'
import { IDENTITY_DRIVER } from '../../../src/anime25drig/driver'
import { THINKING_EXPRESSION_PRESET } from '../../../src/anime25drig/expressionPresets'
import { intentExpressionPatch } from '../../../src/anime25drig/performanceCueDefinitions'
import { Anime25DPlayer } from '../../../src/anime25drig/player'
import { poseCorrectionPatch } from '../../../src/anime25drig/poseCorrections'
import { musicSignalAt } from '../../../src/singing/musicSignal.test-support'
import { fixture, importPsd } from './synthetic'

/** A synthetic kind built in the page, or a real package the test serves. */
export type PackageRef = { synthetic: string } | { manifest: MeropeRigManifest, atlasUrl: string }

interface FigurePackage {
  playback: Anime25DPlayback
  manifest?: MeropeRigManifest
  atlasUrl: string
}

const QUIET: Partial<Anime25DDriver> = { idle: false, rand: false, blink: false, talk: false, mouse: false }
const PREVIEW: MotionChannelPolicy = { mouth: 'preview', expression: 'preview', gaze: 'preview', headBody: 'preview' }
const HEAD_SURFACES = new Set(['face', 'front-hair', 'back-hair'])

const synthetic = new Map<string, Promise<FigurePackage>>()

async function resolvePackage(ref: PackageRef): Promise<FigurePackage> {
  if ('manifest' in ref) return { playback: ref.manifest.anime25dPlayback!, manifest: ref.manifest, atlasUrl: ref.atlasUrl }
  let built = synthetic.get(ref.synthetic)
  if (!built) {
    built = importPsd(new File([writePsd(fixture(ref.synthetic), { generateThumbnail: false })], `${ref.synthetic}.psd`),
      { sourceMasterAssetId: '/unused-master.png' })
      .then(prepared => ({ playback: prepared.source.anime25dPlayback!, atlasUrl: URL.createObjectURL(prepared.atlas) }))
    synthetic.set(ref.synthetic, built)
  }
  return built
}

let seed = 1749

/** Math.random seeded for the length of one probe; every player opened restarts it, so replays repeat exactly. */
async function seeded<T>(run: () => Promise<T>): Promise<T> {
  const random = Math.random
  seed = 1749
  Math.random = () => {
    seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  try {
    return await run()
  }
  finally {
    Math.random = random
  }
}

interface Stage {
  pkg: FigurePackage
  player: Anime25DPlayer
  gl: WebGL2RenderingContext
  close: () => void
}

async function open(ref: PackageRef, width = 384, height = 512): Promise<Stage> {
  const pkg = await resolvePackage(ref)
  seed = 1749
  meshPoints.clear()
  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  const player = new Anime25DPlayer(canvas, pkg.playback, pkg.manifest)
  await player.replaceLivePackage(pkg.playback, pkg.manifest, pkg.atlasUrl)
  player.resize(width, height, 1)
  player.setMotionPolicy(PREVIEW)
  // The player's own context: the same canvas hands back the same WebGL2 context.
  const gl = canvas.getContext('webgl2')!
  return { pkg, player, gl, close: () => { player.dispose(); canvas.remove() } }
}

function hold(player: Anime25DPlayer, pose: Partial<Anime25DDriver>, frames = 60, fps = 60): void {
  player.replaceTarget({ ...IDENTITY_DRIVER, ...QUIET, ...pose })
  for (let i = 0; i < frames; i++) player.tick(1 / fps)
}

function readPixels(gl: WebGL2RenderingContext): Uint8Array {
  const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4)
  gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  return pixels
}

function changedPixels(a: Uint8Array, b: Uint8Array, threshold = 0): number {
  let changed = 0
  for (let i = 0; i < a.length; i += 4) {
    if (Math.max(Math.abs(a[i]! - b[i]!), Math.abs(a[i + 1]! - b[i + 1]!), Math.abs(a[i + 2]! - b[i + 2]!), Math.abs(a[i + 3]! - b[i + 3]!)) > threshold) changed++
  }
  return changed
}

function hash(pixels: Uint8Array): number {
  let h = 0
  for (const v of pixels) h = (Math.imul(h, 31) + v) | 0
  return h
}

/** A frame kept with readPixels, as a PNG the right way up. */
function picture(pixels: Uint8Array, width: number, height: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const image = new ImageData(width, height)
  for (let y = 0; y < height; y++) image.data.set(pixels.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4)
  canvas.getContext('2d')!.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png').split(',')[1]!
}

function screenshot(gl: WebGL2RenderingContext): string {
  return (gl.canvas as HTMLCanvasElement).toDataURL('image/png').split(',')[1]!
}

function signedArea(p: Float32Array, a: number, b: number, c: number): number {
  return (p[b * 2]! - p[a * 2]!) * (p[c * 2 + 1]! - p[a * 2 + 1]!) - (p[b * 2 + 1]! - p[a * 2 + 1]!) * (p[c * 2]! - p[a * 2]!)
}

/** A layer's own geometry before its transform: the space the runtime binds layers to each other in. */
function local(view: Anime25DLayerView): Float32Array {
  const m = view.transform
  const det = m[0]! * m[4]! - m[3]! * m[1]!
  const out = new Float32Array(view.placed.length)
  for (let i = 0; i < out.length; i += 2) {
    const x = view.placed[i]! - m[6]!; const y = view.placed[i + 1]! - m[7]!
    out[i] = (m[4]! * x - m[3]! * y) / det
    out[i + 1] = (m[0]! * y - m[1]! * x) / det
  }
  return out
}

interface MeshPoint { a: number, b: number, c: number, u: number, v: number }

/** Rest meshes never change within a player, so where a rest point falls in one is found once (cleared by open()). */
const meshPoints = new Map<string, MeshPoint | null>()

/** The rest triangle holding a point, and its barycentric weights there. Independent of the runtime's own attachment sampling. */
function locate(view: Anime25DLayerView, x: number, y: number): MeshPoint | null {
  const key = `${view.name}|${view.rest.length}|${x},${y}`
  if (meshPoints.has(key)) return meshPoints.get(key)!
  const r = view.rest
  let found: MeshPoint | null = null
  for (let i = 0; i < view.indices.length && !found; i += 3) {
    const a = view.indices[i]!; const b = view.indices[i + 1]!; const c = view.indices[i + 2]!
    const ax = r[a * 2]!; const ay = r[a * 2 + 1]!
    const v0x = r[b * 2]! - ax; const v0y = r[b * 2 + 1]! - ay
    const v1x = r[c * 2]! - ax; const v1y = r[c * 2 + 1]! - ay
    const d = v0x * v1y - v1x * v0y
    if (Math.abs(d) < 1e-9) continue
    const u = ((x - ax) * v1y - v1x * (y - ay)) / d
    const v = (v0x * (y - ay) - (x - ax) * v0y) / d
    if (u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6) found = { a, b, c, u, v }
  }
  meshPoints.set(key, found)
  return found
}

/** Where a rest-space point of a layer is drawn, carried by `positions`. Null outside the mesh. */
function sampleLayer(view: Anime25DLayerView, x: number, y: number, positions = view.placed): Anime25DPoint | null {
  const point = locate(view, x, y)
  if (!point) return null
  const { a, b, c, u, v } = point
  const w = 1 - u - v
  return {
    x: positions[a * 2]! * w + positions[b * 2]! * u + positions[c * 2]! * v,
    y: positions[a * 2 + 1]! * w + positions[b * 2 + 1]! * u + positions[c * 2 + 1]! * v,
  }
}

/** Alpha of a layer's own art at a canvas point, read from the atlas the test served. */
async function atlasAlpha(pkg: FigurePackage) {
  const image = new Image()
  image.src = pkg.atlasUrl
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')!
  context.drawImage(image, 0, 0)
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data
  const sources = new Map(pkg.playback.layers.map(layer => [layer.name, layer]))
  const rgba = (name: string, x: number, y: number): [number, number, number, number] | null => {
    const source = sources.get(name)
    if (!source) return null
    const u = (x - source.x) / source.w
    const v = (y - source.y) / source.h
    if (u < 0 || v < 0 || u >= 1 || v >= 1) return [0, 0, 0, 0]
    const ax = Math.min(canvas.width - 1, Math.floor((source.atlas.x + u * source.atlas.w) * canvas.width))
    const ay = Math.min(canvas.height - 1, Math.floor((source.atlas.y + v * source.atlas.h) * canvas.height))
    const i = (ay * canvas.width + ax) * 4
    return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!]
  }
  return {
    rgba,
    /** Triangles that cover drawn art; layers cut at runtime (no source) keep every triangle. */
    opaqueTriangles(view: Anime25DLayerView): number[] {
      const out: number[] = []
      const r = view.rest
      for (let i = 0; i < view.indices.length; i += 3) {
        const [a, b, c] = [view.indices[i]!, view.indices[i + 1]!, view.indices[i + 2]!]
        if (Math.abs(signedArea(r, a, b, c)) < 1e-8) continue
        const points = [[r[a * 2]!, r[a * 2 + 1]!], [r[b * 2]!, r[b * 2 + 1]!], [r[c * 2]!, r[c * 2 + 1]!],
          [(r[a * 2]! + r[b * 2]! + r[c * 2]!) / 3, (r[a * 2 + 1]! + r[b * 2 + 1]! + r[c * 2 + 1]!) / 3]]
        const coverage = Math.max(...points.map(([x, y]) => rgba(view.name, x!, y!)?.[3] ?? 255))
        if (coverage >= 128) out.push(i)
      }
      return out
    },
  }
}

/** The smallest drawn/rest area ratio over the given triangles; ≤0 means a fold. */
function minAreaRatio(view: Anime25DLayerView, triangles: readonly number[], positions = view.placed): number {
  let minimum = Infinity
  for (const i of triangles) {
    const [a, b, c] = [view.indices[i]!, view.indices[i + 1]!, view.indices[i + 2]!]
    minimum = Math.min(minimum, signedArea(positions, a, b, c) / signedArea(view.rest, a, b, c))
  }
  return minimum
}

/**
 * Each earring's root, against the ear's own surface at that art point. Only
 * earrings: a clip on the back hair follows the head's turn, not the back
 * hair's mesh at that point, and a neckwear bridge hangs between two hosts.
 */
function rootErrors(inspection: Anime25DInspection): { checked: number, error: number } {
  let checked = 0
  let error = 0
  for (const layer of inspection.layers) {
    if (!layer.hangsFrom || layer.role !== 'earwear') continue
    const host = inspection.layers.find(candidate => candidate.name === layer.hangsFrom!.host)
    const onHost = host && sampleLayer(host, layer.hangsFrom.rest.x, layer.hangsFrom.rest.y)
    if (!onHost) continue
    checked++
    error = Math.max(error, Math.hypot(layer.hangsFrom.placed.x - onHost.x, layer.hangsFrom.placed.y - onHost.y))
  }
  return { checked, error }
}

function finite(inspection: Anime25DInspection): boolean {
  return inspection.layers.every(layer => layer.placed.every(Number.isFinite))
    && (inspection.collarAperture?.placed.every(Number.isFinite) ?? true)
}

function centroid(view: Anime25DLayerView, draw: Anime25DInspection['draw']): Anime25DPoint {
  let x = 0; let y = 0
  for (let i = 0; i < view.placed.length; i += 2) {
    const p = draw({ x: view.placed[i]!, y: view.placed[i + 1]! })
    x += p.x; y += p.y
  }
  return { x: x / (view.placed.length / 2), y: y / (view.placed.length / 2) }
}

/** What a package carries, so a probe can say why it does not apply. */
async function features(ref: PackageRef) {
  return seeded(async () => {
    const stage = await open(ref)
    try {
      hold(stage.player, {}, 30)
      const inspection = stage.player.inspect()
      const roles = (role: string) => inspection.layers.filter(layer => layer.role === role).length
      return {
        layers: inspection.layers.length,
        skinContacts: inspection.layers.filter(layer => layer.skinContact).length,
        earrings: inspection.layers.filter(layer => layer.role === 'earwear' && layer.hangsFrom).length,
        hair: inspection.layers.filter(layer => layer.hairBase).length,
        collarAperture: Boolean(inspection.collarAperture),
        collarRoles: roles('collar-front') + roles('collar-back'),
        crownBand: Boolean(inspection.crownBand),
        sharedCuts: inspection.layers.filter(layer => layer.sharesCutWith).length,
        strands: stage.pkg.playback.layers.reduce((n, layer) => n + (layer.strands?.length ?? 0), 0),
      }
    }
    finally { stage.close() }
  })
}

/** The shared body stage on the GPU agrees with the CPU mirror inspect().draw is built on. */
function bodyStageProjection(): number {
  const gl = document.createElement('canvas').getContext('webgl2')!
  const compile = (kind: number, code: string) => {
    const shader = gl.createShader(kind)!
    gl.shaderSource(shader, code)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)!)
    return shader
  }
  const program = gl.createProgram()
  const vs = compile(gl.VERTEX_SHADER, `#version 300 es\nin vec2 p; out vec2 result; uniform vec4 f; uniform vec3 pose;\n${BODY_LIFT_GLSL}\nvoid main(){result=bodyLift(bodyPitch(p,f,pose),f);gl_Position=vec4(0.,0.,0.,1.);}`)
  const fs = compile(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;out vec4 color;void main(){color=vec4(1.);}')
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.transformFeedbackVaryings(program, ['result'], gl.INTERLEAVED_ATTRIBS)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)!)
  gl.useProgram(program)
  const input = Float32Array.from(Array.from({ length: 51 }, (_, i) => [200 + i * 11, 200 + i * 24]).flat())
  const vao = gl.createVertexArray()
  gl.bindVertexArray(vao)
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, input, gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(program, 'p')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
  const output = gl.createBuffer()
  gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, output)
  gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, input.byteLength, gl.DYNAMIC_READ)
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, output)
  const values = new Float32Array(input.length)
  let maximum = 0
  gl.enable(gl.RASTERIZER_DISCARD)
  for (const pitch of [-0.18, 0, 0.18]) {
    for (const amount of [-25, 0, 25]) {
      const field = { centerX: 500, upperY: 800, lowerY: 1200, amount, pitch, depth: 220, shoulderY: 600 }
      gl.uniform4f(gl.getUniformLocation(program, 'f'), 500, 800, 1200, amount)
      gl.uniform3fv(gl.getUniformLocation(program, 'pose'), bodyPitchUniform(field, new Float32Array(3)))
      gl.beginTransformFeedback(gl.POINTS)
      gl.drawArrays(gl.POINTS, 0, input.length / 2)
      gl.endTransformFeedback()
      gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, values)
      for (let i = 0; i < input.length; i += 2) {
        const p = { x: input[i]!, y: input[i + 1]! }
        applyBodyLift(p, field)
        maximum = Math.max(maximum, Math.abs(values[i]! - p.x), Math.abs(values[i + 1]! - p.y))
      }
    }
  }
  if (gl.getError()) throw new Error('GPU posture replay failed')
  gl.getExtension('WEBGL_lose_context')?.loseContext()
  return maximum
}

/** Lift and pitch the torso through the driver: the posture reaches pixels and keeps its shape. */
async function posture(ref: PackageRef) {
  return seeded(async () => {
    const { pkg, player, gl, close } = await open(ref)
    try {
      const neck = { x: pkg.playback.anchors.neckPivot.x, y: pkg.playback.anchors.neckBottom }
      const cut = { x: pkg.playback.anchors.neckPivot.x + 50, y: pkg.playback.pixelCanvas.height }
      const poses = []
      const shots = []
      let neutral: Uint8Array | null = null
      // Each layer as drawn upright: a standing figure's lean is in its layers' own vertices, not the shader's stage.
      const upright = new Map<string, Float32Array>()
      for (const [lift, pitch] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]] as const) {
        hold(player, { bodyLift: lift, bodyPitch: pitch, phys: false })
        const inspection = player.inspect()
        const pixels = readPixels(gl)
        neutral ??= pixels
        const drawnNeck = inspection.draw(neck)
        const drawnCut = inspection.draw(cut)
        let shapeRatio = Infinity
        let uprightRatio = Infinity
        for (const layer of inspection.layers) {
          if (layer.opacity < 0.01) continue
          const drawn = new Float32Array(layer.placed.length)
          for (let i = 0; i < drawn.length; i += 2) {
            const p = inspection.draw({ x: layer.placed[i]!, y: layer.placed[i + 1]! })
            drawn[i] = p.x; drawn[i + 1] = p.y
          }
          if (!upright.has(layer.name)) upright.set(layer.name, drawn)
          const stood = upright.get(layer.name)!
          for (let i = 0; i < layer.indices.length; i += 3) {
            const [a, b, c] = [layer.indices[i]!, layer.indices[i + 1]!, layer.indices[i + 2]!]
            const before = signedArea(layer.placed, a, b, c)
            if (Math.abs(before) > 0.01) shapeRatio = Math.min(shapeRatio, signedArea(drawn, a, b, c) / before)
            const standing = stood.length === drawn.length ? signedArea(stood, a, b, c) : 0
            if (Math.abs(standing) > 0.01) uprightRatio = Math.min(uprightRatio, signedArea(drawn, a, b, c) / standing)
          }
        }
        poses.push({ lift, pitch, amount: inspection.posture.lift, pitchAmount: inspection.posture.pitch,
          neckShift: drawnNeck.y - neck.y, cutShift: drawnCut.y - cut.y, hash: hash(pixels),
          changed: changedPixels(neutral, pixels, 12), pixels: pixels.length / 4, shapeRatio, uprightRatio })
        shots.push({ name: `${lift}-${pitch}`, image: screenshot(gl) })
      }
      // Existing head performances recruit the posture without knowing about it.
      hold(player, { angleY: 0.8, phys: false })
      const recruited = player.inspect().posture
      // How far a full lift reaches, from the art's own proportions (not the canvas: a full body is many faces tall).
      const { face, neckBottom, bodyPivot } = pkg.playback.anchors
      const reach = Math.min((face.y1 - face.y0) * 0.05, Math.max(1, bodyPivot.y - neckBottom) * 0.035)
      return { poses, shots, recruited, reach, error: gl.getError() }
    }
    finally { close() }
  })
}

/** A short head turn reaches the torso within the cue, and the torso returns to rest. */
async function torsoTurn(ref: PackageRef) {
  return seeded(async () => {
    const run = async (cueFrames: number) => {
      const { player, gl, close } = await open(ref)
      try {
        hold(player, { phys: true }, 30)
        let atCueEnd = 0
        for (let frame = 0; frame < 180; frame++) {
          player.setTarget({ angleX: frame < cueFrames ? 1 : 0 })
          player.tick(1 / 60)
          if (frame === Math.min(cueFrames, 180) - 1) atCueEnd = player.inspect().posture.torsoYaw
        }
        return { atCueEnd, residual: Math.abs(player.inspect().posture.torsoYaw), error: gl.getError() }
      }
      finally { close() }
    }
    return { short: await run(18), sustained: await run(180) }
  })
}

/** Continuous head and body turns at several frame rates: earrings stay on the ears, and nothing jumps. */
async function turns(ref: PackageRef) {
  return seeded(async () => {
    const metrics = []
    for (const fps of [30, 60, 120]) {
      const { pkg, player, gl, close } = await open(ref)
      try {
        const alpha = await atlasAlpha(pkg)
        // Start from the sweep's own constant inputs, so its first frames are not a step response.
        hold(player, { phys: true, bodyYaw: 1 }, 60)
        let roots = 0; let rootsChecked = 0; let minRatio = Infinity
        let maxSpeed = 0; let invalid = 0
        let previous: Anime25DPoint | null = null
        const trajectory: Anime25DPoint[] = []
        const surfaces = player.inspect().layers.filter(layer => HEAD_SURFACES.has(layer.role)).map(layer => alpha.opaqueTriangles(layer))
        for (let frame = 0; frame < fps * 3; frame++) {
          const yaw = Math.sin(frame / fps * Math.PI * 2 / 3)
          player.setTarget({ angleX: yaw, angleY: yaw * 0.6, angleZ: -yaw * 0.7, body: yaw * 0.8, bodyYaw: 1, phys: true })
          player.tick(1 / fps)
          const inspection = player.inspect()
          if (!finite(inspection)) invalid++
          const root = rootErrors(inspection)
          roots = Math.max(roots, root.error)
          rootsChecked = Math.max(rootsChecked, root.checked)
          inspection.layers.filter(layer => HEAD_SURFACES.has(layer.role)).forEach((layer, i) => {
            if (layer.opacity >= 0.01) minRatio = Math.min(minRatio, minAreaRatio(layer, surfaces[i]!))
          })
          const face = inspection.layers.find(layer => layer.role === 'face')!
          const center = centroid(face, inspection.draw)
          if (previous) maxSpeed = Math.max(maxSpeed, Math.hypot(center.x - previous.x, center.y - previous.y) * fps)
          previous = center
          // After whole seconds of ticks, the same moment at every frame rate.
          if ((frame + 1) % fps === 0) trajectory.push(center)
        }
        metrics.push({ fps, roots, rootsChecked, minRatio, maxSpeed, invalid, trajectory, error: gl.getError() })
      }
      finally { close() }
    }
    return metrics
  })
}

/** Every corner of combined head turns: visible head surfaces stay oriented. */
async function corners(ref: PackageRef) {
  return seeded(async () => {
    const { pkg, player, gl, close } = await open(ref)
    try {
      const alpha = await atlasAlpha(pkg)
      hold(player, { phys: false })
      const surfaces = player.inspect().layers.filter(layer => HEAD_SURFACES.has(layer.role))
      const triangles = surfaces.map(layer => alpha.opaqueTriangles(layer))
      const runs = []
      const shots = []
      for (const angleX of [-1, 1]) {
        for (const angleY of [-1, 1]) {
          for (const angleZ of [-0.8, 0.8]) {
            hold(player, { angleX, angleY, angleZ, body: angleZ, phys: false })
            const inspection = player.inspect()
            let minimum = Infinity; let worst = ''
            inspection.layers.filter(layer => HEAD_SURFACES.has(layer.role)).forEach((layer, i) => {
              const ratio = minAreaRatio(layer, triangles[i]!)
              if (ratio < minimum) { minimum = ratio; worst = layer.name }
            })
            const pose = `${angleX}:${angleY}:${angleZ}`
            runs.push({ pose, minimum, worst, visibleTriangles: triangles.reduce((n, t) => n + t.length, 0) })
            shots.push({ name: `corner-${pose}`, image: screenshot(gl) })
          }
        }
      }
      return { runs, shots, crownBand: player.inspect().crownBand, error: gl.getError() }
    }
    finally { close() }
  })
}

/** An authored correction moves only its own combination pose, and releasing it restores every pixel. */
async function correction(ref: PackageRef) {
  return seeded(async () => {
    const poses: Partial<Anime25DDriver>[] = [
      { angleX: 0, angleY: 0, eyeOpenL: 0, eyeOpenR: 0 },
      { angleX: 0.8, angleY: 0, eyeOpenL: 0, eyeOpenR: 0 },
      { angleX: 0, angleY: -0.6, eyeOpenL: 0, eyeOpenR: 0 },
      { angleX: 0.8, angleY: -0.6, eyeOpenL: 1, eyeOpenR: 1 },
      { angleX: 0.8, angleY: -0.6, eyeOpenL: 0, eyeOpenR: 0 },
      { angleX: 0.8, angleY: 0, eyeOpenL: 0, eyeOpenR: 0 },
    ]
    const pkg = await resolvePackage(ref)
    const eye = pkg.playback.anchors.eyeL
    if (!eye) throw new Error('The package needs an eye anchor')
    const head = pkg.playback.shellProfile.head
    // A deliberately visible stroke: it proves authoring reaches pixels, not that it is the right pose.
    const authored: PoseCorrection = { surface: 'head', at: { angleX: 0.8, angleY: -0.6, eyeCloseL: 1 },
      patches: [poseCorrectionPatch(head, { x: eye.icx, y: eye.closeY }, { x: 0, y: 0 }, { x: 0, y: -16 }, { x: head.radiusX * 0.45, y: head.radiusY * 0.4 })] }
    const run = async (corrections: 'none' | 'authored' | 'released') => {
      const { player, gl, close } = await open(ref)
      try {
        if (corrections !== 'none') player.previewPoseCorrections([authored])
        if (corrections === 'released') player.previewPoseCorrections(null)
        return poses.map((pose) => {
          hold(player, { ...pose, phys: false }, 120)
          const inspection = player.inspect()
          const face = inspection.layers.find(layer => layer.role === 'face')!
          return {
            pixels: readPixels(gl),
            body: inspection.layers.filter(layer => layer.group !== 'head').map(layer => layer.placed),
            eye: sampleLayer(face, eye.icx, eye.closeY),
            image: screenshot(gl),
            error: gl.getError(),
          }
        })
      }
      finally { close() }
    }
    const [before, after, released] = [await run('none'), await run('authored'), await run('released')]
    const differences = poses.map((_, i) => {
      let bodyError = 0
      before[i]!.body.forEach((points, j) => points.forEach((v, k) => { bodyError = Math.max(bodyError, Math.abs(v - after[i]!.body[j]![k]!)) }))
      const a = before[i]!.eye; const b = after[i]!.eye
      return {
        changed: changedPixels(before[i]!.pixels, after[i]!.pixels),
        restored: changedPixels(before[i]!.pixels, released[i]!.pixels),
        bodyError,
        eyeShift: a && b ? Math.hypot(b.x - a.x, b.y - a.y) : NaN,
        error: Math.max(before[i]!.error, after[i]!.error, released[i]!.error),
      }
    })
    return { differences, shots: [{ name: 'baseline-combination', image: before[4]!.image }, { name: 'authored-combination', image: after[4]!.image }] }
  })
}

/** A high collar keeps its own opening through motion, and nothing near it is sewn to skin. */
async function collar(ref: PackageRef) {
  return seeded(async () => {
    const { player, gl, close } = await open(ref)
    try {
      hold(player, {}, 30)
      const start = player.inspect()
      if (!start.collarAperture) return { aperture: false as const, error: gl.getError() }
      const roles = start.layers.filter(layer => ['neck', 'collar-front', 'collar-back'].includes(layer.role))
      const sleeves = start.layers.filter(layer => layer.role === 'handwear')
      let excursion = 0; let invalid = 0
      for (let frame = 0; frame < 120; frame++) {
        const t = frame / 60
        player.setTarget({ bodyYaw: Math.sin(t * 2.3), body: Math.sin(t * 1.7), angleX: Math.sin(t * 1.5),
          angleY: Math.cos(t * 1.9) * 0.7, angleZ: Math.sin(t * 2.1) * 0.7 })
        player.tick(1 / 60)
        const aperture = player.inspect().collarAperture!
        if (!aperture.placed.every(Number.isFinite)) invalid++
        for (let i = 0; i < aperture.placed.length; i++) excursion = Math.max(excursion, Math.abs(aperture.placed[i]! - start.collarAperture.placed[i]!))
      }
      return { aperture: true as const, roles: roles.map(layer => layer.role), contacts: roles.filter(layer => layer.skinContact).length,
        sleeves: sleeves.length, sleeveContacts: sleeves.filter(layer => layer.skinContact).length, excursion, invalid,
        shot: screenshot(gl), error: gl.getError() }
    }
    finally { close() }
  })
}

/** An exposed shoulder stays sewn to the torso's drawn edge through body and arm motion. */
async function shoulder(ref: PackageRef) {
  return seeded(async () => {
    const pkg = await resolvePackage(ref)
    const alpha = await atlasAlpha(pkg)
    const sweeps = []
    let contactNames: string[] = []
    let boundaryCount = 0
    for (const fps of [30, 60, 120]) {
      const { player, gl, close } = await open(ref, 512, 700)
      try {
        hold(player, {}, 30)
        const start = player.inspect()
        const contacts = start.layers.filter(layer => layer.skinContact)
        contactNames = contacts.map(layer => layer.name)
        const torso = start.layers.find(layer => layer.role === 'topwear')
        if (contacts.length === 0 || !torso) return { contacts: contactNames, boundary: 0, sweeps: [] }
        // The torso's own skin edge inside each arm, found in the art, not in the binding.
        const skin = (name: string, x: number, y: number) => {
          const [r, g, b, a] = alpha.rgba(name, x, y) ?? [0, 0, 0, 0]
          return a > 220 && r > 100 && r > g + 3 && g > b - 12 && r - b > 8 && r - g < 85
        }
        const torsoSource = pkg.playback.layers.find(layer => layer.name === torso.name)!
        const boundary: { arm: string, x: number, y: number }[] = []
        for (const contact of contacts) {
          const source = pkg.playback.layers.find(layer => layer.name === contact.name)
          if (!source) continue
          const fromLeft = source.x < torsoSource.x + torsoSource.w / 2
          for (let y = source.y; y < source.y + source.h * 0.5; y += 4) {
            let edge = -1
            for (let n = 0; n < torsoSource.w; n++) {
              const x = fromLeft ? torsoSource.x + n : torsoSource.x + torsoSource.w - 1 - n
              if ((alpha.rgba(torso.name, x + 0.5, y)?.[3] ?? 0) > 220) { edge = x + 0.5; break }
            }
            if (edge < 0 || !skin(contact.name, edge, y) || !skin(torso.name, edge + (fromLeft ? 4 : -4), y)) continue
            boundary.push({ arm: contact.name, x: edge, y })
          }
        }
        boundaryCount = boundary.length
        const hair = start.layers.filter(layer => layer.hairBase)
        const hairTriangles = hair.map(layer => alpha.opaqueTriangles(layer))
        let seam = 0; let contactRatio = Infinity; let hairRatio = Infinity; let invalid = 0
        for (let frame = 0; frame < fps * 4; frame++) {
          const t = frame / fps
          player.setTarget({ bodyYaw: Math.sin(t * 2.3), body: Math.sin(t * 1.7), armY: Math.sin(t * 2.7), armPos: Math.cos(t * 1.3),
            angleX: Math.sin(t * 1.5), angleY: Math.cos(t * 1.9) * 0.7, angleZ: Math.sin(t * 2.1) * 0.7 })
          player.tick(1 / fps)
          if (frame % 2) continue
          const inspection = player.inspect()
          if (!finite(inspection)) invalid++
          const body = inspection.layers.find(layer => layer.name === torso.name)!
          for (const point of boundary) {
            const arm = inspection.layers.find(layer => layer.name === point.arm)!
            const a = sampleLayer(arm, point.x, point.y)
            const b = sampleLayer(body, point.x, point.y)
            if (a && b) seam = Math.max(seam, Math.hypot(a.x - b.x, a.y - b.y))
          }
          for (const contact of inspection.layers.filter(layer => layer.skinContact)) {
            const all = Array.from({ length: contact.indices.length / 3 }, (_, i) => i * 3)
            contactRatio = Math.min(contactRatio, minAreaRatio(contact, all))
          }
          inspection.layers.filter(layer => layer.hairBase).forEach((layer, i) => {
            hairRatio = Math.min(hairRatio, minAreaRatio(layer, hairTriangles[i] ?? []))
          })
        }
        sweeps.push({ fps, seam, contactRatio, hairRatio, invalid, error: gl.getError() })
      }
      finally { close() }
    }
    // Settled poses the performances actually reach: arms, cues, thinking, head corners.
    const { player, gl, close } = await open(ref, 512, 700)
    try {
      const poses: Partial<Anime25DDriver>[] = [
        { bodyYaw: 1, body: 1, armY: 1, armPos: 1 },
        { bodyYaw: -1, body: -1, armY: -1, armPos: -1 },
        ...(['greet', 'delight', 'emphasize'] as const).map(intent => intentExpressionPatch(intent, 1.4) as Partial<Anime25DDriver>),
        { ...THINKING_EXPRESSION_PRESET },
        ...[-1, 1].flatMap(yaw => [-1, 1].flatMap(pitch => [1, 0].map(open => ({
          angleX: yaw, angleY: pitch * 0.85, angleZ: yaw * 0.85, eyeOpenL: open, eyeOpenR: open })))),
      ]
      const settled = []
      for (const pose of poses) {
        hold(player, pose)
        const inspection = player.inspect()
        settled.push({ finite: finite(inspection), error: gl.getError(), shot: screenshot(gl) })
      }
      return { contacts: contactNames, boundary: boundaryCount, sweeps, settled }
    }
    finally { close() }
  })
}

/** Earrings swing on their own while their roots stay on the ear. */
async function earrings(ref: PackageRef) {
  return seeded(async () => {
    const run = async (phys: boolean) => {
      const { player, gl, close } = await open(ref, 384, 512)
      try {
        hold(player, { phys }, 30)
        let roots = 0; let checked = 0; let determinant = Infinity
        const tips: Float32Array[] = []
        for (let i = 0; i < 240; i++) {
          const angle = Math.sin(i / 24) * 0.8
          player.setTarget({ phys, angleX: angle, angleY: angle * 0.6, angleZ: angle * 0.6 })
          player.tick(1 / 60)
          const inspection = player.inspect()
          const root = rootErrors(inspection)
          roots = Math.max(roots, root.error)
          checked = Math.max(checked, root.checked)
          const hanging = inspection.layers.filter(layer => layer.role === 'earwear' && layer.hangsFrom)
          for (const layer of hanging) determinant = Math.min(determinant, layer.transform[0]! * layer.transform[4]! - layer.transform[1]! * layer.transform[3]!)
          tips.push(Float32Array.from(hanging.flatMap(layer => Array.from(layer.placed))))
        }
        const names = player.inspect().layers.filter(layer => layer.role === 'earwear' && layer.hangsFrom).map(layer => layer.name)
        return { names, roots, checked, determinant, tips, error: gl.getError() }
      }
      finally { close() }
    }
    const swinging = await run(true)
    const still = await run(false)
    let swing = 0
    swinging.tips.forEach((points, frame) => points.forEach((v, i) => { swing = Math.max(swing, Math.abs(v - still.tips[frame]![i]!)) }))
    return { names: swinging.names, roots: Math.max(swinging.roots, still.roots), checked: swinging.checked,
      determinant: Math.min(swinging.determinant, still.determinant), swing, error: Math.max(swinging.error, still.error) }
  })
}

/** Every hair vertex as drawn, one array per hair layer. */
function hairPositions(inspection: Anime25DInspection): Float32Array[] {
  return inspection.layers.filter(layer => layer.hairBase).map(layer => layer.placed)
}

/** Largest signed x/y differences between two frames of the same hair. */
function hairDifference(a: Float32Array[], b: Float32Array[]) {
  let minX = 0; let maxX = 0; let minY = 0; let maxY = 0; let max = 0
  a.forEach((points, k) => {
    for (let i = 0; i < points.length; i += 2) {
      const dx = points[i]! - b[k]![i]!
      const dy = points[i + 1]! - b[k]![i + 1]!
      minX = Math.min(minX, dx); maxX = Math.max(maxX, dx)
      minY = Math.min(minY, dy); maxY = Math.max(maxY, dy)
      max = Math.max(max, Math.hypot(dx, dy))
    }
  })
  return { minX, maxX, minY, maxY, max }
}

/**
 * Hair follows a nod both ways, a combined turn without tearing, and a
 * body-only move, then settles. Follow-through is measured against the same
 * replay with physics off: everything else about the frame is identical.
 */
async function hair(ref: PackageRef) {
  return seeded(async () => {
    const pkg = await resolvePackage(ref)
    const alpha = await atlasAlpha(pkg)
    const replay = async (phys: boolean, frames: number, pose: (frame: number) => Partial<Anime25DDriver>, keep: (frame: number) => boolean, shape = true) => {
      const { player, gl, close } = await open(ref)
      try {
        hold(player, { phys }, 30)
        const hair: Float32Array[][] = []
        const pixels: Uint8Array[] = []
        let ratio = Infinity
        const triangles = player.inspect().layers.filter(layer => layer.hairBase).map(layer => alpha.opaqueTriangles(layer))
        for (let frame = 0; frame < frames; frame++) {
          player.setTarget({ ...pose(frame), phys })
          player.tick(1 / 60)
          if (!keep(frame) && (!shape || frame % 4)) continue
          const inspection = player.inspect()
          if (shape) inspection.layers.filter(layer => layer.hairBase).forEach((layer, i) => { ratio = Math.min(ratio, minAreaRatio(layer, triangles[i] ?? [])) })
          if (keep(frame)) {
            hair.push(hairPositions(inspection))
            pixels.push(readPixels(gl))
          }
        }
        return { hair, pixels, size: [gl.drawingBufferWidth, gl.drawingBufferHeight] as const, ratio, shot: screenshot(gl), driver: player.inspect().driver, error: gl.getError(), inspection: player.inspect() }
      }
      finally { close() }
    }
    // Nod: the hair lags both up and down, and that reaches pixels.
    const nodPose = (frame: number) => ({ angleY: frame < 30 ? 0.85 : frame < 60 ? -0.85 : 0 })
    const every = () => true
    const [nod, nodRigid] = [await replay(true, 120, nodPose, every), await replay(false, 120, nodPose, every)]
    const nodLag = { minY: 0, maxY: 0, pixels: 0 }
    nod.hair.forEach((frame, i) => {
      const d = hairDifference(frame, nodRigid.hair[i]!)
      nodLag.minY = Math.min(nodLag.minY, d.minY)
      nodLag.maxY = Math.max(nodLag.maxY, d.maxY)
      nodLag.pixels = Math.max(nodLag.pixels, changedPixels(nod.pixels[i]!, nodRigid.pixels[i]!, 8))
    })
    // Combined turn: different strands' roots move apart (each follows its own projected support),
    // and no edge stretches far beyond the rigid hair's.
    const strands = pkg.playback.layers.flatMap(layer => (layer.strands ?? []).map(strand => ({ layer: layer.name, x: strand.x, y: strand.rootY })))
    const combinedPose = (frame: number) => {
      const direction = frame < 80 ? 1 : frame < 160 ? -1 : 0
      return { angleX: direction * 0.9, angleY: Math.sin(frame / 60 * Math.PI) * 0.85, angleZ: direction * 0.7 }
    }
    const sampled = (frame: number) => frame % 4 === 0
    const [combined, combinedRigid] = [await replay(true, 240, combinedPose, sampled), await replay(false, 240, combinedPose, sampled)]
    const hairViews = combined.inspection.layers.filter(layer => layer.hairBase)
    let spread = 0; let edgeRatio = 1
    // Kept in an object: written inside the callbacks below, which a bare `let` would not see narrowed.
    const worst: { edge: { layer: string, frame: number, rigid: number, stretched: number, at: Anime25DPoint } | null } = { edge: null }
    combined.hair.forEach((frame, n) => {
      const rigid = combinedRigid.hair[n]!
      const shifts: number[] = []
      for (const strand of strands) {
        const k = hairViews.findIndex(view => view.name === strand.layer)
        if (k < 0) continue
        const drawn = sampleLayer(hairViews[k]!, strand.x, strand.y, frame[k])
        if (drawn) shifts.push(drawn.x - strand.x)
      }
      if (shifts.length) spread = Math.max(spread, Math.max(...shifts) - Math.min(...shifts))
      hairViews.forEach((view, k) => {
        for (const i of alpha.opaqueTriangles(view)) {
          for (const [u, v] of [[0, 1], [1, 2], [2, 0]] as const) {
            const a = view.indices[i + u]! * 2; const b = view.indices[i + v]! * 2
            const length = Math.hypot(rigid[k]![a]! - rigid[k]![b]!, rigid[k]![a + 1]! - rigid[k]![b + 1]!)
            if (length <= 0.5) continue
            const stretched = Math.hypot(frame[k]![a]! - frame[k]![b]!, frame[k]![a + 1]! - frame[k]![b + 1]!)
            if (stretched / length > edgeRatio) {
              edgeRatio = stretched / length
              worst.edge = { layer: view.name, frame: n * 4, rigid: length, stretched, at: { x: (frame[k]![a]! + frame[k]![b]!) / 2, y: (frame[k]![a + 1]! + frame[k]![b + 1]!) / 2 } }
            }
          }
        }
      })
    })
    // Body-only move: the head's own angles stay zero, yet the hair trails, then its follow-through comes to rest
    // (breathing and the like keep the whole figure moving; only the difference from the rigid replay must stop).
    // Its shapes are the nod's and the turn's; checking them over fifteen seconds only costs time.
    const trailPose = () => ({ body: 1 })
    const trailKeep = (frame: number) => frame < 60 || frame >= 840
    const [trail, trailRigid] = [await replay(true, 900, trailPose, trailKeep, false), await replay(false, 900, trailPose, trailKeep, false)]
    let peak = 0
    for (let i = 0; i < 60; i++) peak = Math.max(peak, hairDifference(trail.hair[i]!, trailRigid.hair[i]!).max)
    const followThrough = (i: number) => trail.hair[i]!.map((points, k) => Float32Array.from(points, (v, j) => v - trailRigid.hair[i]![k]![j]!))
    let settledMotion = 0
    for (let i = 61; i < trail.hair.length; i++) settledMotion = Math.max(settledMotion, hairDifference(followThrough(i), followThrough(i - 1)).max * 60)
    return {
      nod: { ...nodLag, ratio: nod.ratio, error: Math.max(nod.error, nodRigid.error) },
      combined: { strands: strands.length, spread, edgeRatio, worstEdge: worst.edge, ratio: combined.ratio, error: Math.max(combined.error, combinedRigid.error) },
      trail: { peak, headMoved: Math.max(Math.abs(trail.driver.angleX), Math.abs(trail.driver.angleZ)), settledMotion, error: Math.max(trail.error, trailRigid.error) },
      shots: [{ name: 'hair-nod', image: nod.shot }, ...worst.edge
        ? [{ name: 'hair-turn-most-stretched', image: picture(combined.pixels[worst.edge.frame / 4]!, ...combined.size) },
            { name: 'hair-turn-most-stretched-rigid', image: picture(combinedRigid.pixels[worst.edge.frame / 4]!, ...combined.size) }]
        : []],
    }
  })
}

/** Music stops and idle takes over without the head or hair being reset. */
async function musicExit(ref: PackageRef) {
  return seeded(async () => {
    const runs = []
    for (const fps of [30, 60, 120]) {
      const { player, gl, close } = await open(ref, 384, 512)
      try {
        player.setTarget({ ...IDENTITY_DRIVER, talk: false, blink: false })
        player.setMotionPolicy({ mouth: 'idle', expression: 'idle', gaze: 'idle', headBody: 'music' })
        player.setSingingTrack('transition-regression')
        player.setSinging(true)
        const ranges = { music: [Infinity, -Infinity], idle: [Infinity, -Infinity] }
        let reset = false; let peakAcceleration = 0; let musicAcceleration = 0; let idleHairTravel = 0
        let previous: Float32Array | null = null; let velocity: Float32Array | null = null
        let previousHair: Float32Array[] | null = null
        for (let frame = 0; frame < fps * 14; frame++) {
          const time = frame / fps
          if (frame === fps * 6) {
            const before = JSON.stringify(player.getCurrent())
            player.setSinging(false)
            player.setMusicSignal(null)
            player.clearBehaviorMotionUnits()
            player.setMotionPolicy({ mouth: 'idle', expression: 'idle', gaze: 'idle', headBody: 'idle' })
            reset = JSON.stringify(player.getCurrent()) !== before
          }
          if (time < 6) player.setMusicSignal(musicSignalAt(time, { bpm: 100 }))
          player.tick(1 / fps)
          const inspection = player.inspect()
          const range = time >= 9 ? ranges.idle : time >= 3 && time < 6 ? ranges.music : null
          if (range) { range[0] = Math.min(range[0]!, inspection.driver.angleX); range[1] = Math.max(range[1]!, inspection.driver.angleX) }
          const face = inspection.layers.find(layer => layer.role === 'face')!.placed
          if (previous) {
            const next = Float32Array.from(face, (v, i) => (v - previous![i]!) * fps)
            // The handover's acceleration, against the music's own beats just before it.
            if (velocity && time >= 3 && time <= 6.8) {
              let peak = 0
              for (let i = 0; i < next.length; i++) peak = Math.max(peak, Math.abs(next[i]! - velocity[i]!) * fps)
              if (time >= 5.8) peakAcceleration = Math.max(peakAcceleration, peak)
              else musicAcceleration = Math.max(musicAcceleration, peak)
            }
            velocity = next
          }
          previous = face
          const hair = inspection.layers.filter(layer => layer.hairBase).map(layer => layer.placed)
          if (previousHair && time >= 9) {
            hair.forEach((points, k) => points.forEach((v, i) => { idleHairTravel = Math.max(idleHairTravel, Math.abs(v - previousHair![k]![i]!) * fps) }))
          }
          previousHair = hair
        }
        runs.push({ fps, reset, peakAcceleration, musicAcceleration, musicRange: ranges.music[1]! - ranges.music[0]!, idleRange: ranges.idle[1]! - ranges.idle[0]!, idleHairTravel, error: gl.getError() })
      }
      finally { close() }
    }
    return runs
  })
}

/** Speech arriving during a thought keeps a newer face and lets the thought go without a jump. */
async function thoughtToSpeech(ref: PackageRef) {
  return seeded(async () => {
    const { player, gl, close } = await open(ref, 384, 512)
    try {
      player.replaceTarget({ ...IDENTITY_DRIVER, ...QUIET, ...THINKING_EXPRESSION_PRESET })
      let reset = false; let brow = 0; let thinking = true
      let previous = player.getCurrent(); let maxHeadStep = 0; let mouthPeak = 0
      for (let frame = 0; frame < 300; frame++) {
        if (frame === 90) {
          // An independent newer face writes the SAME value as the thought preset.
          player.setTarget({ brow: 0.24 })
          const before = JSON.stringify(player.getCurrent())
          player.setSpeechActive(true)
          player.setTarget({ talk: true })
          player.setMotionPolicy({ mouth: 'speech', expression: 'idle', gaze: 'idle', headBody: 'coSpeech' })
          player.enqueueSpeechText('我想好了。这个办法可以试一试，我们慢慢来。', 'zh-CN')
          reset = before !== JSON.stringify(player.getCurrent())
          brow = player.getTarget().brow
          thinking = player.getTarget().thinking
        }
        if (frame === 210) {
          player.clearSpeechText()
          player.setSpeechActive(false)
          player.setTarget({ talk: false, mouthOpen: 0 })
          player.setMotionPolicy({ mouth: 'idle', expression: 'idle', gaze: 'idle', headBody: 'idle' })
        }
        player.tick(1 / 60)
        const current = player.getCurrent()
        if (frame >= 89 && frame < 150) {
          for (const key of ['angleX', 'angleY', 'angleZ', 'body'] as const) maxHeadStep = Math.max(maxHeadStep, Math.abs(current[key] - previous[key]))
        }
        if (frame >= 100 && frame < 210) mouthPeak = Math.max(mouthPeak, current.mouthOpen)
        previous = current
      }
      return { reset, brow, thinking, maxHeadStep, mouthPeak, released: !player.getCurrent().thinking, error: gl.getError() }
    }
    finally { close() }
  })
}

/** Layers cut by the canvas edge together stay joined along that cut, whatever moves above it. */
async function sharedCut(ref: PackageRef) {
  return seeded(async () => {
    const { pkg, player, gl, close } = await open(ref)
    try {
      hold(player, {}, 30)
      const bound = player.inspect().layers.filter(layer => layer.sharesCutWith)
      let maxError = 0; let folds = 0
      for (const sign of [0, 1, -1, 0.6, -0.6]) {
        hold(player, { phys: true, angleX: sign, angleY: sign * 0.7, angleZ: sign * 0.6, body: sign, armY: sign, armPos: sign * 0.5 })
        const inspection = player.inspect()
        for (const named of bound) {
          const layer = inspection.layers.find(candidate => candidate.name === named.name)!
          const host = inspection.layers.find(candidate => candidate.name === layer.sharesCutWith)!
          // The cut is the art's bottom edge, where the layer's own box ends.
          const source = pkg.playback.layers.find(candidate => candidate.name === host.name)!
          const bottom = source.y + source.h
          // The two meshes are joined before each takes its own transform.
          const own = local(layer); const hostLocal = local(host)
          // The host's cut edge, in x order.
          const edge = Array.from({ length: host.rest.length / 2 }, (_, i) => i)
            .filter(i => Math.abs(host.rest[i * 2 + 1]! - bottom) < 0.5)
            .map(i => ({ x: hostLocal[i * 2]!, y: hostLocal[i * 2 + 1]! }))
            .sort((a, b) => a.x - b.x)
          for (let i = 0; i < layer.rest.length; i += 2) {
            if (Math.abs(layer.rest[i + 1]! - bottom) >= 0.5) continue
            const x = own[i]!
            // Past either end of the host's edge, its end segment carries on.
            let j = 1
            while (j < edge.length - 1 && edge[j]!.x < x) j++
            const a = edge[j - 1]!; const b = edge[j]!
            const expected = b.x === a.x ? a.y : a.y + (x - a.x) / (b.x - a.x) * (b.y - a.y)
            maxError = Math.max(maxError, Math.abs(own[i + 1]! - expected))
          }
          for (let i = 0; i < layer.indices.length; i += 3) {
            if (signedArea(own, layer.indices[i]!, layer.indices[i + 1]!, layer.indices[i + 2]!)
              * signedArea(layer.rest, layer.indices[i]!, layer.indices[i + 1]!, layer.indices[i + 2]!) < 0) { folds++
}
          }
        }
      }
      return { names: bound.map(layer => layer.name), maxError, folds, error: gl.getError() }
    }
    finally { close() }
  })
}

export const probes = { features, bodyStageProjection, posture, torsoTurn, turns, corners, correction, collar, shoulder, earrings, hair, musicExit, thoughtToSpeech, sharedCut }
Object.assign(window, { figureProbes: probes })
