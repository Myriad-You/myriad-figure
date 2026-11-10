import type { V3 } from './arm3dMath'
import type { Arm3DPose } from './arm3dMotion'

/** `q` turned by `angle` about `c` in the picture's plane (as the drawn arms are turned), its depth kept. */
function turned(q: V3, c: V3, angle: number): V3 {
  const x = q[0] - c[0]
  const y = q[1] - c[1]
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [c[0] + x * cos - y * sin, c[1] + x * sin + y * cos, q[2]]
}

/** The pose with the hand turned about the wrist, then the forearm about the elbow, then the arm about the shoulder. */
export function swung(pose: Arm3DPose, arm: number, forearm: number, hand: number): Arm3DPose {
  let { e, w } = pose
  let pts = pose.hand.map((q) => turned(q, w, hand))
  w = turned(w, e, forearm)
  pts = pts.map((q) => turned(q, pose.e, forearm))
  e = turned(e, pose.s, arm)
  w = turned(w, pose.s, arm)
  pts = pts.map((q) => turned(q, pose.s, arm))
  return { s: pose.s, e, w, hand: pts }
}

/** The arm turned on about the shoulder by its elbow's share, and its forearm on about the elbow by the wrist's beyond that. */
export function draped(pose: Arm3DPose, atElbow: number, atWrist: number): Arm3DPose {
  const e = turned(pose.e, pose.s, atElbow)
  const hand = pose.hand.map((q) => turned(turned(q, pose.s, atElbow), e, atWrist - atElbow))
  return { s: pose.s, e, w: turned(turned(pose.w, pose.s, atElbow), e, atWrist - atElbow), hand }
}

/** The body the portrait's arm leaves bare, premultiplied as the atlas is. */
export function createBodyTexture(gl: WebGL2RenderingContext, pixels: Uint8ClampedArray, width: number, height: number) {
  const texture = gl.createTexture()
  const data = new Uint8Array(pixels.length)
  for (let i = 0; i < data.length; i += 4) {
    const a = pixels[i + 3]
    for (let c = 0; c < 3; c += 1) data[i + c] = Math.round(pixels[i + c] * a / 255)
    data[i + 3] = a
  }
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1)
  return { texture, uv: [0, 0, 1, 1] as const }
}

/** The arm's points (shoulder, elbow, wrist, hand) as x, y pairs on the canvas. */
export function armPoints(pose: Arm3DPose): number[] {
  return [pose.s, pose.e, pose.w, ...pose.hand].flatMap((q) => [q[0], q[1]])
}
