import type { Anime25DArmModel } from './types'

/**
 * One side's gestures of a bust wear one sleeve: each one's raised forearm no wider than that sleeve.
 *
 * A gesture's forearm is measured across its own picture, and a forearm bent up beside its upper arm or held
 * across the body is measured with what lies next to it (the upper arm, the coat's front): near twice as wide as
 * the sleeve, a block where the drawing has a sleeve, wearing the coat beside it. What lies next to it only ever
 * adds, so the sleeve is no wider at each place than the gestures mostly measure it there: the second narrowest of
 * them (one may be measured thin where its picture hides it; so a side of two gestures keeps each its own measure). A standing figure's is measured where it hangs, with
 * nothing beside it.
 */
export function arm3DOneSleeve(models: Anime25DArmModel[]): Anime25DArmModel[] {
  if (models.length < 2) return models
  const size = models[0].radius.length
  const half = size >> 1
  const alike = models.filter((m) => m.radius.length === size)
  const sleeve = (i: number) => {
    const all = alike.map((m) => m.radius[i]).sort((a, b) => a - b)
    return all[Math.min(all.length - 1, 1)]
  }
  return models.map((model) => (model.radius.length === size ? { ...model, radius: model.radius.map((r, i) => (i < half ? r : Math.min(r, sleeve(i)))) } : model))
}
