/**
 * A standing figure's turn, taken in turn. Asked to face another way, a body
 * does not go round all at once like a figure on a turntable: its chest and
 * shoulders lead, the hips come round on the legs after them, the arms swing
 * round after the shoulders they hang from, and a skirt's hem comes last,
 * past where its hips have stopped, and back. Each comes on a soft spring
 * (Hz, damping ratio) after what carries it. Held as one piece, a figure was
 * at every moment a finished drawing of some angle: a pose changed, not a
 * body moved.
 *
 * Only a turn it is directed to make is taken so. The turn a figure makes of
 * itself, with its sway and after its look, is slow and has its own spring
 * (torsoDeformation); it goes round whole, as it did.
 */
const HIPS_FOLLOW = { frequency: 2, damping: 0.5 } as const
const ARMS_FOLLOW = { frequency: 1.35, damping: 0.36 } as const
const HEM_FOLLOW = { frequency: 1.45, damping: 0.3 } as const
/** The springs' longest integration step: frames are split so every frame rate moves alike. */
const FOLLOW_STEP = 1 / 240
/** A turn this small (radians), or a spring this near its rest with nothing asked, is none. */
const FOLLOW_REST = 1e-5
/** A skirt's hem is this share of the legs' length below the hips: down to there what hangs from them comes later and later. */
const HEM_BELOW = 0.3

interface Spring { value: number; velocity: number }

export class FigureTurn {
  private readonly hips: Spring = { value: 0, velocity: 0 }
  private readonly arms: Spring = { value: 0, velocity: 0 }
  private readonly hem: Spring = { value: 0, velocity: 0 }
  private asked = 0
  private loose = false
  /** How far behind the chest's turn the hips, the hands and a hem at HEM_BELOW are this frame, radians (ahead of it, past its end). */
  private hipsLag = 0
  private armsLag = 0
  private hemLag = 0

  constructor(
    /** Where the chest is at its fullest, the hips, and how long the legs are: canvas y. */
    private readonly chestY: number,
    private readonly hipsY: number,
    private readonly legSpan: number,
  ) {}

  /** Some part of it is not where the chest's turn has it. */
  get active(): boolean {
    return this.hipsLag !== 0 || this.armsLag !== 0 || this.hemLag !== 0
  }

  /** How fast the hips are coming round, radians a second: the knees give under them (figurePitch). */
  get hipsSpeed(): number {
    return this.loose ? this.hips.velocity : 0
  }

  /** Poses it for a directed turn of `asked` radians (the chest's, which leads). */
  step(asked: number): void {
    this.asked = Number.isFinite(asked) && Math.abs(asked) >= FOLLOW_REST ? asked : 0
    this.hipsLag = this.loose ? this.hips.value - this.asked : 0
    this.armsLag = this.loose ? this.arms.value - this.asked : 0
    this.hemLag = this.loose ? this.hem.value - this.asked : 0
  }

  /**
   * Lets the hips, the arms and the hem come after the turn last asked: once each step of the physics. Not
   * `dynamic` (physics off), they are held where it is asked.
   */
  follow(dt: number, dynamic: boolean): void {
    const springs = [this.hips, this.arms, this.hem] as const
    if (!dynamic || !(dt > 0) || !this.loose) {
      for (const spring of springs) { spring.value = this.asked; spring.velocity = 0 }
      this.loose = dynamic && dt > 0
      return
    }
    const steps = Math.ceil(dt / FOLLOW_STEP - 1e-9)
    const h = dt / steps
    for (let i = 0; i < steps; i += 1) {
      chase(this.hips, this.asked, HIPS_FOLLOW, h)
      chase(this.arms, this.asked, ARMS_FOLLOW, h)
      chase(this.hem, this.hips.value, HEM_FOLLOW, h)
    }
    if (springs.every((spring) => Math.abs(spring.value - this.asked) < FOLLOW_REST && Math.abs(spring.velocity) < FOLLOW_REST)) {
      for (const spring of springs) { spring.value = this.asked; spring.velocity = 0 }
    }
  }

  /**
   * How far behind the chest's turn a point of the trunk drawn at height `restY` is, radians: none down to
   * the chest, the hips' by the hips, and on toward the hem's below them.
   */
  trunkLag(restY: number): number {
    if (restY <= this.chestY) return 0
    if (restY <= this.hipsY) return this.hipsLag * smoothstep((restY - this.chestY) / Math.max(1, this.hipsY - this.chestY))
    return this.hipsLag + (this.hemLag - this.hipsLag) * smoothstep((restY - this.hipsY) / Math.max(1, this.legSpan * HEM_BELOW))
  }

  /** The same for a leg or a shoe, which stands under the hips. */
  get legLag(): number {
    return this.hipsLag
  }

  /** The same for a point of an arm: none at the shoulder (`shoulderY`), the arms' by the hand, hanging by the hips. */
  armLag(restY: number, shoulderY: number): number {
    return this.armsLag * smoothstep((restY - shoulderY) / Math.max(1, this.hipsY - shoulderY))
  }
}

/** A turn's rotation, `lag` radians further round (to the second order: a lag is a fraction of a radian). */
export function laggedTurn(
  rotation: Readonly<{ yawSine: number; yawCosine: number }>,
  lag: number,
  out: { active: boolean; yawSine: number; yawCosine: number },
): typeof out {
  const sine = lag - (lag * lag * lag) / 6
  const cosine = 1 - (lag * lag) / 2
  out.active = true
  out.yawSine = rotation.yawSine * cosine + rotation.yawCosine * sine
  out.yawCosine = rotation.yawCosine * cosine - rotation.yawSine * sine
  return out
}

function chase(spring: Spring, goal: number, tuning: Readonly<{ frequency: number; damping: number }>, h: number): void {
  const omega = 2 * Math.PI * tuning.frequency
  spring.velocity += (-omega * omega * (spring.value - goal) - 2 * tuning.damping * omega * spring.velocity) * h
  spring.value += spring.velocity * h
}

function smoothstep(value: number): number {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}
