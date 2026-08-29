import type {
  PerformanceBaseline,
  PerformanceCue,
  PerformanceDirective,
  PerformancePhase,
  RigBeatPhase,
  RigMusicEnergy,
  RigStateSummary,
} from '../../../services/agent/types'
import type { MeropeRigManifest } from '../rig/types'
import type { SingingSpectrumDrive } from '../singing/singingGroove'
import type { MotionRuntime } from './runtime'
import { scheduleBodyCues } from '../anime25drig/performanceMotion'
import { hasAnime25DCapability } from '../rig/anime25dCapabilities'
import { cueOccupiesHeadBody } from './performanceChannels'

const EXPRESSIONS: readonly PerformanceBaseline['expression'][] = [
  'withdrawn',
  'subdued',
  'steady',
  'warm',
]
const POSTURES: readonly PerformanceBaseline['posture'][] = [
  'closed',
  'neutral',
  'open',
]
const PHASES: readonly (PerformancePhase | 'idle')[] = [
  'reaction',
  'delivery',
  'outcome',
  'proactive',
  'mood',
  'idle',
]
const CAPABILITY_MAP = [
  ['blink', 'blink'],
  ['independent-eyes', 'independent-eyes'],
  ['dizzy-eye-variant', 'dizzy-eye'],
  ['squeeze-eye-variant', 'squeeze-eye'],
  ['cry-eye-variant', 'cry-eye'],
  ['silly-eye-variant', 'silly-eye'],
  ['lovestruck-heart-pupils', 'lovestruck'],
  ['lovestruck-face-effects', 'lovestruck'],
  ['cry-mouth-variant', 'cry-mouth'],
  ['maniac-mouth-variant', 'maniac-mouth'],
  ['silly-mouth-variant', 'silly-mouth'],
  ['mouth-shapes', 'mouth-shapes'],
] as const
const MAX_RECENT = 6

export function semanticRigCapabilities(
  manifest: MeropeRigManifest | null | undefined,
): string[] {
  if (!manifest) return []
  const layers = [
    ...manifest.parts.map((part) => ({
      id: part.id,
      slot: part.slot,
      variant: part.variant,
    })),
    ...(manifest.anime25dPlayback?.layers.map((layer) => ({
      id: layer.name,
      role: layer.role,
      side:
        layer.side === 'L' ? ('left' as const) : layer.side === 'R' ? ('right' as const) : null,
    })) ?? []),
  ]
  const capabilities = new Set<string>(['head-body'])
  for (const [internal, semantic] of CAPABILITY_MAP) {
    if (hasAnime25DCapability(layers, internal)) capabilities.add(semantic)
  }
  return [...capabilities]
}

export function captureRigStateSummary(
  runtime: MotionRuntime,
  nowMs: number = currentNow(),
): RigStateSummary {
  const frame = runtime.frame()
  const facts = runtime.summaryFacts()
  const performance = frame.performance?.directive ?? null
  const startedAtMs = frame.performance?.startedAtMs ?? 0
  const baseline = performance?.plan.baseline
  const acting = resolveActing(performance, startedAtMs, nowMs)
  const spectrum = frame.music?.spectrum ?? null
  const singing = Boolean(frame.music?.apply.writeGroove)
  const musicPlaying = singing || Boolean(frame.music && !frame.music.apply.release)
  return {
    expression: allowExpression(baseline?.expression) ?? 'steady',
    posture: allowPosture(baseline?.posture) ?? 'neutral',
    acting,
    owners: {
      mouth: frame.snapshot.owners.mouth,
      expression: frame.snapshot.owners.expression,
      gaze: frame.snapshot.owners.gaze,
      headBody: frame.snapshot.owners.headBody,
    },
    speaking: Boolean(frame.speech?.active),
    singing,
    musicPlaying,
    ...(musicPlaying
      ? { music: { energy: musicEnergy(spectrum), beat: beatPhase(spectrum) } }
      : {}),
    capabilities: facts.capabilities,
    recentIntents: facts.recentIntents,
    motionStyle: facts.motionStyle,
    pageVisible:
      typeof document === 'undefined' ? true : document.visibilityState !== 'hidden',
    faceVisible: facts.faceVisible,
  }
}

export function sanitizeRigStateSummary(value: unknown): RigStateSummary | null {
  if (!isRecord(value)) return null
  const acting = isRecord(value.acting) ? value.acting : {}
  const owners = isRecord(value.owners) ? value.owners : {}
  const music = isRecord(value.music) ? value.music : null
  const capabilities = Array.isArray(value.capabilities)
    ? value.capabilities
        .filter((item): item is string => typeof item === 'string')
        .filter((item) =>
          CAPABILITY_MAP.some(([, semantic]) => semantic === item || item === 'head-body'),
        )
        .slice(0, 12)
    : []
  const recentIntents = Array.isArray(value.recentIntents)
    ? value.recentIntents
        .filter((item): item is PerformanceCue['intent'] =>
          typeof item === 'string' && isCueIntent(item),
        )
        .slice(0, MAX_RECENT)
    : []
  return {
    expression: allowExpression(value.expression) ?? 'steady',
    posture: allowPosture(value.posture) ?? 'neutral',
    acting: {
      intent: isCueIntent(acting.intent) ? acting.intent : null,
      phase: PHASES.includes(acting.phase as PerformancePhase | 'idle')
        ? (acting.phase as PerformancePhase | 'idle')
        : 'idle',
      remainingMs: clampMs(acting.remainingMs),
    },
    owners: {
      mouth: String(owners.mouth ?? 'idle'),
      expression: String(owners.expression ?? 'idle'),
      gaze: String(owners.gaze ?? 'idle'),
      headBody: String(owners.headBody ?? 'idle'),
    },
    speaking: value.speaking === true,
    singing: value.singing === true,
    musicPlaying: value.musicPlaying === true,
    ...(music
      ? {
          music: {
            energy: allowEnergy(music.energy),
            beat: allowBeat(music.beat),
          },
        }
      : {}),
    capabilities,
    recentIntents,
    motionStyle:
      value.motionStyle === 'restrained' || value.motionStyle === 'open'
        ? value.motionStyle
        : 'even',
    pageVisible: value.pageVisible !== false,
    faceVisible: value.faceVisible !== false,
  }
}

function resolveActing(
  directive: PerformanceDirective | null,
  startedAtMs: number,
  nowMs: number,
): RigStateSummary['acting'] {
  if (!directive) {
    return { intent: null, phase: 'idle', remainingMs: 0 }
  }
  const scheduled = scheduleBodyCues(directive.plan.cues, startedAtMs)
  const active = scheduled.find(
    (item) => nowMs >= item.startMs && nowMs < item.endMs,
  )
  const lastEnd = scheduled.reduce(
    (until, item) => Math.max(until, item.endMs),
    startedAtMs,
  )
  const remainingMs = Math.max(0, Math.round(lastEnd - nowMs))
  const current =
    active?.cue ??
    scheduled.find((item) => !cueOccupiesHeadBody(item.cue))?.cue ??
    null
  return {
    intent: current?.intent ?? null,
    phase: PHASES.includes(directive.phase) ? directive.phase : 'idle',
    remainingMs,
  }
}

function musicEnergy(spectrum: SingingSpectrumDrive | null): RigMusicEnergy {
  const amount = Math.max(spectrum?.vocal ?? 0, spectrum?.beat ?? 0)
  if (amount >= 0.6) return 'strong'
  if (amount >= 0.3) return 'present'
  if (amount >= 0.12) return 'soft'
  return 'quiet'
}

function beatPhase(spectrum: SingingSpectrumDrive | null): RigBeatPhase {
  if (!spectrum || spectrum.beat < 0.08) return 'rest'
  if (spectrum.beat >= 0.55) return 'downbeat'
  if (spectrum.vocal >= 0.4) return 'pulse'
  return 'hold'
}

function allowExpression(
  value: unknown,
): PerformanceBaseline['expression'] | null {
  return EXPRESSIONS.includes(value as PerformanceBaseline['expression'])
    ? (value as PerformanceBaseline['expression'])
    : null
}

function allowPosture(value: unknown): PerformanceBaseline['posture'] | null {
  return POSTURES.includes(value as PerformanceBaseline['posture'])
    ? (value as PerformanceBaseline['posture'])
    : null
}

function isCueIntent(value: unknown): value is PerformanceCue['intent'] {
  return (
    typeof value === 'string' &&
    [
      'greet',
      'respond',
      'question',
      'delight',
      'emphasize',
      'listen',
      'notify',
      'think',
      'dizzy',
      'cry',
      'angry',
      'speechless',
      'maniac',
      'silly',
      'lovestruck',
    ].includes(value)
  )
}

function allowEnergy(value: unknown): RigMusicEnergy {
  return value === 'soft' || value === 'present' || value === 'strong'
    ? value
    : 'quiet'
}

function allowBeat(value: unknown): RigBeatPhase {
  return value === 'downbeat' || value === 'pulse' || value === 'hold'
    ? value
    : 'rest'
}

function clampMs(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(12_000, Math.round(value)))
    : 0
}

function currentNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
