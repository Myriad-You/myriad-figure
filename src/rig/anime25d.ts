// How a layer role fades, as the importer records it.
import type { Anime25DFade, Anime25DLayerRole } from '@myriad/figure-player/internals'
import { ANIME25D_LAYER_DESCRIPTORS } from '@myriad/figure-player/internals'

export function anime25DLayerFade(role: string): Anime25DFade | null {
  return Object.hasOwn(ANIME25D_LAYER_DESCRIPTORS, role)
    ? ANIME25D_LAYER_DESCRIPTORS[role as Anime25DLayerRole].fade
    : null
}
