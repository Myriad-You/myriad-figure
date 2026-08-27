/**
 * Semantic layer depths replicated from Anime2.5DRig's `lib/rigger.js`.
 * Anime2.5DRig is MIT licensed, Copyright (c) 2026 hakoniwa.
 * https://github.com/852wa/Anime2.5DRig
 */
export const ANIME25D_LAYER_DEPTH = {
  'back-hair': 0.55,
  bottomwear: 0.88,
  'collar-back': 0.94,
  neck: 0.95,
  'collar-front': 0.955,
  topwear: 0.9,
  handwear: 0.86,
  earwear: 0.97,
  ears: 0.96,
  face: 1,
  facedetail: 1.02,
  'maniac-eye-shadow': 1.04,
  headwear: 1.2,
  'mouth-close': 1.08,
  'mouth-open': 1.08,
  'mouth-wide': 1.08,
  'mouth-round': 1.08,
  'mouth-narrow': 1.08,
  'mouth-cry': 1.08,
  'mouth-maniac': 1.08,
  nose: 1.15,
  eyewhite: 1.06,
  eyebrow: 1.14,
  irides: 1.08,
  eyelash: 1.12,
  'eye-close': 1.12,
  'eye-dizzy': 1.12,
  'eye-squeeze': 1.12,
  'eye-cry': 1.12,
  'front-hair': 1.28,
  'anger-mark': 1.3,
  'speechless-sweat': 1.3,
} as const

export type Anime25DLayerRole = keyof typeof ANIME25D_LAYER_DEPTH
