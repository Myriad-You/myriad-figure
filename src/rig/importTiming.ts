/**
 * Where an import's time goes, for measuring it. The worker makes a timer only for a request that asks for one
 * and hands it down to the steps; without one every `timer?.lap(…)` on the way is a check that it is not there.
 * Nothing the import makes depends on it.
 *
 * The steps run one after another on one thread, so one running clock serves: `lap(name)` gives the time since
 * the lap before it to `name`. Laps of one name add up (a step run once per gesture arm is one line of the table).
 */
export type ImportLap = readonly [name: string, ms: number]

export class ImportTimer {
  private readonly taken: Array<[string, number]> = []
  private last = performance.now()

  /** The time since the last lap (or since the timer was made) went to `name`. */
  lap(name: string): void {
    const now = performance.now()
    this.taken.push([name, now - this.last])
    this.last = now
  }

  /** The laps so far, in the order they ended. */
  laps(): ImportLap[] {
    return this.taken
  }
}
