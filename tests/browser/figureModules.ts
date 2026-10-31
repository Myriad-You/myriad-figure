import { fileURLToPath } from 'node:url'

/** The /@fs URL of anime25drig/, for probes that drive the player's modules directly. */
export const FIGURE_RUNTIME_MODULES = `/@fs${fileURLToPath(new URL('../../src/anime25drig/', import.meta.url))}`
