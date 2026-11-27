// Performance events a page dispatches to the figure, and the performance contract.
// The public surface of this directory; everything else in it is internal.

export { dispatchMeropeListening, dispatchMeropePerformance, dispatchMeropeState, MEROPE_STATE_EVENT, resolveLoadedMeropeAffect } from './performanceEvents'
export type { MeropePerformanceEventDetail, MeropeStateEventDetail } from '@myriad-you/figure-player/contract'
export { meropePerformanceEventDetail, meropeStateEventDetail, sanitizePerformanceDirective } from '@myriad-you/figure-player/contract'
