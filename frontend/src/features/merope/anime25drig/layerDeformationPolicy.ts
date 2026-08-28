import type { Anime25DFade } from './types'

const SHADER_ONLY_FADES = new Set<Anime25DFade>([
  'maniacEyeShadow',
  'maniacMouthShadow',
])

const LOCAL_ROLE_DEFORMATION = new Set([
  'eye_close',
  'eye_dizzy',
  'eye_squeeze',
  'eye_cry',
  'eyebrow',
  'face',
  'nose',
  'topwear',
  'handwear',
  'neck',
  'collar_front',
])

export interface Anime25DLayerDeformationPolicy {
  shaderGlobalTransform: boolean
  localDynamic: boolean
}

/** Mirrors the explicit local-deformation branches owned by Anime25DPlayer. */
export function resolveAnime25DLayerDeformationPolicy(input: {
  baseRole: string
  fade: Anime25DFade | null
  hairPhysics: boolean
  hasBangWeights: boolean
  hasFrontHairParallax: boolean
  hasCollarContact: boolean
}): Anime25DLayerDeformationPolicy {
  const coupled =
    input.hasCollarContact ||
    input.hasFrontHairParallax ||
    input.hairPhysics ||
    input.hasBangWeights ||
    input.baseRole === 'neck' ||
    input.baseRole === 'collar_front' ||
    input.baseRole === 'topwear' ||
    input.baseRole === 'handwear'
  return {
    shaderGlobalTransform: !coupled,
    localDynamic:
      coupled ||
      LOCAL_ROLE_DEFORMATION.has(input.baseRole) ||
      Boolean(input.fade && !SHADER_ONLY_FADES.has(input.fade)),
  }
}
