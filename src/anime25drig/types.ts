// The identity and credit fields of a package of version 7, the version the importer writes.
import type { Anime25DPlaybackV7 } from '@myriad-you/figure-player'
import { ANIME25D_PLAYBACK_KIND, ANIME25D_PLAYBACK_VERSION } from '@myriad-you/figure-player/internals'
import { ANIME25D_COPYRIGHT, ANIME25D_LICENSE, ANIME25D_PROJECT_NAME, ANIME25D_PROJECT_URL } from '@myriad-you/figure-player/workbench'

export function anime25DPlaybackSource(): Pick<
  Anime25DPlaybackV7,
  'kind' | 'version' | 'engine' | 'engineUrl' | 'license' | 'copyright'
> {
  return {
    kind: ANIME25D_PLAYBACK_KIND,
    version: ANIME25D_PLAYBACK_VERSION,
    engine: ANIME25D_PROJECT_NAME,
    engineUrl: ANIME25D_PROJECT_URL,
    license: ANIME25D_LICENSE,
    copyright: ANIME25D_COPYRIGHT,
  }
}
