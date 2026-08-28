import type {
  UpstreamGenericParts,
  UpstreamPsd,
  UpstreamPsdLayer,
  UpstreamRgbaImage,
  UpstreamRiggerApi,
} from './types'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { genericParts as upstreamGenericParts } from './genericParts'
import {
  ANIME25D_GENERIC_PART_SHA256,
  ANIME25D_UPSTREAM_REVISION,
  ANIME25D_VENDOR_SHA256,
} from './revision'
import { rigger as port } from './rigger'
import '../vendor/rigger.js'

const oracle = (globalThis as typeof globalThis & { Rigger: UpstreamRiggerApi })
  .Rigger

function image(
  width: number,
  height: number,
  paint: (x: number, y: number) => readonly [number, number, number, number],
): UpstreamRgbaImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.set(paint(x, y), (y * width + x) * 4)
    }
  }
  return { width, height, data }
}

function solidLayer(
  name: string,
  left: number,
  top: number,
  width: number,
  height: number,
  rgba: readonly [number, number, number, number] = [50, 40, 60, 255],
): UpstreamPsdLayer {
  return {
    name,
    left,
    top,
    right: left + width,
    bottom: top + height,
    imageData: image(width, height, () => rgba),
  }
}

function pairedLayer(
  name: string,
  canvasWidth: number,
  canvasHeight: number,
  rects: ReadonlyArray<{
    x: number
    y: number
    width: number
    height: number
    rgba?: readonly [number, number, number, number]
  }>,
): UpstreamPsdLayer {
  return {
    name,
    left: 0,
    top: 0,
    right: canvasWidth,
    bottom: canvasHeight,
    imageData: image(canvasWidth, canvasHeight, (x, y) => {
      const rect = rects.find(
        (candidate) =>
          x >= candidate.x &&
          x < candidate.x + candidate.width &&
          y >= candidate.y &&
          y < candidate.y + candidate.height,
      )
      return rect ? rect.rgba || [50, 40, 60, 255] : [0, 0, 0, 0]
    }),
  }
}

function representativePsd(): UpstreamPsd {
  const width = 180
  const height = 240
  const paired = (
    name: string,
    y: number,
    partWidth: number,
    partHeight: number,
    rgba?: readonly [number, number, number, number],
  ) =>
    pairedLayer(name, width, height, [
      { x: 42, y, width: partWidth, height: partHeight, rgba },
      { x: 112, y, width: partWidth, height: partHeight, rgba },
    ])

  return {
    width,
    height,
    children: [
      solidLayer('back hair', 20, 5, 140, 205, [80, 70, 100, 255]),
      solidLayer('topwear', 24, 165, 132, 75, [100, 80, 120, 255]),
      solidLayer('neck', 72, 135, 36, 80, [240, 190, 180, 255]),
      solidLayer('face', 35, 18, 110, 132, [245, 200, 190, 255]),
      paired('eyewhite', 69, 26, 12, [245, 245, 250, 255]),
      paired('irides', 71, 10, 10, [70, 90, 150, 255]),
      paired('eyelash', 66, 28, 5, [30, 20, 35, 255]),
      solidLayer('mouth', 75, 123, 30, 13, [120, 45, 65, 255]),
      solidLayer('front hair_1', 27, 3, 126, 112, [90, 80, 120, 255]),
      solidLayer('unknown ornament', 82, 30, 16, 16, [180, 140, 60, 255]),
      solidLayer('unknown sash', 70, 190, 40, 20, [70, 50, 90, 255]),
    ],
  }
}

function genericParts(): UpstreamGenericParts {
  return {
    eyeL: image(8, 4, () => [20, 15, 25, 255]),
    eyeR: image(8, 4, () => [20, 15, 25, 255]),
    mouth: image(10, 3, () => [90, 30, 45, 255]),
  }
}

function clonePsd(psd: UpstreamPsd): UpstreamPsd {
  return {
    width: psd.width,
    height: psd.height,
    children: psd.children?.map((layer) => ({
      ...layer,
      imageData: layer.imageData
        ? {
            width: layer.imageData.width,
            height: layer.imageData.height,
            data: new Uint8ClampedArray(layer.imageData.data),
          }
        : undefined,
    })),
  }
}

async function sha256(url: URL): Promise<string> {
  const source = await readFile(url)
  return createHash('sha256').update(source).digest('hex')
}

test('pins the exact vendored Anime2.5DRig oracle revision', async () => {
  assert.equal(
    ANIME25D_UPSTREAM_REVISION,
    'd48825867acd081de22b0e7b5585bb562288796d',
  )
  assert.equal(
    await sha256(new URL('../vendor/rigger.js', import.meta.url)),
    ANIME25D_VENDOR_SHA256.rigger,
  )
})

test('preserves every decoded byte of the upstream generic parts', () => {
  const expectedDimensions = {
    eyeL: { width: 88, height: 42 },
    eyeR: { width: 94, height: 32 },
    mouth: { width: 72, height: 18 },
  }
  for (const key of ['eyeL', 'eyeR', 'mouth'] as const) {
    const part = upstreamGenericParts.get(key)
    assert.ok(part)
    assert.deepEqual(
      { width: part.width, height: part.height },
      expectedDimensions[key],
    )
    assert.equal(
      createHash('sha256').update(part.data).digest('hex'),
      ANIME25D_GENERIC_PART_SHA256[key],
    )
    assert.equal(upstreamGenericParts.get(key)?.data, part.data)
  }
  assert.equal(upstreamGenericParts.get('missing'), null)
})

test('freezes upstream name normalization and numbered-layer semantics', () => {
  assert.equal(oracle.normName(' ＭＯＵＴＨ のコピー 2 '), 'mouth_open')
  assert.equal(oracle.normName('eyelash_c'), 'eye_close')
  assert.equal(oracle.normName('mouth-c'), 'mouth-c')
  assert.equal(oracle.normName('レイヤー 1'), 'facedetail')
  assert.equal(oracle.baseName('front hair_12'), 'front hair')
  assert.equal(oracle.baseName('front hair-12'), 'front hair-12')
})

test('freezes connected-component thresholds and the all-dust exception', () => {
  const width = 20
  const alpha = new Uint8Array(width * 12)
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 8; x += 1) alpha[y * width + x] = 17
  }
  for (let y = 7; y < 12; y += 1) {
    for (let x = 12; x < 19; x += 1) alpha[y * width + x] = 255
  }
  const cleaned = oracle._internals.cleanAlpha(alpha, width, 12, 40)
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 8; x += 1) assert.equal(cleaned[y * width + x], 17)
  }
  for (let y = 7; y < 12; y += 1) {
    for (let x = 12; x < 19; x += 1) assert.equal(cleaned[y * width + x], 0)
  }

  const onlyDust = new Uint8Array(10)
  onlyDust.fill(255, 0, 9)
  const returned = oracle._internals.cleanAlpha(onlyDust, 10, 1, 40)
  assert.equal(returned, onlyDust)
  assert.ok(returned.every((value, index) => value === (index < 9 ? 255 : 0)))
})

test('freezes in-place PSD cleanup, trim padding, and mutation shape', () => {
  const source: UpstreamPsd = {
    width: 60,
    height: 40,
    children: [
      {
        ...pairedLayer('face', 60, 40, [
          { x: 20, y: 10, width: 8, height: 8 },
          { x: 1, y: 1, width: 1, height: 1 },
        ]),
        canvas: { stale: true },
      },
      { name: 'group without pixels' },
    ],
  }
  const stats = oracle.cleanPsdLayers(source)
  assert.deepEqual(stats, { noisy: 1, layers: 1 })
  assert.deepEqual(
    {
      left: source.children?.[0]?.left,
      top: source.children?.[0]?.top,
      right: source.children?.[0]?.right,
      bottom: source.children?.[0]?.bottom,
      width: source.children?.[0]?.imageData?.width,
      height: source.children?.[0]?.imageData?.height,
      canvas: source.children?.[0]?.canvas,
    },
    {
      left: 16,
      top: 6,
      right: 32,
      bottom: 22,
      width: 16,
      height: 16,
      canvas: undefined,
    },
  )
})

test('freezes complete rig order, anchors, warnings, strands, and synthesis', () => {
  const rig = oracle.buildRig(representativePsd(), { generic: genericParts() })
  assert.deepEqual(rig.canvas, { w: 180, h: 240 })
  assert.deepEqual(
    rig.layers.map((layer) => layer.name),
    [
      'back hair',
      'topwear',
      'neck',
      'face',
      'eyewhite_l',
      'eyewhite_r',
      'irides_l',
      'irides_r',
      'eyelash_l',
      'eyelash_r',
      'eye_close_l',
      'eye_close_r',
      'mouth_open',
      'mouth_close',
      'front hair_1',
      'unknown ornament',
      'unknown sash',
    ],
  )
  assert.ok(rig.layers.every((layer, index) => layer.z === index))
  assert.deepEqual(rig.synth, { eye: true, mouth: true })
  assert.equal(
    rig.layers.find((layer) => layer.name === 'front hair_1')?.strands?.length,
    2,
  )
  assert.equal(
    rig.layers.find((layer) => layer.name === 'unknown ornament')?.group,
    'head',
  )
  assert.equal(
    rig.layers.find((layer) => layer.name === 'unknown sash')?.group,
    'body',
  )
  assert.equal(rig.anchors.bodyPivot.cy, 240)
  assert.equal(rig.anchors.hairRootY, rig.anchors.face.y0 + 60)
  assert.deepEqual(rig.warnings, [
    '未知のレイヤー名 "unknown ornament" — head として扱います',
    '未知のレイヤー名 "unknown sash" — body として扱います',
    'eye_close が無いため汎用閉じ目を自動配置しました（「目」の差分バーで調整可）',
    'mouth_close が無いため汎用閉じ口を自動配置しました（「口」のバーで調整可）',
  ])
})

test('freezes missing-face fallbacks and exact Japanese diagnostics', () => {
  assert.throws(
    () => oracle.buildRig({ width: 20, height: 30, children: [] }),
    new Error(
      'レイヤーが見つかりません（グループは未対応・フラット構成にしてください）',
    ),
  )
  const rig = oracle.buildRig({
    width: 100,
    height: 200,
    children: [solidLayer('mystery', 10, 120, 20, 20)],
  })
  assert.deepEqual(rig.anchors.face, {
    cx: 50,
    cy: 60,
    x0: 35,
    x1: 65,
    y0: 20,
    y1: 100,
  })
  assert.deepEqual(rig.warnings, [
    'face レイヤーがありません — キャンバス中央を顔とみなします',
    '未知のレイヤー名 "mystery" — body として扱います',
    '目のアンカーが不完全です（eyewhite/irides を確認）',
    'mouth_open / mouth_close がありません',
  ])
})

test('freezes flat-image composition and widest-gap eye splitting', () => {
  const flat = oracle.flattenPsdToImg({
    width: 8,
    height: 3,
    children: [
      solidLayer('back', 1, 1, 6, 1, [200, 0, 0, 128]),
      solidLayer('front', 2, 1, 2, 1, [0, 100, 0, 128]),
    ],
  })
  assert.ok(flat)
  assert.deepEqual(
    { width: flat.width, height: flat.height },
    { width: 6, height: 1 },
  )
  assert.deepEqual(Array.from(flat.data.subarray(4, 8)), [50, 50, 0, 192])

  const eyes = pairedLayer('eyes', 18, 5, [
    { x: 1, y: 1, width: 4, height: 3 },
    { x: 13, y: 1, width: 4, height: 3 },
  ]).imageData
  assert.ok(eyes)
  const split = oracle.splitImgLR(eyes)
  assert.ok(split)
  assert.deepEqual(
    {
      lw: split.l.width,
      lh: split.l.height,
      rw: split.r.width,
      rh: split.r.height,
    },
    { lw: 4, lh: 3, rw: 4, rh: 3 },
  )
})

test('oracle corpus can be cloned without sharing image buffers', () => {
  const source = representativePsd()
  const cloned = clonePsd(source)
  assert.deepEqual(cloned, source)
  assert.notEqual(
    cloned.children?.[0]?.imageData?.data,
    source.children?.[0]?.imageData?.data,
  )
})

test('TypeScript port is byte-for-byte equivalent on the representative corpus', () => {
  const source = representativePsd()
  assert.deepEqual(
    port.buildRig(clonePsd(source), { generic: genericParts() }),
    oracle.buildRig(clonePsd(source), { generic: genericParts() }),
  )

  const fallback: UpstreamPsd = {
    width: 100,
    height: 200,
    children: [solidLayer('mystery', 10, 120, 20, 20)],
  }
  assert.deepEqual(
    port.buildRig(clonePsd(fallback)),
    oracle.buildRig(clonePsd(fallback)),
  )

  const cleanup: UpstreamPsd = {
    width: 60,
    height: 40,
    children: [
      {
        ...pairedLayer('face', 60, 40, [
          { x: 20, y: 10, width: 8, height: 8 },
          { x: 1, y: 1, width: 1, height: 1 },
        ]),
        canvas: { stale: true },
      },
    ],
  }
  const portCleanup = clonePsd(cleanup)
  const oracleCleanup = clonePsd(cleanup)
  assert.deepEqual(
    port.cleanPsdLayers(portCleanup),
    oracle.cleanPsdLayers(oracleCleanup),
  )
  assert.deepEqual(portCleanup, oracleCleanup)

  const flatSource: UpstreamPsd = {
    width: 8,
    height: 3,
    children: [
      solidLayer('back', 1, 1, 6, 1, [200, 0, 0, 128]),
      solidLayer('front', 2, 1, 2, 1, [0, 100, 0, 128]),
    ],
  }
  assert.deepEqual(
    port.flattenPsdToImg(clonePsd(flatSource)),
    oracle.flattenPsdToImg(clonePsd(flatSource)),
  )
})

test('TypeScript image primitives match the JS oracle across seeded masks', () => {
  let state = 39657510
  const randomByte = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state >>> 24
  }

  for (let sample = 0; sample < 24; sample += 1) {
    const width = 11 + (sample % 9)
    const height = 9 + (sample % 7)
    const alpha = new Uint8Array(width * height)
    for (let index = 0; index < alpha.length; index += 1) {
      const value = randomByte()
      alpha[index] = value < 96 ? 0 : value
    }
    for (const threshold of [0, 8, 16, 127, 255]) {
      assert.deepEqual(
        port._internals.labelComponents(alpha, width, height, threshold),
        oracle._internals.labelComponents(alpha, width, height, threshold),
      )
    }
    const portClean = new Uint8Array(alpha)
    const oracleClean = new Uint8Array(alpha)
    assert.deepEqual(
      port._internals.cleanAlpha(portClean, width, height, 40),
      oracle._internals.cleanAlpha(oracleClean, width, height, 40),
    )
    assert.deepEqual(
      port._internals.detectStrands(alpha, width, height, 3, 6),
      oracle._internals.detectStrands(alpha, width, height, 3, 6),
    )
  }

  const contour = new Float32Array(97)
  for (let index = 0; index < contour.length; index += 1) {
    contour[index] = randomByte() / 3
  }
  assert.deepEqual(
    port._internals.findPeaks(contour, 7, 10),
    oracle._internals.findPeaks(contour, 7, 10),
  )
})

test('TypeScript port preserves build edge cases outside the representative PSD', () => {
  const explicitDiffs: UpstreamPsd = {
    width: 120,
    height: 180,
    children: [
      solidLayer('face', 20, 10, 80, 100),
      pairedLayer('eyewhite', 120, 180, [
        { x: 28, y: 45, width: 22, height: 10 },
        { x: 72, y: 45, width: 22, height: 10 },
      ]),
      pairedLayer('irides', 120, 180, [
        { x: 34, y: 46, width: 8, height: 8 },
        { x: 78, y: 46, width: 8, height: 8 },
      ]),
      pairedLayer('eye_close', 120, 180, [
        { x: 28, y: 50, width: 22, height: 4 },
        { x: 72, y: 50, width: 22, height: 4 },
      ]),
      solidLayer('mouth_open', 48, 103, 24, 10),
      solidLayer('mouth_close', 48, 107, 24, 4),
    ],
  }
  const negativeCoordinates: UpstreamPsd = {
    width: 80,
    height: 100,
    children: [
      solidLayer('face', -12.75, -7.25, 70, 80),
      solidLayer('front hair', -30, -20, 120, 95),
      solidLayer('off canvas', 200, 200, 10, 10),
    ],
  }
  const duplicateNames: UpstreamPsd = {
    width: 120,
    height: 180,
    children: [
      solidLayer('face', 10, 10, 70, 90),
      solidLayer('face', 30, 20, 70, 100),
      solidLayer('mouth_2', 47, 116, 26, 8),
      solidLayer('empty unknown', 10, 10, 2, 2, [0, 0, 0, 0]),
    ],
  }

  for (const psd of [explicitDiffs, negativeCoordinates, duplicateNames]) {
    assert.deepEqual(
      port.buildRig(clonePsd(psd), { generic: genericParts() }),
      oracle.buildRig(clonePsd(psd), { generic: genericParts() }),
    )
  }

  const noGap = image(8, 3, () => [20, 30, 40, 255])
  assert.deepEqual(port.splitImgLR(noGap), oracle.splitImgLR(noGap))
  for (const value of [
    '',
    ' mouth-01 ',
    'Ｍｏｕｔｈ＿３',
    'face のコピー',
    'face のコピー 19',
    'face copy 2',
  ]) {
    assert.equal(port.normName(value), oracle.normName(value))
    assert.equal(port.baseName(value), oracle.baseName(value))
  }
})
