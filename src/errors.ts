import { formatTemplate } from './rig/formatTemplate'

/**
 * Why the figure could not play or import, in English. The page shows its own
 * words for each code, filling them with the error's params.
 */
export const FIGURE_ERROR_TEXT = {
  anime25dPlaybackFailed: '2.5D motion could not play.',
  anime25dWebglFailed: 'This browser does not support WebGL2, so 2.5D motion cannot play.',
  psdNeedAsset: 'The current master portrait is missing an asset id.',
  psdTooLarge: 'The PSD must be smaller than 32 MB.',
  anime25dMissingFace: 'The Anime2.5DRig PSD is missing the required face layer.',
  anime25dMissingLayer: 'The Anime2.5DRig PSD is missing the {role} layer.',
  anime25dContractMissing: 'The 2.5D visual contract is missing: {missing}',
  anime25dPartCount: 'Anime2.5DRig part count must be 1–{max}.',
  anime25dBoneLimit: 'Anime2.5DRig bone count exceeds {max}.',
  anime25dLayerTooWide: 'Layer {id} is wider than {max}.',
  anime25dAtlasOverflow: 'A layer does not fit a {max} canvas.',
  rigAtlasFailed: 'Failed to generate the rig atlas PNG.',
  canvasUnsupported: 'This browser does not support 2D Canvas.',
  psdPreviewFailed: 'Could not compose a PSD preview.',
  psdLayerCountInvalid: 'The PSD must have 1–64 visible pixel layers.',
  psdSpecInvalid: 'The PSD must be a 256–4096px 8-bit RGB document.',
} as const

export type FigureErrorCode = keyof typeof FIGURE_ERROR_TEXT
export type FigureErrorParams = Record<string, string | number>

export class FigureError extends Error {
  override readonly name = 'FigureError'

  constructor(
    readonly code: FigureErrorCode,
    readonly params: FigureErrorParams = {},
  ) {
    super(formatTemplate(FIGURE_ERROR_TEXT[code], params))
  }
}

export function isFigureErrorCode(value: unknown): value is FigureErrorCode {
  return typeof value === 'string' && Object.hasOwn(FIGURE_ERROR_TEXT, value)
}
