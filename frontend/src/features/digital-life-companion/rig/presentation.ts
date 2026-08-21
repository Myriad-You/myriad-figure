import type { SpeechViseme } from './articulation'
import type {
  CompanionRigManifest,
  RigClipPresentation,
  RigExpressionPresentation,
  RigPart,
  RigTransform,
} from './types'
import { RIG_PRESENTATION_SLOTS } from './contract'

export interface ExpressionChannels {
  frame: 'neutral' | 'happy' | 'surprise' | 'sad'
  brow: 'neutral' | 'happy' | 'worried'
  restingMouth: 'closed' | 'smile' | 'surprised' | 'sad'
}

export interface PresentationIntentGap {
  clipId: string
  channel: 'expression'
  variant: string
}

export interface PresentationIntentCoverage {
  required: number
  supported: number
  ratio: number
  gaps: PresentationIntentGap[]
}

const PERFORMANCE_EXPRESSIONS: Readonly<
  Record<string, RigExpressionPresentation>
> = {
  neutral: 'neutral',
  focused: 'neutral',
  happy: 'happy',
  warm: 'happy',
  playful: 'happy',
  surprise: 'surprise',
  sad: 'sad',
  concerned: 'sad',
}

const PRESENTATION_INDEX = new WeakMap<
  CompanionRigManifest['clips'],
  ReadonlyMap<string, RigClipPresentation>
>()
const VARIANT_INDEX = new WeakMap<
  CompanionRigManifest['parts'],
  ReadonlyMap<string, ReadonlySet<string>>
>()
const VARIANT_FALLBACK_INDEX = new WeakMap<
  CompanionRigManifest['parts'],
  ReadonlyMap<string, string>
>()

export function rigPartRenderDepth(
  part: Pick<RigPart, 'id' | 'zIndex'>,
): number {
  return part.zIndex
}

export function selectFacialVariants(
  activeClipIds: readonly string[] | ReadonlySet<string>,
  viseme: SpeechViseme,
  pose: readonly RigTransform[],
  boneIndexes: Readonly<Record<string, number>>,
  manifest?: CompanionRigManifest,
  clipProgress?: ReadonlyMap<string, number>,
): Record<string, string> {
  const active = activeClipSet(activeClipIds)
  return selectFacialVariantsFromSet(
    active,
    viseme,
    pose,
    boneIndexes,
    manifest,
    clipProgress,
  )
}

function selectFacialVariantsFromSet(
  active: ReadonlySet<string>,
  viseme: SpeechViseme,
  pose: readonly RigTransform[],
  boneIndexes: Readonly<Record<string, number>>,
  manifest?: CompanionRigManifest,
  clipProgress?: ReadonlyMap<string, number>,
): Record<string, string> {
  const expression = resolveExpressionChannelsFromSet(
    active,
    manifest,
    clipProgress,
  )
  const mouth =
    viseme === 'open'
      ? 'open'
      : viseme === 'wide'
        ? 'wide'
        : viseme === 'round'
          ? 'round'
          : viseme === 'narrow'
            ? 'narrow'
            : active.has('talking')
              ? 'open'
              : expression.restingMouth
  return {
    'eye-left': eyeVariant('left-eye', pose, boneIndexes),
    'eye-right': eyeVariant('right-eye', pose, boneIndexes),
    'brow-left': expression.brow,
    'brow-right': expression.brow,
    mouth,
  }
}

export function selectPartVariants(
  activeClipIds: readonly string[] | ReadonlySet<string>,
  viseme: SpeechViseme,
  pose: readonly RigTransform[],
  boneIndexes: Readonly<Record<string, number>>,
  hasHeadExpressionSlot = false,
  manifest?: CompanionRigManifest,
  clipProgress?: ReadonlyMap<string, number>,
): Record<string, string> {
  return selectPartVariantsInto(
    {},
    activeClipIds,
    viseme,
    pose,
    boneIndexes,
    hasHeadExpressionSlot,
    manifest,
    clipProgress,
  )
}

export function selectPartVariantsInto(
  output: Record<string, string>,
  activeClipIds: readonly string[] | ReadonlySet<string>,
  viseme: SpeechViseme,
  pose: readonly RigTransform[],
  boneIndexes: Readonly<Record<string, number>>,
  hasHeadExpressionSlot = false,
  manifest?: CompanionRigManifest,
  clipProgress?: ReadonlyMap<string, number>,
): Record<string, string> {
  const active = activeClipSet(activeClipIds)
  const frame = resolveExpressionFrameFromSet(active, manifest, clipProgress)
  const brow =
    frame === 'surprise' || frame === 'sad'
      ? 'worried'
      : frame === 'happy'
        ? 'happy'
        : 'neutral'
  const restingMouth =
    frame === 'surprise'
      ? 'surprised'
      : frame === 'sad'
        ? 'sad'
        : frame === 'happy'
          ? 'smile'
          : 'closed'
  const mouth =
    viseme === 'open' ||
    viseme === 'wide' ||
    viseme === 'round' ||
    viseme === 'narrow'
      ? viseme
      : active.has('talking')
        ? 'open'
        : restingMouth
  const leftEye = eyeVariant('left-eye', pose, boneIndexes)
  const rightEye = eyeVariant('right-eye', pose, boneIndexes)
  const blink = leftEye === 'closed' || rightEye === 'closed'
  const headExpression = blink ? 'blink' : frame
  const hasSpeechMouth =
    viseme === 'open' ||
    viseme === 'wide' ||
    viseme === 'round' ||
    viseme === 'narrow' ||
    active.has('talking')
  const available =
    manifest && Array.isArray(manifest.parts)
      ? variantIndex(manifest.parts)
      : undefined
  const fallbacks =
    manifest && Array.isArray(manifest.parts)
      ? variantFallbackIndex(manifest.parts)
      : undefined
  writeAvailableVariant(
    output,
    'eye-left',
    hasHeadExpressionSlot ? 'open' : leftEye,
    available,
    fallbacks,
  )
  writeAvailableVariant(
    output,
    'eye-right',
    hasHeadExpressionSlot ? 'open' : rightEye,
    available,
    fallbacks,
  )
  writeAvailableVariant(
    output,
    'brow-left',
    hasHeadExpressionSlot ? 'neutral' : brow,
    available,
    fallbacks,
  )
  writeAvailableVariant(
    output,
    'brow-right',
    hasHeadExpressionSlot ? 'neutral' : brow,
    available,
    fallbacks,
  )
  writeAvailableVariant(
    output,
    'mouth',
    hasHeadExpressionSlot && !hasSpeechMouth ? 'closed' : mouth,
    available,
    fallbacks,
  )
  if (hasHeadExpressionSlot) {
    writeAvailableVariant(
      output,
      'head-expression',
      headExpression,
      available,
      fallbacks,
    )
    writeAvailableVariant(
      output,
      'eye-frame',
      headExpression,
      available,
      fallbacks,
    )
    writeAvailableVariant(
      output,
      'iris-left',
      blink ? 'hidden' : 'visible',
      available,
      fallbacks,
    )
    writeAvailableVariant(
      output,
      'iris-right',
      blink ? 'hidden' : 'visible',
      available,
      fallbacks,
    )
  }
  if (available) {
    for (const [slot, variants] of available) {
      if (output[slot] !== undefined || variants.size === 0) continue
      const stable = fallbacks?.get(slot)
      if (stable !== undefined) output[slot] = stable
    }
  }
  return output
}

/**
 * Resolves requested presentation variants against the current character's
 * compiled assets. Partial variant sets degrade to their slot fallback (or the
 * first available drawing) instead of making the part disappear.
 */
export function resolveAvailablePartVariants(
  requested: Readonly<Record<string, string>>,
  manifest?: CompanionRigManifest,
): Record<string, string> {
  if (!manifest) return { ...requested }
  const parts = manifest.parts
  if (!Array.isArray(parts)) return { ...requested }
  let index = VARIANT_INDEX.get(parts)
  if (!index) {
    const mutable = new Map<string, Set<string>>()
    for (const part of parts) {
      if (!part.slot || !part.variant) continue
      const variants = mutable.get(part.slot) ?? new Set<string>()
      variants.add(part.variant)
      mutable.set(part.slot, variants)
    }
    index = mutable
    VARIANT_INDEX.set(parts, index)
  }
  const resolved: Record<string, string> = {}
  for (const [slot, target] of Object.entries(requested)) {
    const available = index.get(slot)
    if (!available || available.size === 0) {
      resolved[slot] = target
      continue
    }
    if (available.has(target)) {
      resolved[slot] = target
      continue
    }
    const definition = presentationSlotDefinition(slot)
    resolved[slot] =
      (definition && available.has(definition.fallback)
        ? definition.fallback
        : available.values().next().value) ?? target
  }
  for (const [slot, available] of index) {
    if (resolved[slot] !== undefined || available.size === 0) continue
    const definition = presentationSlotDefinition(slot)
    const stable =
      definition && available.has(definition.fallback)
        ? definition.fallback
        : available.values().next().value
    if (stable !== undefined) resolved[slot] = stable
  }
  return resolved
}

export function presentationAssetCoverage(
  manifest: CompanionRigManifest,
): Array<{ slot: string; missingFallback: string | null; unknown: string[] }> {
  const variantsBySlot = new Map<string, Set<string>>()
  for (const part of manifest.parts ?? []) {
    if (!part.slot || !part.variant) continue
    const variants = variantsBySlot.get(part.slot) ?? new Set<string>()
    variants.add(part.variant)
    variantsBySlot.set(part.slot, variants)
  }
  return [...variantsBySlot].map(([slot, variants]) => {
    const definition = presentationSlotDefinition(slot)
    return {
      slot,
      missingFallback:
        definition && !variants.has(definition.fallback)
          ? definition.fallback
          : null,
      unknown: definition
        ? [...variants].filter(
            (variant) => !definition.variants.includes(variant as never),
          )
        : [],
    }
  })
}

/** Compares clip-authored presentation intent with this character's assets. */
export function presentationIntentCoverage(
  manifest: CompanionRigManifest,
): PresentationIntentCoverage {
  const variants = presentationVariantsBySlot(manifest.parts ?? [])
  const requirements = new Map<string, PresentationIntentGap>()
  for (const clip of manifest.clips ?? []) {
    const presentation = clip.presentation
    if (!presentation) continue
    const expressions = new Set(
      [
        presentation.expression,
        ...(presentation.keyframes ?? []).map((frame) => frame.expression),
      ].filter((value): value is RigExpressionPresentation => Boolean(value)),
    )
    for (const expression of expressions) {
      if (expression === 'neutral') continue
      const gap = {
        clipId: clip.id,
        channel: 'expression' as const,
        variant: expression,
      }
      requirements.set(requirementKey(gap), gap)
    }
  }
  const gaps = [...requirements.values()].filter(
    (requirement) => !expressionIntentIsAvailable(variants, requirement.variant),
  )
  const required = requirements.size
  const supported = required - gaps.length
  return {
    required,
    supported,
    ratio: required === 0 ? 1 : supported / required,
    gaps,
  }
}

function presentationVariantsBySlot(
  parts: readonly Pick<RigPart, 'slot' | 'variant'>[],
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>()
  for (const part of parts) {
    if (!part.slot || !part.variant) continue
    const values = result.get(part.slot) ?? new Set<string>()
    values.add(part.variant)
    result.set(part.slot, values)
  }
  return result
}

function expressionIntentIsAvailable(
  variants: ReadonlyMap<string, ReadonlySet<string>>,
  expression: string,
): boolean {
  return Boolean(
    variants.get('head-expression')?.has(expression) ||
    variants.get('eye-frame')?.has(expression),
  )
}

function requirementKey(requirement: PresentationIntentGap): string {
  return `${requirement.clipId}:${requirement.channel}:${requirement.variant}`
}

function presentationSlotDefinition(
  slot: string,
): { fallback: string; variants: readonly string[] } | undefined {
  return (
    RIG_PRESENTATION_SLOTS as Record<
      string,
      { fallback: string; variants: readonly string[] }
    >
  )[slot]
}

/** Resolves nuanced performance intent to a real split/full-head asset frame. */
export function expressionAssetVariant(
  activeClipIds: readonly string[] | ReadonlySet<string>,
  manifest?: CompanionRigManifest,
  clipProgress?: ReadonlyMap<string, number>,
): 'neutral' | 'happy' | 'surprise' | 'sad' {
  return resolveExpressionChannels(activeClipIds, manifest, clipProgress).frame
}

export function resolveExpressionChannels(
  activeClipIds: readonly string[] | ReadonlySet<string>,
  manifest?: CompanionRigManifest,
  clipProgress?: ReadonlyMap<string, number>,
): ExpressionChannels {
  return resolveExpressionChannelsFromSet(
    activeClipSet(activeClipIds),
    manifest,
    clipProgress,
  )
}

function resolveExpressionChannelsFromSet(
  active: ReadonlySet<string>,
  manifest?: CompanionRigManifest,
  clipProgress?: ReadonlyMap<string, number>,
): ExpressionChannels {
  const frame = resolveExpressionFrameFromSet(active, manifest, clipProgress)
  if (frame === 'surprise')
    return { frame, brow: 'worried', restingMouth: 'surprised' }
  if (frame === 'sad') return { frame, brow: 'worried', restingMouth: 'sad' }
  if (frame === 'happy') return { frame, brow: 'happy', restingMouth: 'smile' }
  return { frame, brow: 'neutral', restingMouth: 'closed' }
}

function resolveExpressionFrameFromSet(
  active: ReadonlySet<string>,
  manifest?: CompanionRigManifest,
  clipProgress?: ReadonlyMap<string, number>,
): RigExpressionPresentation {
  if (active.size === 0) return 'neutral'
  let frame: RigExpressionPresentation = 'neutral'
  let priority = 0
  for (const token of active) {
    const candidate =
      clipExpressionPresentation(
        indexedClipPresentation(manifest, token),
        clipProgress?.get(token),
      ) ?? PERFORMANCE_EXPRESSIONS[token]
    const candidatePriority = expressionPriority(candidate)
    if (candidate && candidatePriority > priority) {
      frame = candidate
      priority = candidatePriority
    }
  }
  return frame
}

function indexedClipPresentation(
  manifest: CompanionRigManifest | undefined,
  clipId: string,
): RigClipPresentation | undefined {
  if (!manifest) return undefined
  let index = PRESENTATION_INDEX.get(manifest.clips)
  if (!index) {
    index = new Map(
      manifest.clips.flatMap((clip) =>
        clip.presentation ? [[clip.id, clip.presentation] as const] : [],
      ),
    )
    PRESENTATION_INDEX.set(manifest.clips, index)
  }
  return index.get(clipId)
}

function clipExpressionPresentation(
  presentation: RigClipPresentation | undefined,
  progress: number | undefined,
): RigExpressionPresentation | undefined {
  let result = presentation?.expression
  if (
    !presentation ||
    progress === undefined ||
    !presentation.keyframes?.length
  ) {
    return result
  }
  const phase = Math.max(0, Math.min(1, progress))
  for (const keyframe of presentation.keyframes) {
    if (keyframe.progress > phase) break
    if (keyframe.expression !== undefined) result = keyframe.expression
  }
  return result
}

function expressionPriority(
  value: RigExpressionPresentation | undefined,
): number {
  return value === 'surprise'
    ? 3
    : value === 'sad'
      ? 2
      : value === 'happy'
        ? 1
        : 0
}

interface FacialVariantTransition {
  current: string
  previous?: string
  changedAt: number
  durationMs: number
}

export class FacialVariantMixer {
  private readonly transitions = new Map<string, FacialVariantTransition>()

  update(targets: Readonly<Record<string, string>>, nowMs: number): boolean {
    let changed = false
    for (const slot in targets) {
      const target = targets[slot]
      const transition = this.transitions.get(slot)
      if (!transition) {
        this.transitions.set(slot, {
          current: target,
          changedAt: nowMs,
          durationMs: facialTransitionDuration(slot, target, undefined),
        })
        changed = true
      } else if (transition.current !== target) {
        this.transitions.set(slot, {
          current: target,
          previous: transition.current,
          changedAt: nowMs,
          durationMs: facialTransitionDuration(
            slot,
            target,
            transition.current,
          ),
        })
        changed = true
      }
    }
    return changed
  }

  drawOrder(slot: string, variant: string): number {
    const transition = this.transitions.get(slot)
    if (!transition) return 0
    if (variant === transition.previous) return 1
    if (variant === transition.current) return 2
    return 0
  }

  opacity(slot: string, variant: string, nowMs: number): number {
    const transition = this.transitions.get(slot)
    if (!transition) return 0
    const amount = smootherstep(
      Math.max(
        0,
        Math.min(1, (nowMs - transition.changedAt) / transition.durationMs),
      ),
    )
    if (slot === 'head-expression') {
      if (variant === transition.current) return amount
      if (variant === transition.previous) return amount >= 1 ? 0 : 1
      return 0
    }
    if (variant === transition.current) return amount
    if (variant === transition.previous) return 1 - amount
    return 0
  }
}

function facialTransitionDuration(
  slot: string,
  target: string,
  previous: string | undefined,
): number {
  const releasingViseme =
    slot === 'mouth' &&
    target === 'closed' &&
    previous !== undefined &&
    ['open', 'wide', 'round', 'narrow'].includes(previous)
  if (releasingViseme) return 150
  const releasingExpression =
    previous !== undefined &&
    (target === 'neutral' ||
      target === 'closed' ||
      target === 'relaxed' ||
      target === 'visible')
  if (releasingExpression) {
    // A staggered release avoids the mask-like snap that happens when the
    // action pose and every facial channel return to rest on the same frame.
    if (slot === 'head-expression') return 260
    if (slot === 'eye-frame') return 220
    if (slot.startsWith('brow-')) return 185
    if (slot === 'mouth') return 210
    if (slot.startsWith('hand-')) return 170
  }
  return slot.startsWith('eye-') || slot.startsWith('iris-')
    ? 46
    : slot === 'mouth'
      ? 68
      : slot === 'head-expression'
        ? 140
        : slot.startsWith('hand-')
          ? 72
          : 130
}

function activeClipSet(
  activeClipIds: readonly string[] | ReadonlySet<string>,
): ReadonlySet<string> {
  return activeClipIds instanceof Set ? activeClipIds : new Set(activeClipIds)
}

function variantIndex(
  parts: CompanionRigManifest['parts'],
): ReadonlyMap<string, ReadonlySet<string>> {
  let index = VARIANT_INDEX.get(parts)
  if (index) return index
  const mutable = new Map<string, Set<string>>()
  for (const part of parts) {
    if (!part.slot || !part.variant) continue
    const variants = mutable.get(part.slot) ?? new Set<string>()
    variants.add(part.variant)
    mutable.set(part.slot, variants)
  }
  index = mutable
  VARIANT_INDEX.set(parts, index)
  return index
}

function variantFallbackIndex(
  parts: CompanionRigManifest['parts'],
): ReadonlyMap<string, string> {
  const cached = VARIANT_FALLBACK_INDEX.get(parts)
  if (cached) return cached
  const fallbacks = new Map<string, string>()
  for (const [slot, variants] of variantIndex(parts)) {
    const definition = presentationSlotDefinition(slot)
    const fallback =
      definition && variants.has(definition.fallback)
        ? definition.fallback
        : variants.values().next().value
    if (fallback !== undefined) fallbacks.set(slot, fallback)
  }
  VARIANT_FALLBACK_INDEX.set(parts, fallbacks)
  return fallbacks
}

function writeAvailableVariant(
  output: Record<string, string>,
  slot: string,
  target: string,
  availableBySlot?: ReadonlyMap<string, ReadonlySet<string>>,
  fallbackBySlot?: ReadonlyMap<string, string>,
): void {
  const available = availableBySlot?.get(slot)
  if (!available || available.size === 0 || available.has(target)) {
    output[slot] = target
    return
  }
  if (
    slot === 'mouth' &&
    available.has('open') &&
    ['wide', 'round', 'narrow'].includes(target)
  ) {
    // Anime2.5DRig intentionally has only mouth_open / mouth_close. Preserve
    // speech activity when the articulation layer asks for a richer viseme;
    // those shapes collapse to `open`, not the stable closed-mouth fallback.
    output[slot] = 'open'
    return
  }
  output[slot] = fallbackBySlot?.get(slot) ?? target
}

function eyeVariant(
  id: string,
  pose: readonly RigTransform[],
  indexes: Readonly<Record<string, number>>,
): string {
  const index = indexes[id] ?? -1
  return index >= 0 && (pose[index]?.scale.y ?? 1) < 0.52 ? 'closed' : 'open'
}

function smootherstep(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10)
}
