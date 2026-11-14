import type { Anime25DSecondaryDeformationBinding, Anime25DSecondaryDeformationFrame } from './secondaryDeformation'
import assert from 'node:assert/strict'
import test from 'node:test'
import { bindFigureColumn, bindLimbColumn, drawnBehind, figureColumnOffsetX } from './figureColumns'
import { anime25DTorsoShellOffsetX } from './torsoDeformation'
import { turnWithTorso } from './torsoTurn'

// A figure's turn: its torso's cylinder about x = 500, turned as far as a figure turns, toward the picture's right.
const profile = { enabled: true, blend: 1, centerX: 500, radiusX: 200, radiusZ: 150, neckDepth: 0.25 }
const turned = { active: true, yawCosine: Math.cos(0.45), yawSine: Math.sin(0.45) }
const still = { active: false, yawCosine: 1, yawSine: 0 }

/** A lattice over a box, as a layer's mesh is. */
function lattice(box: { x: number; y: number; w: number; h: number }, cols: number, rows: number): Float32Array {
  const rest = new Float32Array((cols + 1) * (rows + 1) * 2)
  let i = 0
  for (let r = 0; r <= rows; r += 1) {
    for (let c = 0; c <= cols; c += 1) {
      rest[i++] = box.x + (box.w * c) / cols
      rest[i++] = box.y + (box.h * r) / rows
    }
  }
  return rest
}

/** A layer's pixels with a leg drawn in it: 60 wide, leaning from x = 20 at the top to x = 40 at the bottom of a 120-wide box. */
function leaningLeg(width = 120, height = 200) {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const from = 20 + Math.round((20 * y) / (height - 1))
    for (let x = from; x < from + 60; x += 1) pixels[(y * width + x) * 4 + 3] = 255
  }
  return { width, height, pixels }
}

const legBox = { x: 300, y: 600, w: 120, h: 200 }
const stance = { hipY: 600, groundY: 800 }

function placed(column: NonNullable<ReturnType<typeof bindFigureColumn>>, rest: Float32Array, vertex: number, rotation = turned): number {
  return rest[vertex * 2]! + figureColumnOffsetX(rest[vertex * 2]!, vertex, column, profile, rotation, 1)
}

test('a limb is read off its drawing, not its box: its axis runs down the middle of what is drawn', () => {
  const rest = lattice(legBox, 12, 10)
  const column = bindFigureColumn(rest, legBox, leaningLeg(), stance)!
  // Near the top the leg is drawn from 320 to 380; near the bottom, from 340 to 400.
  assert.ok(Math.abs(column.axis[13 * 1 + 6]! - 352) < 4, `${column.axis[13 + 6]}`)
  assert.ok(Math.abs(column.axis[13 * 9 + 6]! - 368) < 4, `${column.axis[13 * 9 + 6]}`)
  // It stands out most at its middle and not at all at its edges or in the empty box beside it.
  const row = 13 * 5
  const depths = Array.from({ length: 13 }, (_, c) => column.depth[row + c]!)
  assert.equal(depths[0], 0)
  assert.equal(depths[12], 0)
  assert.ok(Math.max(...depths) > 20 && Math.max(...depths) <= 31 * 0.9, `${depths}`)
  // A layer that cannot be read is taken for its box.
  const blind = bindFigureColumn(rest, legBox, null, stance)!
  assert.ok(Math.abs(blind.axis[row + 6]! - 360) < 1e-3)
})

test('turned, a leg keeps its width, what is drawn on it slides across it, and its foot stays where it stands', () => {
  const rest = lattice(legBox, 12, 10)
  const column = bindFigureColumn(rest, legBox, leaningLeg(), stance)!
  for (const r of [1, 5, 9]) {
    const row = 13 * r
    const xs = Array.from({ length: 13 }, (_, c) => placed(column, rest, row + c))
    // The drawing never folds over itself...
    for (let c = 1; c < 13; c += 1) assert.ok(xs[c]! > xs[c - 1]!, `row ${r} folds at ${c}`)
    // ...its outline (the vertices nearest the drawn edges) is as wide as it was, to a few percent: nearer, a little wider...
    const drawn = Array.from({ length: 13 }, (_, c) => c).filter((c) => column.depth[row + c]! > 0)
    const [first, last] = [drawn[0]! - 1, drawn.at(-1)! + 1]
    const width = xs[last]! - xs[first]!
    const was = rest[(row + last) * 2]! - rest[(row + first) * 2]!
    assert.ok(width > was * 0.99 && width < was * 1.12, `row ${r}: ${width} of ${was}`)
    // ...and its middle has gone the way the body turns, more than its edges.
    const middle = drawn[Math.floor(drawn.length / 2)]!
    assert.ok(xs[middle]! - rest[(row + middle) * 2]! > xs[first]! - rest[(row + first) * 2]! + 5)
  }
  // At the hips its axis has gone round the body's (in toward the middle); at the ground its outline has not
  // moved (what is drawn on the sole between its edges still slides a little, as on the leg).
  const top = placed(column, rest, 0) - rest[0]!
  assert.ok(top > 5, `${top}`)
  const sole = Array.from({ length: 13 }, (_, c) => placed(column, rest, 13 * 10 + c) - rest[(13 * 10 + c) * 2]!)
  const drawnAtSole = Array.from({ length: 13 }, (_, c) => c).filter((c) => column.depth[13 * 10 + c]! > 0)
  assert.ok(Math.abs(sole[drawnAtSole[0]! - 1]!) < 1 && Math.abs(sole[drawnAtSole.at(-1)! + 1]!) < 1, `${sole}`)
  assert.ok(Math.max(...sole.map(Math.abs)) < 30 * 0.9 * Math.sin(0.45) + 1)
  // Not turned, nothing moves.
  for (let v = 0; v < rest.length / 2; v += 1) assert.equal(placed(column, rest, v, still), rest[v * 2])
})

test('the two legs of a turned figure are as wide as each other: neither is squeezed for being on the far side', () => {
  const widths = [legBox, { ...legBox, x: 580 }].map((box) => {
    const rest = lattice(box, 12, 10)
    const column = bindFigureColumn(rest, box, leaningLeg(), stance)!
    const row = 13 * 4
    const drawn = Array.from({ length: 13 }, (_, c) => c).filter((c) => column.depth[row + c]! > 0)
    return placed(column, rest, row + drawn.at(-1)! + 1) - placed(column, rest, row + drawn[0]! - 1)
  })
  assert.ok(Math.abs(widths[0]! - widths[1]!) < widths[0]! * 0.1, `${widths}`)
})

test('an arm goes round with its shoulder all the way down; a shoe swings its toe the way the figure faces', () => {
  const armBox = { x: 200, y: 300, w: 120, h: 200 }
  const rest = lattice(armBox, 12, 10)
  const arm = bindFigureColumn(rest, armBox, leaningLeg())!
  // The whole arm, its hand too, has come in toward the body's middle.
  assert.ok(placed(arm, rest, 13 * 10) - rest[13 * 10 * 2]! > 5)
  assert.ok(arm.round.every((share) => share === 1))
  const shoeBox = { x: 300, y: 740, w: 120, h: 60 }
  const shoeRest = lattice(shoeBox, 12, 6)
  const art = { width: 120, height: 60, pixels: new Uint8ClampedArray(120 * 60 * 4).fill(255) }
  const shoe = bindFigureColumn(shoeRest, shoeBox, art, stance, false, true)!
  const middle = 6
  const ankle = placed(shoe, shoeRest, middle) - shoeRest[middle * 2]!
  const toe = placed(shoe, shoeRest, 13 * 6 + middle) - shoeRest[(13 * 6 + middle) * 2]!
  assert.ok(toe > ankle + 15, `toe ${toe}, ankle ${ankle}`)
  // Turned the other way, the other way.
  const left = { active: true, yawCosine: Math.cos(0.45), yawSine: -Math.sin(0.45) }
  assert.ok(placed(shoe, shoeRest, 13 * 6 + middle, left) - shoeRest[(13 * 6 + middle) * 2]! < -15)
})

test('a strap or a folded-back forearm beside a limb is not part of its column: the widest run of each row is', () => {
  // The leg as before, and a strap 12 wide hanging 30 clear of it on its right.
  const art = leaningLeg()
  for (let y = 0; y < art.height; y += 1) {
    for (let x = 108; x < 120; x += 1) art.pixels[(y * art.width + x) * 4 + 3] = 255
  }
  const rest = lattice(legBox, 12, 10)
  const alone = bindFigureColumn(rest, legBox, leaningLeg(), stance)!
  const beside = bindFigureColumn(rest, legBox, art, stance)!
  assert.deepEqual(Array.from(beside.axis), Array.from(alone.axis))
  assert.deepEqual(Array.from(beside.depth), Array.from(alone.depth))
  // The strap itself, outside the column, only goes along with the leg's axis: no depth of its own.
  assert.equal(beside.depth[13 * 5 + 12], 0)
})

test('an upper arm with its forearm folded back beside it, as wide: the column stays on the one it began on', () => {
  // Two strips 36 wide with a gap between, their widths jittering a pixel from row to row; the left begins a row higher.
  const width = 160
  const height = 200
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const jitter = y % 2
    for (let x = 20; x < 56 + jitter; x += 1) pixels[(y * width + x) * 4 + 3] = 255
    if (y > 0) { for (let x = 100; x < 137 - jitter; x += 1) pixels[(y * width + x) * 4 + 3] = 255
}
  }
  const box = { x: 300, y: 300, w: width, h: height }
  const rest = lattice(box, 16, 10)
  const column = bindFigureColumn(rest, box, { width, height, pixels })!
  for (let r = 0; r <= 10; r += 1) {
    assert.ok(Math.abs(column.axis[17 * r]! - 338) < 3, `row ${r}: ${column.axis[17 * r]}`)
    // Nothing of the column stands out in the gap or on the other strip.
    assert.equal(column.depth[17 * r + 7], 0)
    assert.equal(column.depth[17 * r + 12], 0)
  }
})

test('a leg\'s top goes with the trunk\'s cylinder, like the skirt or the trousers\' seat over it, and is its own column below', () => {
  const rest = lattice(legBox, 12, 10)
  const column = bindFigureColumn(rest, legBox, leaningLeg(), stance)!
  assert.equal(column.trunk![0], 1)
  assert.equal(column.trunk![13 * 10], 0)
  assert.equal(column.trunk![13 * 4], 0, 'above the knee it is all its own')
  assert.ok(column.trunk![13 * 2]! > 0 && column.trunk![13 * 2]! < 1)
  // A shoe and an arm have no such top.
  assert.equal(bindFigureColumn(rest, legBox, leaningLeg(), stance, false, true)!.trunk, null)
  assert.equal(bindFigureColumn(rest, legBox, leaningLeg())!.trunk, null)
  const frame = { figure: {}, torsoProfile: profile, torsoShellRotation: turned, torsoShellBlend: 1, neckBottom: 100, chestRegionCenterY: 300 } as unknown as Anime25DSecondaryDeformationFrame
  const binding = { figureColumn: column, torsoShellMode: null, bodyTurnKeyform: null } as unknown as Anime25DSecondaryDeformationBinding
  const moved = (vertex: number, layer = binding, on = frame) => {
    const point = { x: rest[vertex * 2]!, y: rest[vertex * 2 + 1]! }
    turnWithTorso(point, point.x, point.y, vertex, layer, on, 1)
    return point.x - rest[vertex * 2]!
  }
  // At its top, exactly what the trunk's cylinder gives a skirt's point drawn there...
  assert.ok(Math.abs(moved(4) - anime25DTorsoShellOffsetX(rest[8]!, profile, turned, 1)) < 1e-9)
  // ...lower down, exactly its column; and between them no step.
  assert.ok(Math.abs(moved(13 * 6 + 4) - figureColumnOffsetX(rest[(13 * 6 + 4) * 2]!, 13 * 6 + 4, column, profile, turned, 1)) < 1e-9)
  // A leg 700 long: a pixel down it, its side goes well under half a pixel across (handed over in a tenth of
  // the leg it went a whole pixel: its outline sheared at 45 degrees below the hips).
  const longBox = { ...legBox, h: 700 }
  const fine = lattice(longBox, 12, 350)
  const fineColumn = bindFigureColumn(fine, longBox, leaningLeg(120, 700), { hipY: 600, groundY: 1300 })!
  for (const c of [2, 4, 7]) {
    let last: number | null = null
    for (let r = 0; r <= 350; r += 1) {
      const v = 13 * r + c
      const point = { x: fine[v * 2]!, y: fine[v * 2 + 1]! }
      turnWithTorso(point, point.x, point.y, v, { ...binding, figureColumn: fineColumn }, frame, 1)
      const now = point.x - fine[v * 2]!
      if (last !== null) assert.ok(Math.abs(now - last) / 2 < 0.4, `column ${c}, row ${r}: ${(now - last) / 2}`)
      last = now
    }
  }
  // A bust has no bones and no columns: a layer bound with one all the same is left to what it did before (here, nothing).
  assert.equal(moved(13 * 6 + 4, binding, { ...frame, figure: null } as never), 0)
  assert.equal(moved(13 * 6 + 4, { ...binding, figureColumn: null }), 0)
})

test('under a skirt a leg is all its own column by the hem; a trouser leg, whose side shows from the hips, hands over slowly', () => {
  const rest = lattice(legBox, 12, 20)
  const leg = { name: 'legwear-L', role: 'legwear', z: 1, ...legBox }
  // A skirt 80 long from the hips, drawn right across; and a trousers' seat, a point between the legs.
  const garment = { name: 'bottomwear', role: 'bottomwear', z: 2, x: 260, y: 560, w: 400, h: 80 }
  const full = { width: 400, height: 80, pixels: new Uint8ClampedArray(400 * 80 * 4).fill(255) }
  const seat = { width: 400, height: 80, pixels: new Uint8ClampedArray(400 * 80 * 4) }
  for (let y = 0; y < 80; y += 1) {
    for (let x = 0; x < 400; x += 1) { if (Math.abs(x - 200) < 200 - y * 2.4) seat.pixels[(y * 400 + x) * 4 + 3] = 255
}
  }
  const bound = (art: typeof full | null, layers = [leg, garment]) =>
    bindLimbColumn(rest, leg, layers, (layer) => (layer ? art : leaningLeg()), stance)!
  const skirted = bound(full)
  const trousered = bound(seat)
  const bare = bound(null, [leg])
  // The skirt's hem is 40 below the hips, a fifth of this leg: from there down the leg is its own.
  const row = (share: number) => 13 * Math.round(share * 20)
  assert.equal(skirted.trunk![row(0.2)], 0)
  assert.ok(trousered.trunk![row(0.2)]! > 0.4, `${trousered.trunk![row(0.2)]}`)
  assert.deepEqual(Array.from(bare.trunk!), Array.from(trousered.trunk!))
  for (const column of [skirted, trousered]) {
    assert.equal(column.trunk![0], 1)
    assert.equal(column.trunk![row(0.4)], 0, 'above the knee both are')
  }
  // A lining piece put behind the legs is no skirt.
  const lining = bound(full, [leg, { ...garment, name: 'bottomwear-lining' }])
  assert.deepEqual(Array.from(lining.trunk!), Array.from(bare.trunk!))
})

test('which layers are limbs, and which arm is drawn behind the body\'s clothing (its lining does not say)', () => {
  const layers = [
    { name: 'topwear-lining', role: 'topwear', z: 0 },
    { name: 'legwear-L', role: 'legwear', z: 1 },
    { name: 'handwear-L', role: 'handwear', z: 2 },
    { name: 'topwear', role: 'topwear', z: 3 },
    { name: 'handwear-R', role: 'handwear', z: 4 },
  ]
  assert.equal(drawnBehind(layers, layers[2]!, 'topwear'), true)
  assert.equal(drawnBehind(layers, layers[4]!, 'topwear'), false)
  assert.equal(drawnBehind(layers.filter((layer) => layer.role !== 'topwear'), layers[2]!, 'topwear'), false, 'nothing worn: not behind it')
  const rest = lattice(legBox, 12, 10)
  const box = (name: string, role: string, z: number) => ({ name, role, z, ...legBox })
  assert.equal(bindLimbColumn(rest, box('handwear-L', 'handwear', 2), layers, () => null, stance)!.whole, true)
  assert.equal(bindLimbColumn(rest, box('handwear-R', 'handwear', 4), layers, () => null, stance)!.whole, false)
  // An arm goes round all the way down; a leg stands on its foot; a shoe has its toe.
  assert.ok(bindLimbColumn(rest, box('handwear-L', 'handwear', 2), layers, () => null, stance)!.round.every((share) => share === 1))
  assert.equal(bindLimbColumn(rest, box('legwear-L', 'legwear', 1), layers, () => null, stance)!.round[13 * 10], 0)
  assert.ok(bindLimbColumn(rest, box('footwear-L', 'footwear', 1), layers, () => null, stance)!.reach)
  assert.equal(bindLimbColumn(rest, box('topwear', 'topwear', 3), layers, () => null, stance), null)
  // What rides a limb takes its column at its anchor and a pixel across.
  const anchor = bindLimbColumn(Float32Array.of(360, 700, 361, 700), box('legwear-L', 'legwear', 1), layers, () => leaningLeg(), stance)!
  assert.equal(anchor.axis.length, 2)
  assert.ok(Math.abs(anchor.axis[0]! - 360) < 4)
})

test('a boot\'s shaft stands with the leg; only its foot swings its toe', () => {
  const bootBox = { x: 300, y: 400, w: 120, h: 400 }
  const rest = lattice(bootBox, 12, 20)
  const art = { width: 120, height: 400, pixels: new Uint8ClampedArray(120 * 400 * 4).fill(255) }
  const boot = bindFigureColumn(rest, bootBox, art, stance, false, true)!
  assert.equal(boot.reach![13 * 5 + 6], 0, 'a quarter of the way down the shaft: none')
  assert.ok(boot.reach![13 * 20 + 6]! > 40)
})
