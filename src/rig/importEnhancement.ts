import type { PreparedAnime25DRigImport } from './anime25dImporter'
import type { DocumentTurnKeyforms } from './turnKeyformImport'
import { placeBodyTurnKeyforms, placeTurnKeyforms } from './turnKeyformImport'

/**
 * The turn keys measured on the decomposition go into the playback, cut as it
 * is, and the playback keeps which enhancements it was made with, so its page
 * shows the mode it was made in.
 */
export function addImportEnhancement(
  prepared: PreparedAnime25DRigImport,
  keys: DocumentTurnKeyforms | undefined,
  withExpressions: boolean,
): void {
  // A figure keyed by its body alone has no head keys: its head turns as worked out.
  const headKeyforms = keys && placeTurnKeyforms(keys, prepared.documentFrame, prepared.documentFrame)
  const turnKeyforms = headKeyforms && Object.keys(headKeyforms).length > 0 ? headKeyforms : undefined
  const bodyTurnKeyforms = keys && placeBodyTurnKeyforms(keys, prepared.documentFrame, prepared.documentFrame)
  const playback = prepared.source.anime25dPlayback
  if (!playback) return
  if (turnKeyforms) playback.turnKeyforms = turnKeyforms
  if (bodyTurnKeyforms) playback.bodyTurnKeyforms = bodyTurnKeyforms
  playback.enhancement = {
    turn: Boolean(turnKeyforms),
    expressions: withExpressions,
    ...(bodyTurnKeyforms ? { body: true } : {}),
    ...(playback.layers.some((layer) => layer.armVariant) ? { arms: true } : {}),
  }
}
