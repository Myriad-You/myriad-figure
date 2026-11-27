// Performance events a page dispatches to the figure, and the performance contract.
// The public surface of this directory; everything else in it is internal.

export type { MeropePerformanceEventDetail } from './performanceEvents'
export { dispatchMeropeListening, dispatchMeropePerformance, dispatchMeropeState, MEROPE_STATE_EVENT, meropePerformanceEventDetail, resolveLoadedMeropeAffect } from './performanceEvents'
export type { MeropeStateEventDetail } from '@myriad-you/figure-player/contract'
export { meropeStateEventDetail, sanitizePerformanceDirective } from '@myriad-you/figure-player/contract'
