// What every part of the figure shares with the page: the channel the page
// directs a live figure on, the trace it lends, and the errors it translates.
// The public surface of the package root; the directories have their own.

export { FigureChannel } from './channel'
export type { FigureErrorCode, FigureErrorParams } from './errors'
export { FIGURE_ERROR_TEXT, FigureError, isFigureErrorCode } from './errors'
export type { FigureFrameSample, FigureTrace, FigureTraceDrop } from './trace'
export { NO_TRACE } from './trace'
