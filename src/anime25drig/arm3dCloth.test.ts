import assert from 'node:assert/strict'
import test from 'node:test'
import { arm3DClothMesh, arm3DClothOver, arm3DClothPin, Arm3DClothSim, cutArm3DCloth } from './arm3dCloth'

/** A coat (the right half) with a cape over the arm at its left, joined to it only along the top. */
function picture(width: number, height: number, cape: boolean): Uint8Array {
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const coat = x >= 120 && y >= 10
      const worn = cape && x >= 40 && x < 100 && y >= 10 && y < 150
      const joined = cape && x >= 100 && x < 120 && y >= 10 && y < 30
      if (coat || worn || joined) rgba[(y * width + x) * 4 + 3] = 255
    }
  }
  return rgba
}

const S = [80, 20]
const E = [80, 140]

test('a cape over the arm is cut from the coat, joined to it where it was drawn joined', () => {
  const cut = cutArm3DCloth(picture(200, 200, true), 200, 200, S, E, 30, -1)
  assert.ok(cut)
  assert.equal(cut.piece[100 * 200 + 60], 1)
  assert.equal(cut.piece[100 * 200 + 160], 0)
  let seam = 0
  for (let p = 0; p < cut.seam.length; p += 1) {
    if (!cut.seam[p]) continue
    seam += 1
    assert.ok(Math.floor(p / 200) < 34, 'the seam is at the top, where the cape meets the coat')
  }
  assert.ok(seam > 0)
})

test('a coat with nothing over the arm has no cloth', () => {
  assert.equal(cutArm3DCloth(picture(200, 200, false), 200, 200, S, E, 30, -1), null)
})

function cloth() {
  const cut = cutArm3DCloth(picture(200, 200, true), 200, 200, S, E, 30, -1)!
  const mesh = arm3DClothMesh(cut, 200, 12)!
  const count = mesh.pos.length / 2
  const rest = new Float32Array(count * 3)
  const pin = new Float32Array(count)
  for (let i = 0; i < count; i += 1) {
    rest[i * 3] = mesh.pos[i * 2]
    rest[i * 3 + 1] = mesh.pos[i * 2 + 1]
    rest[i * 3 + 2] = arm3DClothOver(mesh.pos[i * 2] - 80, 30)
    pin[i] = arm3DClothPin((mesh.pos[i * 2 + 1] - 20) / 120, mesh.fromSeam[i])
  }
  return { mesh, rest, pin, count, sim: new Arm3DClothSim(rest, pin, mesh.links, mesh.near, 60, mesh.idx) }
}

test('the mesh covers the piece and is fixed at the shoulder and the seam only', () => {
  const { mesh, pin, count } = cloth()
  assert.ok(count > 20)
  assert.equal(mesh.idx.length % 3, 0)
  for (const i of mesh.idx) assert.ok(i < count)
  let fixed = 0
  for (let i = 0; i < count; i += 1) {
    if (pin[i] >= 1) fixed += 1
    if (mesh.pos[i * 2 + 1] > 100 && mesh.pos[i * 2] < 100) assert.equal(pin[i], 0)
  }
  assert.ok(fixed > 0 && fixed < count / 2)
})

test('with the arm hanging the cloth stays as drawn', () => {
  const { rest, sim } = cloth()
  const limbs = [{ a: [80, 20, 0] as [number, number, number], b: [80, 140, 0] as [number, number, number], r: 30 }]
  for (let f = 0; f < 60; f += 1) sim.step(rest, limbs, 0, 1 / 30)
  assert.ok(sim.off(rest) < 1e-3)
})

test('a raised arm carries the cloth: off the limb, as long as drawn, and back once it hangs', () => {
  const { mesh, rest, pin, count, sim } = cloth()
  let limb = { a: [80, 20, 0] as [number, number, number], b: [80, 140, 0] as [number, number, number], r: 30 }
  for (let f = 0; f < 90; f += 1) {
    const a = Math.min(1, f / 30) * 1.4
    limb = { a: [80, 20, 0], b: [80 - 120 * Math.sin(a), 20 + 120 * Math.cos(a), 0], r: 30 }
    sim.step(rest, [limb], 1, 1 / 30)
  }
  assert.ok(sim.off(rest) > 20, 'it moved')
  for (let i = 0; i < count; i += 1) {
    assert.ok(Number.isFinite(sim.x[i * 3]) && Number.isFinite(sim.x[i * 3 + 2]))
    if (pin[i] >= 1) assert.ok(Math.hypot(sim.x[i * 3] - rest[i * 3], sim.x[i * 3 + 1] - rest[i * 3 + 1]) < 1e-3)
    // Nothing of it inside the limb (but what is held fixed).
    if (pin[i] > 0) continue
    const dx = limb.b[0] - limb.a[0]
    const dy = limb.b[1] - limb.a[1]
    const t = Math.max(0, Math.min(1, ((sim.x[i * 3] - 80) * dx + (sim.x[i * 3 + 1] - 20) * dy) / (120 * 120)))
    const d = Math.hypot(sim.x[i * 3] - 80 - dx * t, sim.x[i * 3 + 1] - 20 - dy * t, sim.x[i * 3 + 2])
    assert.ok(d > 30 * 0.9, `node ${i} is ${d} from the limb`)
  }
  let stretched = 0
  for (let k = 0; k < mesh.near; k += 1) {
    const a = mesh.links[k * 2]
    const b = mesh.links[k * 2 + 1]
    const was = Math.hypot(rest[a * 3] - rest[b * 3], rest[a * 3 + 1] - rest[b * 3 + 1], rest[a * 3 + 2] - rest[b * 3 + 2])
    const is = Math.hypot(sim.x[a * 3] - sim.x[b * 3], sim.x[a * 3 + 1] - sim.x[b * 3 + 1], sim.x[a * 3 + 2] - sim.x[b * 3 + 2])
    stretched = Math.max(stretched, is / was)
  }
  assert.ok(stretched < 1.6, `stretched ${stretched}`)
  const down = [{ a: [80, 20, 0] as [number, number, number], b: [80, 140, 0] as [number, number, number], r: 30 }]
  for (let f = 0; f < 60; f += 1) sim.step(rest, down, 0, 1 / 30)
  assert.ok(sim.off(rest) < 0.5)
})

/** A cloth 60 wide over an arm from (80, 20) to (80, 140), drawn down to `end`. */
function hung(end: number): Uint8Array {
  const rgba = new Uint8Array(200 * 400 * 4)
  for (let y = 10; y < end; y += 1) {
    for (let x = 40; x < 100; x += 1) rgba[(y * 200 + x) * 4 + 3] = 255
  }
  return rgba
}

test('a cape that ends of itself is cut whole, its lowest corner with it; a coat that goes on down is cut across', () => {
  const cape = cutArm3DCloth(hung(290), 200, 400, S, E, 30, -1)
  assert.ok(cape)
  assert.equal(cape.piece[280 * 200 + 60], 1)
  const coat = cutArm3DCloth(hung(400), 200, 400, S, E, 30, -1)
  assert.ok(coat)
  assert.equal(coat.piece[190 * 200 + 60], 1)
  assert.equal(coat.piece[280 * 200 + 60], 0)
})
