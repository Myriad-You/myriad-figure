import type {
  RigBehaviorFunction,
  RigBehaviorPhase,
} from '../../../services/agent/types'
import type { BehaviorResource } from './behaviorResources'
import type { MotionChannel, MotionSourceId } from './channels'

/**
 * The temporal shape of a behavior, independent of the renderer that realizes
 * it. Different shapes have different cancellation and retiming rules; a
 * tracking gaze is not a long animation clip, and secondary physics is not an
 * authored gesture.
 */
export type BehaviorKind =
  'oneShot' | 'state' | 'rhythmic' | 'tracking' | 'secondary'

export type BehaviorFunction = RigBehaviorFunction
export type BehaviorPhase = RigBehaviorPhase

/** A semantic clock point. Several behaviors may share the same peg. */
export interface TimePeg {
  id: string
  atMs: number
  revision: number
  /** Confidence of a predicted external event, when this is an anticipator peg. */
  confidence?: number
}

/**
 * Five monotonic boundaries. `end` may be absent for a sustained behavior;
 * interruption then creates a recovery and end peg.
 */
export interface BehaviorTiming {
  start: string
  stroke: string
  hold: string
  relax: string | null
  end: string | null
}

/** Renderer-neutral choice made by a planner and resolved by a body adapter. */
export interface BehaviorForm {
  family: string
  id: string
  parameters?: Readonly<Record<string, string | number | boolean>>
}

export interface ScheduledBehavior {
  id: string
  function: BehaviorFunction
  kind: BehaviorKind
  source: MotionSourceId
  /** Fine-grained body-semantic resources used by new planners/adapters. */
  resources: readonly BehaviorResource[]
  /** Coarse compatibility projection for the current ownership coordinator. */
  channels: readonly MotionChannel[]
  timing: BehaviorTiming
  /** Mutable future event used by rhythmic/tracking behavior after commitment. */
  anticipation?: string
  form: BehaviorForm
  intensity: number
}

export interface BehaviorPlan {
  id: string
  /** Wall-clock origin shared by planners, schedulers and body adapters. */
  originMs: number
  metadata?: Readonly<Record<string, string | number | boolean>>
  pegs: readonly TimePeg[]
  behaviors: readonly ScheduledBehavior[]
}

export interface BehaviorRealizerReport {
  behaviorId: string
  result: 'accepted' | 'rejected'
  atMs: number
  reason?: 'unsupported-form' | 'invalid-timing' | 'superseded'
}

export interface BehaviorSnapshot {
  id: string
  function: BehaviorFunction
  kind: BehaviorKind
  source: MotionSourceId
  resources: readonly BehaviorResource[]
  channels: readonly MotionChannel[]
  form: BehaviorForm
  phase: BehaviorPhase
  startedAtMs: number
  strokeAtMs: number
  relaxAtMs: number | null
  endsAtMs: number | null
  remainingMs: number | null
  /** Next predicted external event; absent for behaviors without an anticipator. */
  anticipatedAtMs?: number
  anticipationConfidence?: number
}

export type BehaviorFeedbackType =
  'scheduled' | 'phase' | 'retimed' | 'interrupted' | 'accepted' | 'rejected'

export interface BehaviorFeedback {
  type: BehaviorFeedbackType
  behaviorId: string
  atMs: number
  phase: BehaviorPhase
  from?: BehaviorPhase
  pegId?: string
  reason?: BehaviorRealizerReport['reason']
}
