export type CompanionActivity = 'idle' | 'thinking' | 'talking'
export type AutonomyFrequency = 'low' | 'normal' | 'high'
export type CompanionGender =
  | 'female'
  | 'male'
  | 'nonbinary'
  | 'unspecified'
export interface CompanionOnboarding {
  schemaVersion: number
  step: number
  completed: boolean
  selectedTags?: string[]
  gender?: CompanionGender
  displayName?: string
  reportSignalFingerprint?: string
}

export interface CompanionRuntime {
  energy: number
  mood: number
  boredom: number
  curiosity: number
  social: number
  affection: number
  activity: CompanionActivity
  thought: string | null
  thoughtAt: string | null
  lastUserSeenAt: string | null
  lastChatIdleAt: string | null
  updatedAt: string
}

export interface CompanionPolicy {
  enabled: boolean
  doNotDisturb: boolean
  showThought: boolean
  autonomyFrequency: AutonomyFrequency
  maxProactiveSpeaksPerDay: number
  minSpeakIntervalMinutes: number
  minDeliberateIntervalMinutes: number
  collapsedByDefault: boolean
}

export interface CompanionCharacter {
  id: string
  name: string
  status: string
  persona: Record<string, unknown>
  dna: Record<string, unknown>
  visual: {
    masterAssetId?: string | null
    masterUrl?: string | null
    rigUpdatedAt?: string | null
    placeholder?: boolean
    expressions?: Record<string, string>
  }
  onboarding: CompanionOnboarding
  createdAt: string
  updatedAt: string
}

export interface CompanionSnapshot {
  character: CompanionCharacter
  runtime: CompanionRuntime
  policy: CompanionPolicy
  unreadProactiveCount: number
  fingerprint: string
}

export interface CompanionStatus {
  enabled: boolean
  workerEnabled: boolean
  tickSeconds: number
  hasCharacter: boolean
}

export interface CompanionReportSignals {
  reportCount: number
  platforms: string[]
  fingerprint: string
  tags: string[]
  aiDistilled: boolean
  model: string | null
  rawReportsStored: false
}

export interface CompanionPersonaSuggestion {
  persona: Record<string, unknown>
  model: string | null
  tier: 'pro' | 'fallback'
}

export interface CompanionMessage {
  id: number
  role: 'user' | 'assistant' | 'system' | 'proactive'
  content: string
  meta: Record<string, unknown>
  createdAt: string
}

export interface CompanionMemory {
  id: string
  content: string
  importance: number
  createdAt: string
  lastAccessedAt: string | null
}

export type CompanionPolicyPatch = Partial<CompanionPolicy>
