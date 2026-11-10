import type { V3 } from './arm3dMath'
import type { Anime25DGpuLayer } from './layerGpuBinding'
import type { Anime25DOwnTexture, Anime25DRenderableLayer } from './renderer'
import type { IndexedDeformableMesh } from './webglRuntime'
import { arm3DClothMesh, arm3DClothOver, arm3DClothPin, Arm3DClothSim, cutArm3DCloth } from './arm3dCloth'
import { smoothstep } from './arm3dMath'
import { ANIME25D_ATLAS_MIP_GUTTER_PX, anime25DAtlasMaxLod, anime25DAtlasMaxMipLevel, createIndexedDeformableMesh, disposeIndexedDeformableMesh } from './webglRuntime'

/** What a cloth needs of the figure to be cut out of a layer and drawn as one more: its atlas as uploaded, and the layers' program. */
export interface Arm3DClothGpu {
  gl: WebGL2RenderingContext
  texture: WebGLTexture
  program: WebGLProgram
  atlasWidth: number
  atlasHeight: number
}

/** The hanging arm the cloth lies on (the canvas), its two halves' thickness, and its side of the picture (1 right, -1 left). */
export interface Arm3DClothArm {
  s: V3
  e: V3
  w: V3
  upper: number
  fore: number
  side: number
}

/** The limbs stand this much off the cloth (shares of their thickness): on them, it showed the sleeve's edge through its own. */
const OFF = 1.08
/** Back where it was drawn, it is the layer's again after this long still (seconds), brought there over the last of it. */
const STILL = 0.6

/**
 * A cloth cut out of a layer (`host`) and drawn as a piece of its own while the arm under it is away from where
 * it hangs: the layer wears its picture without the cloth meanwhile. With the arm hanging and the cloth come to
 * rest it is the layer's own picture again, to the pixel.
 */
export class Arm3DClothLayer {
  awake = false
  private calm = 0
  private to: Float32Array
  private xy: Float32Array
  private under: Uint16Array
  private front: Uint16Array
  private fore: { a: V3; b: V3 } | null = null

  private constructor(
    private gl: WebGL2RenderingContext,
    readonly host: Anime25DGpuLayer,
    /** What the figure draws over the layer: over the cloth too. */
    readonly over: readonly Anime25DGpuLayer[],
    /** Two of the same nodes: what of it lies under the forearm this frame, and what lies over it. */
    private mesh: IndexedDeformableMesh,
    private above: IndexedDeformableMesh,
    private count: number,
    private idx: Uint16Array,
    private sim: Arm3DClothSim,
    private rest: Float32Array,
    /** Each node on the layer's own mesh: three of its vertices and their shares. */
    private on: { at: Uint32Array; share: Float32Array },
    private piece: Anime25DOwnTexture,
    private without: Anime25DOwnTexture,
    private arm: Arm3DClothArm,
  ) {
    this.to = Float32Array.from(rest)
    this.xy = new Float32Array(rest.length / 3 * 2)
    this.under = new Uint16Array(idx.length)
    this.front = new Uint16Array(idx.length)
  }

  /** The cloth `host` draws over the arm, if it draws one; null where it draws none (or none that can be cut here). */
  static bind(gpu: Arm3DClothGpu, host: Anime25DGpuLayer, over: readonly Anime25DGpuLayer[], arm: Arm3DClothArm): Arm3DClothLayer | null {
    const { gl } = gpu
    const src = host.source
    const sx = Math.round(src.atlas.x * gpu.atlasWidth)
    const sy = Math.round(src.atlas.y * gpu.atlasHeight)
    const sw = Math.max(1, Math.round(src.atlas.w * gpu.atlasWidth))
    const sh = Math.max(1, Math.round(src.atlas.h * gpu.atlasHeight))
    const kx = sw / src.w
    const ky = sh / src.h
    const at = (q: V3) => [(q[0] - src.x) * kx, (q[1] - src.y) * ky]
    // (Before the layer's picture is read at all: most layers are nowhere near the arm.)
    const [ax, ay] = at(arm.s)
    const reach = Math.hypot(arm.e[0] - arm.s[0], arm.e[1] - arm.s[1]) * kx
    if (ax < -reach || ay < -reach || ax > sw + reach || ay > sh + reach) return null
    const pixels = readTexture(gl, gpu.texture, sx, sy, sw, sh)
    if (!pixels) return null
    const cut = cutArm3DCloth(pixels, sw, sh, at(arm.s), at(arm.e), arm.upper * kx, arm.side)
    if (!cut) return null
    const grid = arm3DClothMesh(cut, sw, Math.max(12, 0.3 * arm.upper) * kx)
    if (!grid) return null
    const count = grid.pos.length / 2
    const rest = new Float32Array(count * 3)
    const pin = new Float32Array(count)
    const uv = new Float32Array(count * 2)
    const ux = arm.e[0] - arm.s[0]
    const uy = arm.e[1] - arm.s[1]
    const long = ux * ux + uy * uy
    let fixed = 0
    for (let i = 0; i < count; i += 1) {
      const x = src.x + grid.pos[i * 2] / kx
      const y = src.y + grid.pos[i * 2 + 1] / ky
      rest[i * 3] = x
      rest[i * 3 + 1] = y
      rest[i * 3 + 2] = Math.max(arm3DClothOver(fromLimb(x, y, arm.s, arm.e), arm.upper * OFF), arm3DClothOver(fromLimb(x, y, arm.e, arm.w), arm.fore * OFF))
      uv[i * 2] = src.atlas.x + grid.pos[i * 2] / sw * src.atlas.w
      uv[i * 2 + 1] = src.atlas.y + grid.pos[i * 2 + 1] / sh * src.atlas.h
      pin[i] = arm3DClothPin(((x - arm.s[0]) * ux + (y - arm.s[1]) * uy) / long, grid.fromSeam[i])
      if (pin[i] >= 1) fixed += 1
    }
    // Hung from nothing, it is not this arm's cloth to move.
    if (fixed < 2) return null
    const on = onMesh(rest, count, host.rest, host.indices)
    if (!on) return null
    const sim = new Arm3DClothSim(rest, pin, grid.links, grid.near, Math.sqrt(long), grid.idx)
    // The piece's own picture (a little past its box: beyond it, nothing), and the layer's without it.
    const bx = Math.max(0, cut.x0 - 2)
    const by = Math.max(0, cut.y0 - 2)
    const bw = Math.min(sw, cut.x1 + 2) - bx
    const bh = Math.min(sh, cut.y1 + 2) - by
    const own = new Uint8Array(bw * bh * 4)
    const left = Uint8Array.from(pixels)
    for (let y = cut.y0; y < cut.y1; y += 1) {
      for (let x = cut.x0; x < cut.x1; x += 1) {
        const p = y * sw + x
        const kind = cut.piece[p]
        if (!kind) continue
        const q = ((y - by) * bw + (x - bx)) * 4
        for (let c = 0; c < 4; c += 1) own[q + c] = pixels[p * 4 + c]
        if (kind !== 2) left.fill(0, p * 4, p * 4 + 4)
      }
    }
    let mesh: IndexedDeformableMesh | null = null
    let above: IndexedDeformableMesh | null = null
    let piece: WebGLTexture | null = null
    let without: WebGLTexture | null = null
    try {
      mesh = createIndexedDeformableMesh(gl, gpu.program, new Float32Array(count * 2), uv, grid.idx)
      above = createIndexedDeformableMesh(gl, gpu.program, new Float32Array(count * 2), uv, grid.idx)
      piece = createTexture(gl, own, bw, bh)
      without = createTexture(gl, left, sw, sh)
      return new Arm3DClothLayer(gl, host, over, mesh, above, count, grid.idx, sim, rest, on, { texture: piece, uv: [-bx / bw, -by / bh, sw / bw, sh / bh] }, { texture: without, uv: [0, 0, 1, 1] }, arm)
    } catch (error) {
      if (mesh) disposeIndexedDeformableMesh(gl, mesh)
      if (above) disposeIndexedDeformableMesh(gl, above)
      if (piece) gl.deleteTexture(piece)
      if (without) gl.deleteTexture(without)
      throw error
    }
  }

  private clear = 0

  /**
   * This frame's cloth, `dt` on: the arm's joints as they now lie (`s`, `e`, `w`, before the body's own lean, as
   * the layers' vertices are), `active` how far it is from hanging (0 hanging, 1 away). One layer wears one
   * cloth's cut at a time: a second cloth of the same layer stays in it until the first is back.
   */
  step(s: V3, e: V3, w: V3, active: number, dt: number): void {
    if (!this.awake && active <= 0) return
    const { to, on, count, rest, sim, arm } = this
    const from = this.host.deformed
    for (let i = 0; i < count; i += 1) {
      let x = 0
      let y = 0
      for (let k = 0; k < 3; k += 1) {
        const v = on.at[i * 3 + k] * 2
        x += from[v] * on.share[i * 3 + k]
        y += from[v + 1] * on.share[i * 3 + k]
      }
      to[i * 3] = x
      to[i * 3 + 1] = y
      to[i * 3 + 2] = rest[i * 3 + 2]
    }
    if (!this.awake) {
      // The layer's picture without the cloth, and the cloth where the layer has it now.
      if (this.host.ownTexture) return
      sim.reset(to)
      this.host.ownTexture = this.without
      this.awake = true
      this.calm = 0
    }
    // (The body lies at the hanging shoulder's depth: the cloth's own are from there.)
    const z = arm.s[2]
    const lower = (q: V3): V3 => [q[0], q[1], q[2] - z]
    this.fore = { a: lower(e), b: lower(w) }
    // (Hanging, the forearm's top is drawn under it; away, only what is clear of the whole sleeve is over it.)
    this.clear = arm.fore * OFF * Math.min(1, Math.max(0, active))
    // (The upper arm alone carries it: the forearm comes out from under it, and what of it hangs past the elbow
    // hangs free.)
    sim.step(to, [{ a: lower(s), b: lower(e), r: arm.upper * OFF, worn: true }], active, dt)
    if (active > 1e-3) {
      this.calm = 0
      return
    }
    this.calm += dt
    const still = smoothstep(STILL / 3, STILL, this.calm)
    sim.settle(to, still)
    if (still >= 1) this.sleep()
  }

  private sleep(): void {
    if (this.host.ownTexture === this.without) this.host.ownTexture = null
    this.awake = false
  }

  /**
   * The cloth as layers to draw this frame, its vertices where they now are: what of it lies under the forearm
   * (nearer the body than the forearm's middle there), and what lies over it (null with none).
   */
  drawn(): { under: Anime25DRenderableLayer; front: Anime25DRenderableLayer | null } {
    const { gl, xy, sim, count, idx, fore } = this
    for (let i = 0; i < count; i += 1) {
      xy[i * 2] = sim.x[i * 3]
      xy[i * 2 + 1] = sim.x[i * 3 + 1]
    }
    let under = 0
    let front = 0
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3
      const b = idx[t + 1] * 3
      const c = idx[t + 2] * 3
      const z = (sim.x[a + 2] + sim.x[b + 2] + sim.x[c + 2]) / 3
      const over = !fore || z >= this.clear + limbDepth((sim.x[a] + sim.x[b] + sim.x[c]) / 3, (sim.x[a + 1] + sim.x[b + 1] + sim.x[c + 1]) / 3, fore.a, fore.b)
      if (over) {
        this.front.set([idx[t], idx[t + 1], idx[t + 2]], front)
        front += 3
      }
      else {
        this.under.set([idx[t], idx[t + 1], idx[t + 2]], under)
        under += 3
      }
    }
    const upload = (mesh: IndexedDeformableMesh, indices: Uint16Array, n: number) => {
      gl.bindVertexArray(mesh.vao)
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.positionBuffer)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, xy)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indexBuffer)
      gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, indices, 0, n)
    }
    upload(this.mesh, this.under, under)
    upload(this.above, this.front, front)
    gl.bindVertexArray(null)
    // As its layer is this frame (how much it shows, how it is carried), with its own picture and vertices.
    const as = (mesh: IndexedDeformableMesh, indexCount: number): Anime25DRenderableLayer => ({ ...this.host, vao: mesh.vao, indexCount, ownTexture: this.piece, followers: undefined, crownOccluders: undefined })
    return { under: as(this.mesh, under), front: front ? as(this.above, front) : null }
  }

  dispose(): void {
    this.sleep()
    disposeIndexedDeformableMesh(this.gl, this.mesh)
    disposeIndexedDeformableMesh(this.gl, this.above)
    this.gl.deleteTexture(this.piece.texture)
    this.gl.deleteTexture(this.without.texture)
  }
}

/** How deep the limb a–b's middle lies where it passes nearest (x, y) on the picture. */
function limbDepth(x: number, y: number, a: V3, b: V3): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l = dx * dx + dy * dy
  const t = l < 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l))
  return a[2] + (b[2] - a[2]) * t
}

/** How far (x, y) is from the limb a–b on the picture. */
function fromLimb(x: number, y: number, a: V3, b: V3): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l = dx * dx + dy * dy
  const t = l < 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l))
  return Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t)
}

/** Each node (`rest`, x y z triples) on a mesh as it rests (`at`, x y pairs): the triangle it lies in, or the one it lies nearest, and its shares of that one's corners. */
function onMesh(rest: Float32Array, count: number, at: Float32Array, indices: Uint16Array): { at: Uint32Array; share: Float32Array } | null {
  const tris = indices.length / 3
  const inv = new Float32Array(tris * 4)
  const ok = new Uint8Array(tris)
  for (let t = 0; t < tris; t += 1) {
    const a = indices[t * 3] * 2
    const b = indices[t * 3 + 1] * 2
    const c = indices[t * 3 + 2] * 2
    const m00 = at[b] - at[a]
    const m01 = at[c] - at[a]
    const m10 = at[b + 1] - at[a + 1]
    const m11 = at[c + 1] - at[a + 1]
    const det = m00 * m11 - m01 * m10
    if (Math.abs(det) < 1e-9) continue
    ok[t] = 1
    inv.set([m11 / det, -m01 / det, -m10 / det, m00 / det], t * 4)
  }
  const out = { at: new Uint32Array(count * 3), share: new Float32Array(count * 3) }
  for (let i = 0; i < count; i += 1) {
    const x = rest[i * 3]
    const y = rest[i * 3 + 1]
    let best = -1
    let bestIn = -Infinity
    let b1 = 0
    let b2 = 0
    for (let t = 0; t < tris; t += 1) {
      if (!ok[t]) continue
      const a = indices[t * 3] * 2
      const px = x - at[a]
      const py = y - at[a + 1]
      const u = inv[t * 4] * px + inv[t * 4 + 1] * py
      const v = inv[t * 4 + 2] * px + inv[t * 4 + 3] * py
      const inside = Math.min(u, v, 1 - u - v)
      if (inside <= bestIn) continue
      bestIn = inside
      best = t
      b1 = u
      b2 = v
      if (inside >= 0) break
    }
    if (best < 0) return null
    out.at.set([indices[best * 3], indices[best * 3 + 1], indices[best * 3 + 2]], i * 3)
    out.share.set([1 - b1 - b2, b1, b2], i * 3)
  }
  return out
}

/** A stretch of a texture's pixels as uploaded (premultiplied, rows from the top); null where it cannot be read. */
function readTexture(gl: WebGL2RenderingContext, texture: WebGLTexture, x: number, y: number, width: number, height: number): Uint8Array | null {
  const before = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null
  const buffer = gl.createFramebuffer()
  if (!buffer) return null
  const pixels = new Uint8Array(width * height * 4)
  gl.bindFramebuffer(gl.FRAMEBUFFER, buffer)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
  const ready = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
  if (ready) gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  gl.bindFramebuffer(gl.FRAMEBUFFER, before)
  gl.deleteFramebuffer(buffer)
  return ready ? pixels : null
}

/** A picture of its own, premultiplied as read, sampled as the atlas is. */
function createTexture(gl: WebGL2RenderingContext, pixels: Uint8Array, width: number, height: number): WebGLTexture {
  const texture = gl.createTexture()
  if (!texture) throw new Error('cloth texture')
  const maxLevel = anime25DAtlasMaxMipLevel(ANIME25D_ATLAS_MIP_GUTTER_PX)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, maxLevel > 0 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
  if (maxLevel > 0) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, maxLevel)
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAX_LOD, anime25DAtlasMaxLod(ANIME25D_ATLAS_MIP_GUTTER_PX))
  }
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  if (maxLevel > 0) gl.generateMipmap(gl.TEXTURE_2D)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1)
  return texture
}
