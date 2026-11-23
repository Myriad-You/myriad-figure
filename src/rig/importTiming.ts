/**
 * Where an import's time goes, for measuring it: off unless asked for, and
 * then only a clock read between steps. Nothing the import makes depends on it.
 *
 * The steps run one after another on one thread, so one running clock serves:
 * `lap(name)` gives the time since the lap before it to `name`. Laps of one
 * name add up (a step run once per gesture arm is one line of the table).
 */
export type ImportLap = readonly [name: string, ms: number]

let laps: Array<[string, number]> | null = null
let last = 0

/** Starts the clock; the import's laps are read with `importLaps` once it is done. */
export function startImportTiming(): void {
  laps = []
  last = performance.now()
}

/** The time since the last lap (or the start) went to `name`. */
export function lap(name: string): void {
  if (!laps) return
  const now = performance.now()
  laps.push([name, now - last])
  last = now
}

/** The laps so far, and the clock off again. Null when it was never started. */
export function importLaps(): ImportLap[] | null {
  const done = laps
  laps = null
  return done
}
