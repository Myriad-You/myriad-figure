// Which layers frame the figure when the importer crops it.
const EXTRA_FRAMING_ROLES = new Set(['unknown', 'objects', 'wings', 'tail'])

/** A bust's crop cuts these; only a full figure is framed by them. */
const LOWER_BODY_ROLES = new Set(['bottomwear', 'legwear', 'footwear'])

export function anime25DLayerAffectsFraming(
  layer: { role: string; width: number; height: number },
  documentArea: number,
  lowerBodyFrames = false,
): boolean {
  // A gesture arm never moves the frame the resting figure is placed in.
  return (
    layer.role !== 'arm-variant' &&
    layer.role !== 'arm-variant-hand' &&
    (lowerBodyFrames || !LOWER_BODY_ROLES.has(layer.role)) &&
    (!EXTRA_FRAMING_ROLES.has(layer.role) ||
      layer.width * layer.height < documentArea * 0.5)
  )
}
