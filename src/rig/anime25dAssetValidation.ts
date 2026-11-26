import type { RasterLayer } from './anime25dImportTypes'
import { FigureError } from '../errors'
import { missingAnime25DRequiredCapabilities } from './anime25dCapabilities'

export function validateAnime25DCharacterLayers(
  layers: readonly RasterLayer[],
): void {
  const missing = missingAnime25DRequiredCapabilities(layers)
  if (missing.length > 0) {
    throw new FigureError('anime25dContractMissing', {
        missing: missing.join(', '),
      })
  }
}
