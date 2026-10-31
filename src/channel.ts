import type { MeropeStateEventDetail } from './events/meropeAffectState'
import type { FigureTrace } from './trace'
import { NO_TRACE } from './trace'

/**
 * The page's line to a live figure. The page dispatches performances, speech,
 * her state and their typing on it; the figure's motion sources listen on it.
 * It also knows which turn is live, her last state, and where the figure
 * reports what it did with a turn. The page keeps one for the figure it hosts
 * and hands it to that figure's runtime; a runtime given none has its own,
 * which nothing outside it can reach.
 */
export class FigureChannel extends EventTarget {
  private live = 0
  private intentSeq = 0
  private state: MeropeStateEventDetail | null = null

  constructor(readonly trace: FigureTrace = NO_TRACE) {
    super()
  }

  setGeneration(generation: number): void {
    this.live = Math.max(0, Math.trunc(generation))
  }

  generation(): number {
    return this.live
  }

  /** Unstamped events belong to whatever turn is live. */
  isLive(generation: number | undefined): boolean {
    if (generation == null || generation <= 0) return true
    return generation === this.live
  }

  /** Like isLive, and records the drop when it is not. */
  acceptLive(generation: number | undefined): boolean {
    if (this.isLive(generation)) return true
    this.trace.drop('stale_generation')
    return false
  }

  newIntentId(): string {
    this.intentSeq += 1
    return `motion-${this.live}-${this.intentSeq}`
  }

  /** Her last state dispatched on this channel. */
  currentState(): MeropeStateEventDetail | null {
    return this.state
  }

  resetState(): void {
    this.state = null
  }

  /** Only events/performanceEvents writes it, as it dispatches the state. */
  writeState(detail: MeropeStateEventDetail): void {
    this.state = detail
  }
}
