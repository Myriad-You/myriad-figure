// Whether a package's front-hair locks fit the one picture they are drawn together in, as the manifest check reads it.
import type { Anime25DPlaybackLayer } from '@myriad/figure-player/internals'
import { resolveAnime25DLayerSemantics } from '@myriad/figure-player/internals'

/** Locks of front hair are laid together in one picture when the stage binds them: its pixels, and those times the locks read for each. */
const MAX_FRINGE_PIXELS = 2 * 4096 ** 2

const MAX_FRINGE_READS = 16 * MAX_FRINGE_PIXELS

/**
 * Front hair cut into locks is put together in one picture, as large as they reach over the canvas and as fine as the
 * finest is drawn on its atlas: no larger than a page can hold and read. (The server holds an atlas to its said size.)
 */
export function fringeFits(layers: readonly Anime25DPlaybackLayer[], atlas: { width: number }): boolean {
  const locks = layers.map(resolveAnime25DLayerSemantics).filter((layer) => layer.role === 'front-hair')
  if (locks.length < 2) return true
  const scale = Math.max(...locks.map((lock) => Math.max(1, lock.atlas.w * atlas.width) / lock.w))
  const across = Math.max(...locks.map((lock) => lock.x + lock.w)) - Math.min(...locks.map((lock) => lock.x))
  const down = Math.max(...locks.map((lock) => lock.y + lock.h)) - Math.min(...locks.map((lock) => lock.y))
  const pixels = (across * scale + 1) * (down * scale + 1)
  return pixels <= MAX_FRINGE_PIXELS && pixels * locks.length <= MAX_FRINGE_READS
}
