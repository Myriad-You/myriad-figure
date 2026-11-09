import type { P2 } from './armRaster'
import assert from 'node:assert/strict'
import test from 'node:test'
import { extendFinger, hiddenFingersOf, measureDrawnHand } from './armHand'

const W = 400
const H = 400
const SKIN = [240, 205, 190] as const

/** A fist about the points found (its top just over them) and, if `pointing`, a finger held up out of it to y = 140. */
function picture(pointing: boolean) {
  const img = new Uint8Array(W * H * 3).fill(255)
  const changed = new Uint8Array(W * H)
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const fist = ((x - 205) / 50) ** 2 + ((y - 262) / 47) ** 2 < 1
      const finger = pointing && Math.abs(x - 185) < 12 && y >= 140 && y < 220
      if (!fist && !finger) continue
      img.set(SKIN, (y * W + x) * 3)
      changed[y * W + x] = 1
    }
  }
  return { img, changed }
}

// Wrist below, the middle knuckle above it; every finger found curled into the fist.
const FOUND: P2[] = [
  [200, 330],
  [160, 300], [150, 270], [160, 245], [175, 240],
  [185, 230], [180, 250], [190, 265], [195, 270],
  [205, 230], [205, 250], [210, 265], [210, 275],
  [222, 233], [225, 252], [225, 268], [222, 278],
  [238, 240], [240, 256], [238, 270], [234, 280],
]

test('a finger found curled where the drawing holds it out is laid along the drawn one', () => {
  const { img, changed } = picture(true)
  const { hand, laid } = extendFinger(FOUND, changed, img, W, H)
  assert.equal(laid, 1)
  assert.deepEqual(hand[5], FOUND[5])
  assert.ok(Math.abs(hand[8][0] - 185) < 8 && Math.abs(hand[8][1] - 140) < 8, `tip at ${hand[8]}`)
  assert.ok(hand[6][1] < hand[5][1] && hand[7][1] < hand[6][1])
  // The other fingers are left as found.
  for (const i of [1, 2, 3, 4, 9, 10, 11, 12, 13, 17, 20]) assert.deepEqual(hand[i], FOUND[i])
})

test('a fist with nothing held out is left as found', () => {
  const { img, changed } = picture(false)
  const { hand, laid } = extendFinger(FOUND, changed, img, W, H)
  assert.equal(laid, null)
  assert.equal(hand, FOUND)
})

// As measured: a hand laid flat on the chest whose ring fingertip was found on the middle finger's, and a hand
// under the chin with its fingers curled.
const FLAT: P2[] = [[468, 310], [473, 251], [499, 198], [519, 164], [553, 129], [568, 166], [608, 144], [647, 136], [675, 101], [598, 192], [638, 161], [672, 138], [708, 121], [615, 228], [648, 191], [687, 178], [685, 122], [624, 266], [655, 242], [676, 218], [695, 183]]
const CURLED: P2[] = [[357, 319], [400, 255], [457, 189], [499, 161], [508, 98], [409, 83], [463, 33], [523, 34], [590, 52], [414, 92], [508, 81], [535, 116], [523, 182], [426, 116], [515, 133], [526, 167], [474, 226], [442, 144], [501, 171], [505, 186], [472, 232]]

test('of two fingers crossing each other alone, the one kinked where it was guessed is the hidden one', () => {
  assert.deepEqual(hiddenFingersOf(FLAT, []), [3])
})

test('tied with the thumb, the thumb is taken, not a finger curled as fingers curl', () => {
  assert.deepEqual(hiddenFingersOf(CURLED, []), [3, 0])
})

test('the hand\'s picture keeps a pale edge inside its own line and the shadow between curled fingers', () => {
  // The fist inked round, near-white along its right side within the line, a dark warm pocket inside.
  const img = new Uint8Array(W * H * 3).fill(255)
  const mask = new Uint8Array(W * H)
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const e = ((x - 205) / 50) ** 2 + ((y - 262) / 47) ** 2
      if (e >= 1.16) continue
      mask[y * W + x] = 1
      const pocket = (x - 200) ** 2 + (y - 262) ** 2 < 36
      const colour = e >= 1 ? [150, 100, 90] : pocket ? [185, 135, 115] : e > 0.78 && x > 235 ? [246, 242, 238] : SKIN
      img.set(colour, (y * W + x) * 3)
    }
  }
  const hand = measureDrawnHand({ width: W, height: H, img, mask, found: FOUND, elbow: [200, 430], wrist: [200, 330], tone: [...SKIN] })
  const inside = (q: P2) => hand.handOutline.reduce((odd, ring) => {
    let flip = false
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length]
      if ((a[1] > q[1]) !== (b[1] > q[1]) && q[0] < a[0] + ((q[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1])) flip = !flip
    })
    return flip ? !odd : odd
  }, false)
  assert.ok(inside([249, 262]), 'the pale edge')
  assert.ok(inside([200, 262]), 'the pocket')
  assert.ok(!inside([270, 262]), 'past the line')
})

test('the hand\'s picture keeps a wide highlight its skin runs into, not a patch its line rings round', () => {
  // The fist inked round on white ground, near white and colourless at its right side within the line; inside
  // it, white ground seen through a ring of finger, inked all round.
  const img = new Uint8Array(W * H * 3).fill(255)
  const mask = new Uint8Array(W * H)
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const e = ((x - 205) / 50) ** 2 + ((y - 262) / 47) ** 2
      if (e >= 1.16) continue
      mask[y * W + x] = 1
      const r = Math.hypot(x - 190, y - 258)
      const colour = e >= 1 || (r >= 16 && r < 18) ? [150, 100, 90] : r < 16 ? [255, 255, 255] : x > 245 && Math.abs(y - 262) < 11 ? [250, 242, 239] : SKIN
      img.set(colour, (y * W + x) * 3)
    }
  }
  const hand = measureDrawnHand({ width: W, height: H, img, mask, found: FOUND, elbow: [200, 430], wrist: [200, 330], tone: [...SKIN] })
  const inside = (q: P2) => hand.handOutline.reduce((odd, ring) => {
    let flip = false
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length]
      if ((a[1] > q[1]) !== (b[1] > q[1]) && q[0] < a[0] + ((q[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1])) flip = !flip
    })
    return flip ? !odd : odd
  }, false)
  assert.ok(inside([253, 262]), 'the highlight')
  assert.ok(!inside([190, 258]), 'the ground through the ring')
})
