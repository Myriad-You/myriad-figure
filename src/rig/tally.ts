/**
 * Votes by key, read back in the order the keys were first voted for (so a tie can go to the first, as with a Map
 * counted a vote at a time). A run of votes for one key is counted up and entered at its end: counting the layers
 * under a region's pixels, most of a region is one layer's.
 */
export function tally<K>(): { vote: (key: K) => void; counts: () => Map<K, number> } {
  const votes = new Map<K, number>()
  let running: K | undefined
  let run = 0
  const enter = () => {
    if (run > 0) votes.set(running as K, (votes.get(running as K) ?? 0) + run)
    run = 0
  }
  return {
    vote(key) {
      if (run > 0 && key !== running) enter()
      running = key
      run += 1
    },
    counts() {
      enter()
      return votes
    },
  }
}
