// The engine and licence fields every package records.
import type { Anime25DPlayback } from '@myriad/figure-player'
import { ANIME25D_COPYRIGHT, ANIME25D_LICENSE, ANIME25D_PLAYBACK_KIND, ANIME25D_PLAYBACK_VERSION } from '@myriad/figure-player/internals'
import { ANIME25D_PROJECT_NAME, ANIME25D_PROJECT_URL } from '@myriad/figure-player/workbench'

export function anime25DPlaybackSource(): Pick<
  Anime25DPlayback,
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
