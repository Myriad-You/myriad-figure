import type { Anime25DPlayback, Anime25DPlaybackLayer, Anime25DStrand } from './types'

const VERTEX_SHADER = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
uniform vec2 u_view;
out vec2 v_uv;
void main() {
  vec2 clip = vec2(a_pos.x / u_view.x * 2.0 - 1.0, 1.0 - a_pos.y / u_view.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  v_uv = a_uv;
}`

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_texture;
uniform float u_opacity;
out vec4 out_color;
void main() {
  vec4 color = texture(u_texture, v_uv);
  if (color.a < 0.004) discard;
  float alpha = color.a * u_opacity;
  out_color = vec4(color.rgb * alpha, alpha);
}`

export interface Anime25DDriver {
  angleX: number
  angleY: number
  eyeL: number
  eyeR: number
  mouth: number
  armY: number
  armPos: number
  bust: number
  lean: number
  talking: boolean
}

interface HairSpring {
  x: number
  y: number
  vx: number
  vy: number
}

interface StrandState {
  layer: number
  strand: Anime25DStrand
  stiff: HairSpring
  soft: HairSpring
  front: boolean
}

interface GpuLayer {
  source: Anime25DPlaybackLayer
  rest: Float32Array
  deformed: Float32Array
  uvs: Float32Array
  indices: Uint16Array
  cols: number
  rows: number
  vao: WebGLVertexArrayObject
  vertexBuffer: WebGLBuffer
  indexBuffer: WebGLBuffer
  indexCount: number
}

export const IDENTITY_DRIVER: Anime25DDriver = {
  angleX: 0,
  angleY: 0,
  eyeL: 1,
  eyeR: 1,
  mouth: 0,
  armY: 0,
  armPos: 0,
  bust: 0,
  lean: 0,
  talking: false,
}

export interface Anime25DDebugSnapshot {
  layerCount: number
  hairLayerCount: number
  strandCount: number
  eyeOpenLayers: number
  eyeCloseLayers: number
  mouthOpenLayers: number
  mouthCloseLayers: number
  canvas: { width: number; height: number }
  current: Anime25DDriver
}

export class Anime25DPlayer {
  private readonly gl: WebGL2RenderingContext
  private readonly playback: Anime25DPlayback
  private readonly program: WebGLProgram
  private readonly viewLocation: WebGLUniformLocation
  private readonly opacityLocation: WebGLUniformLocation
  private texture: WebGLTexture | null = null
  private layers: GpuLayer[] = []
  private strands: StrandState[] = []
  private readonly current: Anime25DDriver = { ...IDENTITY_DRIVER }
  private readonly target: Anime25DDriver = { ...IDENTITY_DRIVER }
  private time = 0
  private blinkAt = 1.8
  private blinkElapsed = 1
  private chest = 0
  private chestVelocity = 0
  private wind = 0
  private disposed = false
  private viewWidth = 1
  private viewHeight = 1

  constructor(canvas: HTMLCanvasElement, playback: Anime25DPlayback) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      stencil: true,
      antialias: false,
    })
    if (!gl) throw new Error('WebGL2 is required for Anime2.5DRig playback')
    this.gl = gl
    this.playback = playback
    this.program = compileProgram(gl)
    this.viewLocation = requiredUniform(gl, this.program, 'u_view')
    this.opacityLocation = requiredUniform(gl, this.program, 'u_opacity')
    gl.useProgram(this.program)
    gl.uniform1i(requiredUniform(gl, this.program, 'u_texture'), 0)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.enable(gl.STENCIL_TEST)
  }

  async loadAtlas(url: string): Promise<void> {
    const image = await loadImage(url)
    const { gl } = this
    const texture = gl.createTexture()
    if (!texture) throw new Error('Anime2.5DRig atlas texture failed')
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
    this.texture = texture
    this.layers = this.playback.layers.map((layer) => this.createLayer(layer))
    this.strands = this.layers.flatMap((layer, index) =>
      layer.source.strands.map((strand) => ({
        layer: index,
        strand,
        stiff: { x: 0, y: 0, vx: 0, vy: 0 },
        soft: { x: 0, y: 0, vx: 0, vy: 0 },
        front: layer.source.role.includes('front'),
      })),
    )
  }

  setTarget(partial: Partial<Anime25DDriver>): void {
    Object.assign(this.target, partial)
  }

  replaceTarget(driver: Anime25DDriver): void {
    Object.assign(this.target, driver)
  }

  getTarget(): Anime25DDriver {
    return { ...this.target }
  }

  getCurrent(): Anime25DDriver {
    return { ...this.current }
  }

  blinkNow(): void {
    this.blinkElapsed = 0
    this.blinkAt = 2.4 + Math.random() * 3.2
  }

  debugSnapshot(): Anime25DDebugSnapshot {
    const layers = this.playback.layers
    return {
      layerCount: layers.length,
      hairLayerCount: layers.filter((layer) => layer.phys === 'hair').length,
      strandCount: layers.reduce((sum, layer) => sum + layer.strands.length, 0),
      eyeOpenLayers: layers.filter((layer) => layer.fade === 'eyeOpen').length,
      eyeCloseLayers: layers.filter((layer) => layer.fade === 'eyeClose').length,
      mouthOpenLayers: layers.filter((layer) => layer.fade === 'mouthOpen').length,
      mouthCloseLayers: layers.filter((layer) => layer.fade === 'mouthClose')
        .length,
      canvas: { ...this.playback.pixelCanvas },
      current: this.getCurrent(),
    }
  }

  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void {
    const dpr = Math.max(1, Math.min(2, devicePixelRatio))
    const width = Math.max(1, Math.round(cssWidth * dpr))
    const height = Math.max(1, Math.round(cssHeight * dpr))
    const canvas = this.gl.canvas
    if (canvas instanceof HTMLCanvasElement) {
      canvas.width = width
      canvas.height = height
    }
    this.viewWidth = width
    this.viewHeight = height
    this.gl.viewport(0, 0, width, height)
  }

  tick(deltaSeconds: number): void {
    if (this.disposed || !this.texture) return
    const dt = Math.min(0.05, Math.max(0.001, deltaSeconds))
    this.time += dt
    this.smoothDriver(dt)
    this.updateBlink(dt)
    this.updateSprings(dt)
    this.deform()
    this.draw()
  }

  captureFrame(): string | null {
    const canvas = this.gl.canvas
    return canvas instanceof HTMLCanvasElement ? canvas.toDataURL('image/png') : null
  }

  dispose(): void {
    this.disposed = true
    const { gl } = this
    for (const layer of this.layers) {
      gl.deleteBuffer(layer.vertexBuffer)
      gl.deleteBuffer(layer.indexBuffer)
      gl.deleteVertexArray(layer.vao)
    }
    if (this.texture) gl.deleteTexture(this.texture)
    gl.deleteProgram(this.program)
    this.layers = []
  }

  private smoothDriver(dt: number): void {
    const rate = 1 - Math.exp(-dt * 14)
    const keys = [
      'angleX',
      'angleY',
      'eyeL',
      'eyeR',
      'mouth',
      'armY',
      'armPos',
      'bust',
      'lean',
    ] as const
    for (const key of keys) {
      this.current[key] = lerp(this.current[key], this.target[key], rate)
    }
    this.current.talking = this.target.talking
    if (this.current.talking) {
      this.current.mouth = clamp(
        this.current.mouth * 0.55 + (0.35 + 0.4 * Math.abs(Math.sin(this.time * 11))),
        0,
        1,
      )
    }
  }

  private updateBlink(dt: number): void {
    this.blinkElapsed += dt
    if (this.blinkElapsed >= this.blinkAt) {
      this.blinkElapsed = 0
      this.blinkAt = 2.4 + Math.random() * 3.2
    }
    const closure = blinkClosure(this.blinkElapsed)
    if (this.target.eyeL >= 0.95) this.current.eyeL = 1 - closure
    if (this.target.eyeR >= 0.95) this.current.eyeR = 1 - closure
  }

  private updateSprings(dt: number): void {
    const breath = 0.5 + 0.5 * Math.sin((this.time * Math.PI * 2) / 3.4)
    const targetChest = (breath - 0.5) * this.playback.anchors.faceScale * 1.4 + this.current.bust * 6
    this.chestVelocity += (targetChest - this.chest) * 140 * dt - this.chestVelocity * 4.2 * dt
    this.chest += this.chestVelocity * dt
    this.wind = Math.sin(this.time * 1.3) * 0.45 + Math.sin(this.time * 0.37) * 0.25
    const headX = this.current.angleX * 18
    for (const strand of this.strands) {
      integrateSpring(strand.stiff, headX * 0.55 + this.wind * 4, 0, 70, 9, 2.2, dt)
      integrateSpring(strand.soft, strand.stiff.x * 1.15, strand.stiff.y, 16, 1.3, 3, dt)
    }
  }

  private deform(): void {
    const { anchors } = this.playback
    const fs = anchors.faceScale
    const fit = this.fit()
    const breath = 0.5 + 0.5 * Math.sin((this.time * Math.PI * 2) / 3.4)
    const bodyLift = (breath - 0.5) * 2 * fs * 2
    const headLift = (breath - 0.5) * 2 * fs * 1.6
    for (const [layerIndex, layer] of this.layers.entries()) {
      const rest = layer.rest
      const deformed = layer.deformed
      for (let index = 0; index < rest.length; index += 2) {
        let x = rest[index]
        let y = rest[index + 1]
        const depth = layer.source.depth
        const dd = depth - 1
        if (layer.source.group === 'head') {
          const aroundX = x - anchors.neckPivot.x
          const aroundY = y - anchors.neckPivot.y
          const lean = this.current.lean * 0.028
          const rot = this.current.angleX * 0.18 + lean
          const cos = Math.cos(rot)
          const sin = Math.sin(rot)
          x = anchors.neckPivot.x + aroundX * cos - aroundY * sin
          y = anchors.neckPivot.y + aroundX * sin + aroundY * cos
          x += this.current.angleX * (14 + 40 * dd) * (fs / 1.2)
          y -= this.current.angleY * (9 + 30 * dd) * (fs / 1.2)
          y += headLift
        } else {
          x += this.current.angleX * (14 + 40 * dd) * 0.16 * (fs / 1.2)
          y -= this.current.angleY * (9 + 30 * dd) * 0.16 * (fs / 1.2)
          y += bodyLift
          if (layer.source.role === 'topwear' || layer.source.role === 'neck') {
            const cx = anchors.neckPivot.x
            const cy = anchors.neckPivot.y + (layer.source.h * 0.35)
            const falloff = Math.exp(-(((x - cx) / Math.max(8, layer.source.w * 0.35)) ** 2))
            y += this.chest * falloff
            x += this.chest * 0.08 * falloff * this.current.angleX
          }
          if (layer.source.role === 'handwear') {
            const side = layer.source.side === 'L' ? -1 : 1
            y += this.current.armY * 30 * fs
            x += this.current.armPos * 40 * fs * side
          }
        }
        if (layer.source.phys === 'hair') {
          const nearest = nearestStrand(this.strands, layerIndex, rest[index])
          if (nearest) {
            const span = Math.max(8, nearest.strand.tipY - nearest.strand.rootY)
            const u = clamp((rest[index + 1] - nearest.strand.rootY) / span, 0, 1)
            const mix = u ** 1.2
            const travel = nearest.front ? u ** 1.8 : u ** 2.1
            x += (nearest.stiff.x * (1 - mix) + nearest.soft.x * mix) * travel
            y += (nearest.stiff.y * (1 - mix) + nearest.soft.y * mix) * travel * 0.35
          }
        }
        deformed[index] = x * fit.scale + fit.offsetX
        deformed[index + 1] = y * fit.scale + fit.offsetY
      }
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, layer.vertexBuffer)
      this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, packVertices(deformed, layer.uvs))
    }
  }

  private draw(): void {
    const { gl } = this
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT)
    gl.useProgram(this.program)
    gl.uniform2f(this.viewLocation, this.viewWidth, this.viewHeight)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    for (const layer of this.layers) {
      const opacity = fadeOpacity(layer.source, this.current)
      if (opacity < 0.004 && !layer.source.name.startsWith('eyewhite')) continue
      const eyewhite = layer.source.name.startsWith('eyewhite')
      const iris = layer.source.name.startsWith('irides')
      if (eyewhite) {
        gl.stencilFunc(gl.ALWAYS, 1, 0xff)
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE)
      } else if (iris) {
        gl.stencilFunc(gl.EQUAL, 1, 0xff)
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP)
      } else {
        gl.stencilFunc(gl.ALWAYS, 0, 0xff)
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP)
      }
      gl.uniform1f(this.opacityLocation, opacity)
      gl.bindVertexArray(layer.vao)
      gl.drawElements(gl.TRIANGLES, layer.indexCount, gl.UNSIGNED_SHORT, 0)
    }
    gl.bindVertexArray(null)
  }

  private fit(): { scale: number; offsetX: number; offsetY: number } {
    const { width, height } = this.playback.pixelCanvas
    const scale = Math.min(this.viewWidth / width, this.viewHeight / height)
    return {
      scale,
      offsetX: (this.viewWidth - width * scale) / 2,
      offsetY: this.viewHeight - height * scale,
    }
  }

  private createLayer(source: Anime25DPlaybackLayer): GpuLayer {
    const cell = (source.phys ? 30 : 42) * Math.max(0.6, this.playback.pixelCanvas.width / 768)
    const cols = Math.max(1, Math.ceil(source.w / cell))
    const rows = Math.max(1, Math.ceil(source.h / cell))
    const rest = new Float32Array((cols + 1) * (rows + 1) * 2)
    const uvs = new Float32Array(rest.length)
    let cursor = 0
    for (let row = 0; row <= rows; row += 1) {
      const v = row / rows
      for (let col = 0; col <= cols; col += 1) {
        const u = col / cols
        rest[cursor] = source.x + source.w * u
        rest[cursor + 1] = source.y + source.h * v
        uvs[cursor] = source.atlas.x + source.atlas.w * u
        uvs[cursor + 1] = source.atlas.y + source.atlas.h * v
        cursor += 2
      }
    }
    const indices = new Uint16Array(cols * rows * 6)
    let write = 0
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const topLeft = row * (cols + 1) + col
        const topRight = topLeft + 1
        const bottomLeft = topLeft + cols + 1
        const bottomRight = bottomLeft + 1
        indices.set([topLeft, topRight, bottomLeft, topRight, bottomRight, bottomLeft], write)
        write += 6
      }
    }
    const packed = packVertices(rest, uvs)
    const { gl } = this
    const vao = gl.createVertexArray()
    const vertexBuffer = gl.createBuffer()
    const indexBuffer = gl.createBuffer()
    if (!vao || !vertexBuffer || !indexBuffer) {
      throw new Error('Anime2.5DRig mesh buffers failed')
    }
    const position = gl.getAttribLocation(this.program, 'a_pos')
    const uv = gl.getAttribLocation(this.program, 'a_uv')
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, packed, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0)
    gl.enableVertexAttribArray(uv)
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)
    gl.bindVertexArray(null)
    return {
      source,
      rest,
      deformed: rest.slice(),
      uvs,
      indices,
      cols,
      rows,
      vao,
      vertexBuffer,
      indexBuffer,
      indexCount: indices.length,
    }
  }
}

export function blinkClosure(elapsedSeconds: number): number {
  if (elapsedSeconds < 0.08) return smootherstep(elapsedSeconds / 0.08)
  if (elapsedSeconds < 0.42) return 1
  if (elapsedSeconds < 0.58) return 1 - smootherstep((elapsedSeconds - 0.42) / 0.16)
  return 0
}

function fadeOpacity(layer: Anime25DPlaybackLayer, driver: Anime25DDriver): number {
  const open = layer.side === 'L' ? driver.eyeL : layer.side === 'R' ? driver.eyeR : 1
  if (layer.fade === 'eyeOpen') return hermite(open, 0.1, 0.15)
  if (layer.fade === 'eyeClose') return hermite(1 - open, 0.1, 0.15)
  if (layer.fade === 'mouthOpen') return hermite(driver.mouth, 0.05, 0.12)
  if (layer.fade === 'mouthClose') return hermite(1 - driver.mouth, 0.05, 0.12)
  return 1
}

function hermite(value: number, start: number, width: number): number {
  return smootherstep(clamp((value - start) / Math.max(0.0001, width), 0, 1))
}

function integrateSpring(
  spring: HairSpring,
  targetX: number,
  targetY: number,
  stiffness: number,
  damping: number,
  pull: number,
  dt: number,
): void {
  spring.vx += -(spring.x - targetX) * pull * dt * stiffness * 0.02 - spring.vx * damping * dt
  spring.vy += -(spring.y - targetY) * pull * dt * stiffness * 0.02 - spring.vy * damping * dt
  spring.x += spring.vx * dt
  spring.y += spring.vy * dt
}

function nearestStrand(
  strands: StrandState[],
  layerIndex: number,
  x: number,
): StrandState | null {
  let best: StrandState | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const strand of strands) {
    if (strand.layer !== layerIndex) continue
    const distance = Math.abs(strand.strand.x - x)
    if (distance < bestDistance) {
      best = strand
      bestDistance = distance
    }
  }
  return best
}

function packVertices(positions: Float32Array, uvs: Float32Array): Float32Array {
  const packed = new Float32Array(positions.length * 2)
  for (let index = 0; index < positions.length; index += 2) {
    const write = index * 2
    packed[write] = positions[index]
    packed[write + 1] = positions[index + 1]
    packed[write + 2] = uvs[index]
    packed[write + 3] = uvs[index + 1]
  }
  return packed
}

function compileProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  const program = gl.createProgram()
  if (!program) throw new Error('Anime2.5DRig program failed')
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || 'Anime2.5DRig link failed')
  }
  return program
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Anime2.5DRig shader failed')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || 'Anime2.5DRig shader compile failed'
    gl.deleteShader(shader)
    throw new Error(log)
  }
  return shader
}

function requiredUniform(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name)
  if (!location) throw new Error(`Missing uniform ${name}`)
  return location
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Anime2.5DRig atlas failed to load'))
    image.src = url
  })
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount
}

function smootherstep(value: number): number {
  const bounded = clamp(value, 0, 1)
  return bounded * bounded * bounded * (bounded * (bounded * 6 - 15) + 10)
}
