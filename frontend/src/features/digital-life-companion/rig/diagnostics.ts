import type { CompanionRigManifest, RigKeyframe } from './types'
import {
  presentationAssetCoverage,
  presentationIntentCoverage,
} from './presentation'
import { resolveRigSemantics } from './semantics'

export type RigDiagnosticSeverity = 'error' | 'warning' | 'info'

export interface RigDiagnostic {
  code: string
  severity: RigDiagnosticSeverity
  message: string
  clipId?: string
  boneId?: string
}

export interface RigDiagnosticReport {
  profile?: 'face-rig' | 'anime25d'
  score: number
  issues: RigDiagnostic[]
  capabilities: {
    facial: boolean
    lipSync: boolean
    gaze: boolean
    secondaryMotion: boolean
    layeredActions: boolean
    facialVariants: boolean
    deformableSkinning: boolean
    outfitAware: boolean
    collisionAware: boolean
    presentationCoverage: boolean
  }
}

export type RigCapability = keyof RigDiagnosticReport['capabilities']

const ANIME25D_ABANDONED_CAPABILITIES = new Set<RigCapability>([
  'layeredActions',
  'collisionAware',
  'presentationCoverage',
])

export function anime25DAbandonsCapability(capability: RigCapability): boolean {
  return ANIME25D_ABANDONED_CAPABILITIES.has(capability)
}

/** Capabilities a replacement candidate would remove from the current Rig. */
export function rigCapabilityRegressions(
  current: RigDiagnosticReport,
  candidate: RigDiagnosticReport,
): RigCapability[] {
  return (Object.keys(current.capabilities) as RigCapability[]).filter(
    (capability) =>
      !(
        candidate.profile === 'anime25d' &&
        anime25DAbandonsCapability(capability)
      ) &&
      current.capabilities[capability] &&
      !candidate.capabilities[capability],
  )
}

export function diagnoseRig(
  manifest: CompanionRigManifest,
): RigDiagnosticReport {
  const issues: RigDiagnostic[] = []
  const semantics = resolveRigSemantics(manifest)
  const roleByBone = new Map(
    Object.entries(semantics.bones).map(([role, boneId]) => [boneId, role]),
  )
  const facial = Boolean(
    semantics.bones.face ||
    semantics.bones['left-eye'] ||
    semantics.bones['right-eye'] ||
    semantics.bones.mouth,
  )
  const lipSync = Boolean(semantics.bones.mouth)
  const secondaryMotion = semantics.secondaryBoneIds.length > 0
  const facialSlots = new Set(
    (manifest.parts || []).flatMap((part) => (part.slot ? [part.slot] : [])),
  )
  const anime25d = (manifest.parts || []).some((part) =>
    part.id?.startsWith('a25d-'),
  )
  const splitEyeGaze =
    (facialSlots.has('eye-left') && facialSlots.has('eye-right')) ||
    (facialSlots.has('iris-left') && facialSlots.has('iris-right'))
  const gaze = Boolean(
    semantics.bones['left-eye'] &&
    semantics.bones['right-eye'] &&
    semantics.bones.head &&
    splitEyeGaze,
  )
  const mouthVariantCount = (manifest.parts || []).filter(
    (part) => part.slot === 'mouth',
  ).length
  const headExpressionCount = (manifest.parts || []).filter(
    (part) => part.slot === 'head-expression',
  ).length
  const facialVariants = anime25d
    ? splitEyeGaze && mouthVariantCount >= 2
    : (splitEyeGaze && mouthVariantCount >= 4) ||
      (headExpressionCount >= 4 && mouthVariantCount >= 4)
  const deformableSkinning = (manifest.parts || []).some((part) =>
    part.vertices?.some(
      (vertex) => vertex.weights.filter((weight) => weight > 0.02).length >= 2,
    ),
  )
  const outfitAware = Boolean(
    manifest.outfitProfile &&
    ['forehead', 'chest', 'chin'].every(
      (anchor) => manifest.semanticAnchors?.[anchor],
    ),
  )
  const collisionAware = ['head', 'torso'].every((id) =>
    manifest.spatialProfile?.collisionVolumes.some(
      (volume) => volume.id === id,
    ),
  )
  const clipChannels = new Set<string>()
  const presentationCoverage = presentationIntentCoverage(manifest)
  for (const coverage of presentationAssetCoverage(manifest)) {
    if (coverage.missingFallback) {
      issues.push(
        issue(
          'missing-presentation-fallback',
          'error',
          `Slot ${coverage.slot} is missing fallback variant ${coverage.missingFallback}`,
        ),
      )
    }
    if (coverage.unknown.length > 0) {
      issues.push(
        issue(
          'unknown-presentation-variant',
          'error',
          `Slot ${coverage.slot} contains unsupported variants: ${coverage.unknown.join(', ')}`,
        ),
      )
    }
  }
  if (!anime25d && presentationCoverage.gaps.length > 0) {
    const examples = presentationCoverage.gaps
      .slice(0, 4)
      .map((gap) => `${gap.clipId}:${gap.channel}=${gap.variant}`)
      .join(', ')
    issues.push(
      issue(
        'incomplete-presentation-coverage',
        'warning',
        `Character assets support ${presentationCoverage.supported}/${presentationCoverage.required} authored presentation intents; missing ${examples}`,
      ),
    )
  }

  if (!semantics.bones.head) {
    issues.push(issue('missing-head', 'error', 'Missing semantic head bone'))
  }
  if (!semantics.bones.torso) {
    issues.push(
      issue('missing-body', 'warning', 'Missing semantic body/torso bone'),
    )
  }
  if (!lipSync) {
    issues.push(
      issue('missing-mouth', 'warning', 'No mouth/lip/jaw bone for lip sync'),
    )
  }
  if (!gaze) {
    issues.push(
      issue(
        'missing-gaze',
        'warning',
        'Independent eye textures are required for visible gaze; eye bones alone are not sufficient',
      ),
    )
  }
  if (facial && !facialVariants) {
    issues.push(
      issue(
        'missing-facial-variants',
        'warning',
        'Face bones exist, but discrete head/eye and mouth texture variants are incomplete',
      ),
    )
  }
  if (!secondaryMotion) {
    issues.push(
      issue(
        'missing-secondary-motion',
        'info',
        'No independently split hair or accessory chain for secondary motion',
      ),
    )
  }
  if (!outfitAware) {
    issues.push(
      issue(
        'missing-outfit-profile',
        'warning',
        'No outfit topology/safety profile and character-local proportion anchors',
      ),
    )
  }
  if (!collisionAware && !anime25d) {
    issues.push(
      issue(
        'missing-spatial-profile',
        'warning',
        'No character-local head/torso bounds for interaction and deformation safety',
      ),
    )
  }
  if (!deformableSkinning) {
    issues.push(
      issue(
        'rigid-part-deformation',
        'warning',
        'All vertices use rigid single-bone weights; bending joints may still look segmented',
      ),
    )
  }
  if (!manifest.clips.some((clip) => clip.id === 'idle')) {
    issues.push(issue('missing-idle', 'warning', 'No explicit idle clip'))
  }
  if (!anime25d && !manifest.clips.some((clip) => clip.id === 'talking')) {
    issues.push(
      issue('missing-talking', 'info', 'No explicit talking base clip'),
    )
  }

  for (const clip of manifest.clips) {
    if (clip.tracks.length === 0) {
      issues.push(
        issue('empty-clip', 'error', 'Clip contains no tracks', clip.id),
      )
    }
    const authoredTrack = clip.tracks.filter(
      (track) => semanticChannel(track.boneId, roleByBone) !== 'face',
    )
    if (
      !clip.looping &&
      authoredTrack.length > 0 &&
      Math.max(...authoredTrack.map((track) => track.keyframes.length)) <= 3
    ) {
      issues.push(
        issue(
          'pose-only-action',
          'warning',
          'Action has too few phases for natural anticipation and follow-through',
          clip.id,
        ),
      )
    }
    for (const track of clip.tracks) {
      const channel = semanticChannel(track.boneId, roleByBone)
      clipChannels.add(channel)
      for (let index = 1; index < track.keyframes.length; index += 1) {
        const previous = track.keyframes[index - 1]
        const current = track.keyframes[index]
        const delta = Math.max(0.001, current.time - previous.time)
        const discreteEyeSwap =
          /eye/i.test(track.boneId) &&
          (facialSlots.has('eye-left') ||
            facialSlots.has('eye-right') ||
            facialSlots.has('head-expression'))
        if (!discreteEyeSwap && transformSpeed(previous, current) / delta > 8) {
          issues.push(
            issue(
              'transform-spike',
              'warning',
              'Abrupt transform spike may cause visible popping',
              clip.id,
              track.boneId,
            ),
          )
          break
        }
      }
    }
  }

  const penalty = issues.reduce(
    (sum, item) =>
      sum +
      (item.severity === 'error' ? 24 : item.severity === 'warning' ? 10 : 3),
    0,
  )
  return {
    profile: anime25d ? 'anime25d' : 'face-rig',
    score: Math.max(0, Math.min(100, 100 - penalty)),
    issues,
    capabilities: {
      facial,
      lipSync,
      gaze,
      secondaryMotion,
      layeredActions: clipChannels.size >= 3,
      facialVariants,
      deformableSkinning,
      outfitAware,
      collisionAware,
      presentationCoverage: presentationCoverage.gaps.length === 0,
    },
  }
}

function issue(
  code: string,
  severity: RigDiagnosticSeverity,
  message: string,
  clipId?: string,
  boneId?: string,
): RigDiagnostic {
  return { code, severity, message, clipId, boneId }
}

function semanticChannel(
  id: string,
  roleByBone: ReadonlyMap<string, string>,
): string {
  const role = roleByBone.get(id)
  if (role === 'face' || role?.includes('eye') || role === 'mouth')
    return 'face'
  if (role === 'head') return 'head'
  if (role === 'torso' || role === 'handwear') {
    return 'upper'
  }
  if (role === 'root') return 'full'
  const value = id.toLowerCase()
  if (/eye|brow|mouth|lip|jaw|face/.test(value)) return 'face'
  if (/head|hair|ear|ribbon/.test(value)) return 'head'
  if (/handwear|body|chest/.test(value)) return 'upper'
  return 'full'
}

function transformSpeed(previous: RigKeyframe, current: RigKeyframe): number {
  return (
    Math.hypot(
      current.transform.translation.x - previous.transform.translation.x,
      current.transform.translation.y - previous.transform.translation.y,
    ) +
    Math.abs(current.transform.rotation - previous.transform.rotation) +
    Math.abs(current.transform.scale.x - previous.transform.scale.x) +
    Math.abs(current.transform.scale.y - previous.transform.scale.y)
  )
}
