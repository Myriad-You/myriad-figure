import type { Anime25DDriver } from './driver'

/**
 * Head and body carry weight. Every source (cues, co-speech, the score, face
 * shifts, hand-offs between them) writes the composed pose; this last stage
 * lets the head and torso follow it through a critically damped spring with
 * a speed cap, so no source and no hand-off can jerk them faster than a body
 * moves. Without it a cue reached a 20° tilt in about 0.15 s (over 200°/s).
 *
 * The composition keeps following its own pose, not the carried one: fed the
 * carried pose back, its spring restarted every frame from a lagging point, so
 * how far a movement got depended on the frame rate (a head turn 0.1 s in:
 * 0.48 of the way at 30 fps, 0.13 at 120). `release` hands it back.
 */

/** Natural frequency, rad/s: settles a step in about a fifth of a second. */
const STIFFNESS = 24

/** The longest integration step: frames are split so every frame rate moves alike. */
const MAX_STEP = 1 / 240

/** Speed caps in driver units per second (head angles: 1 unit is 30°). */
const SPEED_CAPS = {
  angleX: 8.5,
  angleY: 7,
  angleZ: 6,
  body: 5,
  torsoTurn: 5,
  bodyLift: 5,
} as const satisfies Partial<Record<keyof Anime25DDriver, number>>

type CarriedKey = keyof typeof SPEED_CAPS
const CARRIED = Object.keys(SPEED_CAPS) as CarriedKey[]

export class Anime25DPoseInertia {
  private readonly position = new Map<CarriedKey, number>()
  private readonly velocity = new Map<CarriedKey, number>()
  private readonly composed = new Map<CarriedKey, number>()

  /** Puts back the composed pose last carried, for the composition to continue from. */
  release(pose: Anime25DDriver): void {
    for (const [key, value] of this.composed) pose[key] = value
  }

  /** Replaces the carried channels of `pose` with where the body has got to. */
  step(pose: Anime25DDriver, dt: number): void {
    if (!(dt > 0)) return
    const steps = Math.ceil(dt / MAX_STEP - 1e-9)
    const h = dt / steps
    for (const key of CARRIED) {
      const target = pose[key]
      this.composed.set(key, target)
      let at = this.position.get(key)
      if (at === undefined) {
        this.position.set(key, target)
        this.velocity.set(key, 0)
        continue
      }
      let v = this.velocity.get(key)!
      const cap = SPEED_CAPS[key]
      for (let i = 0; i < steps; i++) {
        const accel = STIFFNESS * STIFFNESS * (target - at) - 2 * STIFFNESS * v
        v = Math.max(-cap, Math.min(cap, v + accel * h))
        at += v * h
      }
      this.velocity.set(key, v)
      this.position.set(key, at)
      pose[key] = at
    }
  }
}
