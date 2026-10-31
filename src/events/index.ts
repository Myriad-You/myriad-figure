// Performance events a page dispatches to the figure, and the performance contract.
// The public surface of this directory; everything else in it is internal.

export { FACE_PRESETS, PLAIN_FACE, SCORE_MOVES, tierExtent } from './performanceContract'
export type { MeropePerformanceEventDetail, MeropeStateEventDetail } from './performanceEvents'
export { dispatchMeropeListening, dispatchMeropePerformance, dispatchMeropeState, MEROPE_STATE_EVENT, meropePerformanceEventDetail, meropeStateEventDetail, resetMeropeState, resolveLoadedMeropeAffect, sanitizePerformanceDirective } from './performanceEvents'
