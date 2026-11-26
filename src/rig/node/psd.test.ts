import type { Layer } from 'ag-psd'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'
import test from 'node:test'
import { writePsd } from 'ag-psd'
import { decodeRigPsd } from '../psdDecode'
import { holdZipChannel } from './psd'

const image = (size: number) => ({ width: size, height: size, data: new Uint8ClampedArray(size * size * 4), colorSpace: 'srgb' as const })

/** A 256 × 256 PSD of `children`, its channels zip-compressed. */
function zipPsd(children: Layer[]): Uint8Array {
  return new Uint8Array(writePsd({ width: 256, height: 256, children }, { compress: true }))
}

interface LayerRecord {
  name: string
  /** Where its rectangle is (top, left, bottom, right). */
  rect: number
  /** Where its mask's rectangle is, if it has one. */
  maskRect?: number
  /** Where each of its channels' data starts (its compression first), by channel id. */
  channels: Map<number, number>
}

/** The layer records of a PSD, in the order of the file. */
function layerRecords(psd: Uint8Array): LayerRecord[] {
  const view = new DataView(psd.buffer, psd.byteOffset, psd.byteLength)
  let at = 26
  at += 4 + view.getUint32(at)
  at += 4 + view.getUint32(at)
  at += 4 + 4
  const count = Math.abs(view.getInt16(at))
  at += 2
  const records: LayerRecord[] = []
  const lengths: Array<Array<[number, number]>> = []
  for (let i = 0; i < count; i += 1) {
    const rect = at
    const channelCount = view.getUint16(at + 16)
    const list: Array<[number, number]> = []
    for (let c = 0; c < channelCount; c += 1) list.push([view.getInt16(at + 18 + c * 6), view.getUint32(at + 20 + c * 6)])
    at += 18 + channelCount * 6 + 12
    const extra = view.getUint32(at)
    const extraStart = at + 4
    const maskLength = view.getUint32(extraStart)
    const blending = extraStart + 4 + maskLength
    const nameAt = blending + 4 + view.getUint32(blending)
    const name = Buffer.from(psd.subarray(nameAt + 1, nameAt + 1 + psd[nameAt]!)).toString('latin1')
    records.push({ name, rect, maskRect: maskLength ? extraStart + 4 : undefined, channels: new Map() })
    lengths.push(list)
    at = extraStart + extra
  }
  for (let i = 0; i < count; i += 1) {
    for (const [id, length] of lengths[i]!) {
      records[i]!.channels.set(id, at)
      at += length
    }
  }
  return records
}

/** The record's rectangle (or its mask's) said to be `size` square, its pixels as they were. */
function shrink(psd: Uint8Array, rect: number, size: number): void {
  const view = new DataView(psd.buffer, psd.byteOffset, psd.byteLength)
  view.setInt32(rect + 8, view.getInt32(rect) + size)
  view.setInt32(rect + 12, view.getInt32(rect + 4) + size)
}

/** The bytes ag-psd's own pako inflates while `run` runs. */
function inflatedBy(run: () => void): number {
  const agPsd = createRequire(import.meta.url).resolve('ag-psd')
  const pako = createRequire(agPsd)('pako') as { inflate: (data: Uint8Array) => Uint8Array }
  const inflate = pako.inflate
  let bytes = 0
  pako.inflate = (data) => {
    const out = inflate(data)
    bytes += out.length
    return out
  }
  try {
    run()
  } finally {
    pako.inflate = inflate
  }
  return bytes
}

const refused = (error: unknown) => error instanceof Error && error.message === 'psdSpecInvalid'

test('a PSD channel zipped to inflate past its layer is refused before ag-psd inflates it', () => {
  // A 2048-square layer of zeros zips to a few kilobytes a channel; it is then said to be 16 square.
  const psd = zipPsd([{ name: 'body', top: 0, left: 0, imageData: image(2048) }])
  assert.ok(inflatedBy(() => decodeRigPsd(psd.slice().buffer, undefined, holdZipChannel)) >= 2048 * 2048 * 4)
  const [body] = layerRecords(psd)
  shrink(psd, body!.rect, 16)
  assert.equal(inflatedBy(() => assert.throws(() => decodeRigPsd(psd.buffer as ArrayBuffer, undefined, holdZipChannel), refused)), 0)
})

test('a bombed PSD channel with a broken layer after it inflates nothing: the PSD is read whole before any channel is', () => {
  const psd = zipPsd([
    { name: 'body', top: 0, left: 0, imageData: image(2048) },
    { name: 'broken', top: 0, left: 0, imageData: image(16) },
  ])
  const [body, broken] = layerRecords(psd)
  shrink(psd, body!.rect, 16)
  // A compression ag-psd cannot read, however it shifts to look for one.
  const at = broken!.channels.get(0)!
  psd.set([0xFF, 0xFF, 0xFF], at)
  // Even with nothing to hold the channels, nothing is inflated: the read fails first.
  assert.equal(inflatedBy(() => assert.throws(() => decodeRigPsd(psd.buffer as ArrayBuffer))), 0)
})

test('a bombed channel on a layer outside the tree (a group\'s closing divider) is never inflated', () => {
  // A layer that says it closes a group: ag-psd reads it, and leaves it out of the tree.
  const closing = { name: 'closing', top: 0, left: 0, imageData: image(2048), sectionDivider: { type: 3 } } as Layer
  const psd = zipPsd([{ name: 'group', opened: true, children: [closing, { name: 'body', top: 0, left: 0, imageData: image(32) }] }])
  const record = layerRecords(psd).find(({ name }) => name === 'closing')!
  shrink(psd, record.rect, 16)
  let decoded: ReturnType<typeof decodeRigPsd> | undefined
  const inflated = inflatedBy(() => {
    decoded = decodeRigPsd(psd.buffer as ArrayBuffer, undefined, holdZipChannel)
  })
  // Only the body's four channels.
  assert.equal(inflated, 4 * 32 * 32)
  assert.deepEqual(decoded!.children!.map(({ name, children }) => [name, children?.map((child) => child.name)]), [['group', ['body']]])
})

test('a mask channel is held to its mask\'s rectangle', () => {
  const mask = { top: 0, left: 0, bottom: 512, right: 512, defaultColor: 0, imageData: image(512) }
  const psd = zipPsd([{ name: 'body', top: 0, left: 0, imageData: image(32), mask }])
  const decoded = decodeRigPsd(psd.slice().buffer, undefined, holdZipChannel)
  assert.equal(decoded.children![0]!.mask!.imageData!.width, 512)
  const [body] = layerRecords(psd)
  assert.ok(body!.maskRect)
  assert.ok(body!.channels.has(-2))
  shrink(psd, body!.maskRect!, 8)
  assert.equal(inflatedBy(() => assert.throws(() => decodeRigPsd(psd.buffer as ArrayBuffer, undefined, holdZipChannel), refused)), 0)
})
