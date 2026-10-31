import type { Psd } from 'ag-psd'
import type { RigPsdImportOptions } from '../../../src/rig/psdImporter'
import { syntheticSeeThroughPsd } from '../../../src/rig/anime25dImporter.fixture'
import { prepareRigPsdImport } from '../../../src/rig/psdImporter'

/** The figure's import against this page, which serves the API itself. */
export function importPsd(file: File, options: Omit<RigPsdImportOptions, 'apiUrl'>) {
  return prepareRigPsdImport(file, { ...options, apiUrl: '' })
}

export function fixture(kind: string): Psd {
  const psd = syntheticSeeThroughPsd()
  if (kind === 'alternate-eyes') {
    const closed = psd.children!.find((l) => l.name === 'eyelash_c')!
    const data = new Uint8ClampedArray(closed.imageData!.data)
    for (let y = 0; y < 256; y++)
      data.fill(0, (y * 256 + 128) * 4, (y + 1) * 256 * 4)
    psd.children!.push({
      ...closed,
      name: 'eye_close2',
      imageData: { ...closed.imageData!, data },
    })
  }
  if (kind === 'missing-face')
    psd.children = psd.children!.filter((l) => l.name !== 'face')
  if (kind === 'collar' || kind === 'necklace') {
    // Portrait placement is fitted to this non-square PSD canvas.
    psd.height = 300
    const data = new Uint8ClampedArray(40 * 50 * 4)
    for (let i = 0; i < data.length; i += 4) data.set([245, 205, 190, 255], i)
    psd.children!.push({
      name: 'neck',
      left: 108,
      top: 138,
      imageData: { width: 40, height: 50, data },
    })
    if (kind === 'necklace') {
      const topwear = psd.children!.find((l) => l.name === 'topwear')!
      const pixels = topwear.imageData!.data
      pixels.fill(0, 0, 180 * 256 * 4)
      psd.children!.push({
        name: 'neckwear_1',
        left: 124,
        top: 144,
        imageData: {
          width: 8,
          height: 32,
          data: new Uint8ClampedArray(8 * 32 * 4).fill(255),
        },
      })
    }
  }
  return psd
}
