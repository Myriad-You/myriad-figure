/** One drawn frame, for the page's frame-time trace. */
export interface FigureFrameSample {
  dropped: boolean
  cpuMs?: number
}

/** Reasons the figure drops a motion the page sent it. */
export type FigureTraceDrop = 'stale_generation' | 'foreign_speech_frame'

/**
 * Where the figure reports what it did with a turn, for the page's own trace.
 * Whoever builds a player, coordinator or runtime hands it one; without one
 * the figure keeps that to itself.
 */
export interface FigureTrace {
  mark: (span: string, extra?: Record<string, string | number | boolean>) => void
  drop: (reason: FigureTraceDrop) => void
  leaseExpiry: (count: number) => void
  frame: (sample: FigureFrameSample) => void
}

export const NO_TRACE: FigureTrace = {
  mark: () => {},
  drop: () => {},
  leaseExpiry: () => {},
  frame: () => {},
}
