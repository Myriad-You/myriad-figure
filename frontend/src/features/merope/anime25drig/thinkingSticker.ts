/** A procedural sticker: no atlas migration or remote image is required. */
export class ThinkingSticker {
  private program: WebGLProgram | null = null
  private vao: WebGLVertexArrayObject | null = null
  private amount = 0
  private lastTime: number | null = null

  draw(gl: WebGL2RenderingContext, time: number, target: number,
    x: number, y: number, size: number, width: number, height: number): void {
    const dt = this.lastTime === null ? 0 : Math.max(0, Math.min(0.1, time - this.lastTime))
    this.lastTime = time
    this.amount += (target - this.amount) * -Math.expm1(-dt * (target > this.amount ? 10 : 6))
    if (this.amount < 0.002) return
    if (!this.program) {
      const program = gl.createProgram()!
      const sources = [
        `#version 300 es
        uniform vec4 box; uniform vec2 view; out vec2 uv;
        void main() {
          vec2 p = vec2((gl_VertexID == 1 || gl_VertexID == 2) ? 1.0 : -1.0,
                        gl_VertexID >= 2 ? 1.0 : -1.0);
          uv = p; vec2 pos = box.xy + p * box.z;
          gl_Position = vec4(pos.x/view.x*2.0-1.0, 1.0-pos.y/view.y*2.0, 0, 1);
        }`,
        `#version 300 es
        precision highp float; in vec2 uv; uniform vec4 box; uniform float phase; out vec4 color;
        void main() {
          float r = length(uv); float aa = max(fwidth(r), 0.01);
          float ring = (1.0-smoothstep(0.83-aa,0.83+aa,r))*smoothstep(0.48-aa,0.48+aa,r);
          float inner = (1.0-smoothstep(0.75-aa,0.75+aa,r))*smoothstep(0.56-aa,0.56+aa,r);
          float sweep = fract((atan(uv.y,uv.x)-phase)/6.2831853);
          float a = ring * box.w * (0.25+0.75*sweep);
          vec3 tint = mix(vec3(1.0),vec3(0.42,0.35,0.64),inner);
          color = vec4(tint*a,a);
        }`,
      ]
      const shaders = sources.map((source, i) => {
        const shader = gl.createShader(i ? gl.FRAGMENT_SHADER : gl.VERTEX_SHADER)!
        gl.shaderSource(shader, source); gl.compileShader(shader)
        gl.attachShader(program, shader)
        return shader
      })
      gl.linkProgram(program)
      const linked = gl.getProgramParameter(program, gl.LINK_STATUS)
      for (const shader of shaders) gl.deleteShader(shader)
      if (!linked) { gl.deleteProgram(program); return }
      this.program = program
      this.vao = gl.createVertexArray()
    }
    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)
    gl.disable(gl.STENCIL_TEST)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.uniform4f(gl.getUniformLocation(this.program, 'box'), x, y, size, this.amount)
    gl.uniform2f(gl.getUniformLocation(this.program, 'view'), width, height)
    gl.uniform1f(gl.getUniformLocation(this.program, 'phase'), time * Math.PI * 1.5)
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4)
    gl.bindVertexArray(null)
  }

  dispose(gl: WebGL2RenderingContext): void {
    if (this.program) gl.deleteProgram(this.program)
    if (this.vao) gl.deleteVertexArray(this.vao)
    this.program = null; this.vao = null
  }
}
