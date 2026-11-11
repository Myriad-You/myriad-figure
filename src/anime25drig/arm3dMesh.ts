import type { V3 } from './arm3dMath'
import type { Arm3DPose, Arm3DShape } from './arm3dMotion'
import { add, catmull, cross, dot, HAND_CHAINS, len, lerp, mul, norm, smoothstep, sub } from './arm3dMath'

/** Rings along the sleeve (half to the upper arm, half to the forearm) and texels round it. */
export const ARM3D_RINGS = 56
export const ARM3D_AROUND = 36
/** A wrist's half-width against the hand's length (wrist to the middle knuckle). */
const WRIST = 0.24

export interface Arm3DMesh {
  pos: number[]
  nrm: number[]
  uv: number[]
  idx: number[]
  /** Hand only: 0 off the fingers, else how far along its finger (knuckle 0, tip 1). */
  along?: number[]
  /** Hand only: how much of the rounded fingertip this vertex is (its texture fades there). */
  tip?: number[]
  /** Hand only: which finger (thumb 0) or the palm (5). */
  part?: number[]
  /** Hand only: how squarely its stretch of finger points at the viewer. */
  face?: number[]
  /** Sleeve only: where in `idx` what it gains past a bent elbow starts. */
  gained?: number
  /** Where its two tubes' triangles start in idx: after a standing figure's shoulder cap. */
  tubes?: number
}

function emptyMesh(): Arm3DMesh {
  return { pos: [], nrm: [], uv: [], idx: [] }
}

/** A tube through `points`; its v per ring, u round it. A round tip at the end if `closeEnd`, its v by how far round the tip (`tipV`) or the last ring's. */
function tube(mesh: Arm3DMesh, points: V3[], radii: number[], vs: number[], around: number, closeEnd = false, tipV?: (turned: number) => number): void {
  const base = mesh.pos.length / 3
  let prevSide: V3 | null = null
  const frame = (d: V3): [V3, V3] => {
    let front = sub([0, 0, 1], mul(d, d[2]))
    if (len(front) < 0.2 && prevSide) front = cross(prevSide, d)
    front = norm(front)
    return [front, norm(cross(d, front))]
  }
  for (let i = 0; i < points.length; i += 1) {
    const d = norm(sub(points[Math.min(points.length - 1, i + 1)], points[Math.max(0, i - 1)]))
    const [front, side] = frame(d)
    prevSide = side
    for (let j = 0; j <= around; j += 1) {
      const th = (j / around) * Math.PI * 2
      const n = add(mul(front, Math.cos(th)), mul(side, Math.sin(th)))
      mesh.pos.push(...add(points[i], mul(n, radii[i])))
      mesh.nrm.push(...n)
      mesh.uv.push(j / around, vs[i])
    }
  }
  for (let i = 0; i < points.length - 1; i += 1) {
    for (let j = 0; j < around; j += 1) {
      const a = base + i * (around + 1) + j
      const b = a + around + 1
      mesh.idx.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
  if (!closeEnd) return
  // A round tip: rings shrinking along a quarter circle. A flat or pointed end reads as a cut or a claw.
  const end = points[points.length - 1]
  const d = norm(sub(end, points[points.length - 2]))
  const r = radii[radii.length - 1]
  const [front, side] = frame(d)
  let ring = base + (points.length - 1) * (around + 1)
  const CAP = 4
  for (let k = 1; k <= CAP; k += 1) {
    const a = (k / CAP) * Math.PI / 2
    const next = mesh.pos.length / 3
    for (let j = 0; j <= around; j += 1) {
      const th = (j / around) * Math.PI * 2
      const radial = add(mul(front, Math.cos(th)), mul(side, Math.sin(th)))
      mesh.pos.push(...add(end, add(mul(radial, r * Math.cos(a)), mul(d, r * Math.sin(a)))))
      mesh.nrm.push(...norm(add(mul(radial, Math.cos(a)), mul(d, Math.sin(a)))))
      mesh.uv.push(j / around, tipV ? tipV(a) : vs[vs.length - 1])
    }
    for (let j = 0; j < around; j += 1) {
      const a0 = ring + j
      const b0 = next + j
      mesh.idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1)
    }
    ring = next
  }
}

/** How much of a short sleeve's drawn width past the arm's own it has round the raised upper arm. */
const SHORT_SLEEVE_FLARE = 0.6

/** The sleeve's radius at v (shoulder 0, elbow 0.5, cuff 1), between the measured places; gathered at the cuff. */
function sleeveRadius(d: Arm3DShape, v: number): number {
  const R = d.radius
  const x = Math.max(0, Math.min(1, v)) * (R.length - 1)
  const i = Math.min(R.length - 2, Math.floor(x))
  // A sleeve measured where it hangs has its end as drawn there (a turned-back cuff is widest at its end).
  return (R[i] + (R[i + 1] - R[i]) * (x - i)) * (d.restCuff === undefined && d.restFore === undefined ? 1 - 0.32 * Math.max(0, (v - 0.94) / 0.06) : 1)
}

/** Where the sleeve ends along the forearm (elbow 0, wrist 1): hanging (`rest` 1), where the portrait draws it end. */
function sleeveEnd(d: Arm3DShape, rest: number): number {
  // A standing figure's forearm drawn bare is its own skin to the wrist, and what it wears round the wrist with it
  // (a wristband read as a cuff's end left the wrist past it a plain block).
  if (d.restCuff === undefined) return d.restFore === undefined ? d.cuff : 1
  return d.cuff + (d.restCuff - d.cuff) * rest
}

/**
 * The sleeve's row (0 the elbow, 1 its end) a share `s` of the way down a forearm's sleeve `length` long: the
 * cuff keeps the length it was drawn hanging (to half the sleeve), the plain sleeve above it takes the rest. A
 * forearm shorter raised than hanging squeezed evenly had its cuff a thin band; hanging, even as drawn.
 */
function forearmRow(d: Arm3DShape, s: number, length: number): number {
  if (d.restCuff === undefined || d.cuffFrom === undefined || d.restFore === undefined) return s
  const vc = d.cuffFrom / d.restCuff
  const plain = Math.max(length - (d.restCuff - d.cuffFrom) * d.restFore, 0.5 * length)
  const x = s * length
  return x <= plain ? x / Math.max(1e-6, plain) * vc : vc + (x - plain) / Math.max(1e-6, length - plain) * (1 - vc)
}

/** Hanging, each point out (or in) across the bone to where the drawn arm reaches on its side. */
function reachOut(d: Arm3DShape, m: Arm3DMesh, from: number, to: number, centre: (i: number) => V3, r: (i: number) => number, at: (i: number) => number, axis: V3, rest: number): void {
  const RR = d.restReach
  const d2 = norm([axis[0], axis[1], 0])
  const n2: V3 = [-d2[1], d2[0], 0]
  for (let i = from; i < to; i += 1) {
    const x = at(i) * (RR.length - 1)
    const k = Math.min(RR.length - 2, Math.floor(x))
    const lo = RR[k]
    const hi = RR[k + 1]
    if (!lo || !hi) continue
    const q = i * 3
    const c0 = centre(i)
    const c = (m.pos[q] - c0[0]) * n2[0] + (m.pos[q + 1] - c0[1]) * n2[1]
    const side = c >= 0 ? 0 : 1
    const reach = lo[side] + (hi[side] - lo[side]) * (x - k)
    const nc = c * (1 + rest * (reach / Math.max(1e-6, r(i)) - 1))
    m.pos[q] += n2[0] * (nc - c)
    m.pos[q + 1] += n2[1] * (nc - c)
  }
}

/** A shoulder cap's rows are marked by this v (the sleeve's own run from 0). */
export const ARM3D_CAP_V = -1
/** How far round the shoulder joint the cap reaches, in the sleeve's radius there. */
const CAP_REACH = 1.6

/** How far a standing figure's shoulder cap reaches from the joint. */
export function arm3DCapReach(d: Arm3DShape): number {
  return CAP_REACH * sleeveRadius(d, 0)
}

/**
 * Whether what a picture (RGBA, the arm layer where the portrait shows it) draws about a shoulder at (cx, cy) is
 * a shoulder: it ends within `reach`. Something larger worn there (a pauldron drawn into the arm's layer) runs on
 * past the cap's rim: capped, a cut piece of it stood still above the arm that carries the rest.
 */
export function arm3DShoulderIsBare(pixels: Uint8ClampedArray, width: number, height: number, cx: number, cy: number, reach: number): boolean {
  let rim = 0
  let drawn = 0
  for (let y = Math.max(0, Math.floor(cy - reach)); y < Math.min(height, cy); y += 1) {
    for (let x = Math.max(0, Math.floor(cx - reach)); x < Math.min(width, cx + reach); x += 1) {
      const r = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      if (r < 0.8 * reach || r > reach) continue
      rim += 1
      if (pixels[(y * width + x) * 4 + 3] >= 128) drawn += 1
    }
  }
  return rim === 0 || drawn < 0.15 * rim
}
const CAP_RINGS = 8

/**
 * A standing figure's shoulder above its arm: the portrait draws the round of the shoulder with the arm, and the
 * modelled arm starts at the joint (without it the shoulder ended flat across, a box's corner beside the body).
 * A flat round of the picture about the joint, staying with the shoulder whatever the arm does: all of it above
 * the joint, and below it a ball as wide as the arm (cut straight across under the joint, an arm turned in across
 * the chest left a step in the shoulder's outline where the cap stopped). Its u is how much of it shows.
 */
function shoulderCap(d: Arm3DShape, m: Arm3DMesh, s: V3): void {
  const reach = arm3DCapReach(d)
  const ball = sleeveRadius(d, 0)
  const base = m.pos.length / 3
  for (let i = 0; i <= CAP_RINGS; i += 1) {
    const r = reach * (i / CAP_RINGS)
    for (let j = 0; j <= ARM3D_AROUND; j += 1) {
      const th = (j / ARM3D_AROUND) * Math.PI * 2
      const x = Math.cos(th) * r
      const y = Math.sin(th) * r
      m.pos.push(s[0] + x, s[1] + y, s[2])
      m.nrm.push(0, 0, 1)
      // Below the joint its rim draws in to the arm's own width: the ball the arm turns about.
      const rim = reach + (ball - reach) * smoothstep(0, 0.85, r < 1e-9 ? 0 : Math.max(0, y) / r)
      m.uv.push(1 - smoothstep(0.8 * rim, rim, r), ARM3D_CAP_V)
    }
  }
  for (let i = 0; i < CAP_RINGS; i += 1) {
    for (let j = 0; j < ARM3D_AROUND; j += 1) {
      const a = base + i * (ARM3D_AROUND + 1) + j
      const b = a + ARM3D_AROUND + 1
      m.idx.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
}

/**
 * The sleeve: upper arm and forearm each straight, the elbow the sleeve's ring
 * turned round the bend (hanging, a ball as wide as the sleeve there), the
 * cuff's end face. `rest` (1 hanging) draws its outline to where
 * the portrait's arm reaches; `px` is a trial pixel on this canvas.
 */
export function arm3DSleeveMesh(d: Arm3DShape, p: Arm3DPose, rest: number, px: number): Arm3DMesh {
  const m = emptyMesh()
  const half = ARM3D_RINGS / 2
  if (d.restFore !== undefined) shoulderCap(d, m, p.s)
  m.tubes = m.idx.length
  const sleeved = len(sub(p.w, p.e)) * sleeveEnd(d, rest)
  // Under a short sleeve the elbow of the arm raised is skin: the rows past the sleeve's end, not the sleeve's own.
  const bareRow = d.shortSleeve === undefined ? null : arm3DBareElbowRow(d.shortSleeve)
  const worn = (v: number) => (bareRow === null ? v : bareRow + (v - bareRow) * rest)
  for (const [a, b, v0] of [[p.s, p.e, 0], [p.e, lerp(p.e, p.w, sleeveEnd(d, rest)), 0.5]] as const) {
    const pts: V3[] = []
    const radii: number[] = []
    const vs: number[] = []
    // A forearm bare from the elbow is the wrist's to draw from there: its stub of sleeve kept inside it.
    const tuck = v0 > 0 && arm3DBareFromElbow(d)
    for (let i = 0; i <= half; i += 1) {
      const v = v0 + (v0 > 0 ? forearmRow(d, i / half, sleeved) : i / half) * 0.5
      pts.push(lerp(a, b, i / half))
      // A short sleeve drawn wider than the arm in it is that wide round the raised upper arm (as narrow as the
      // arm, what is drawn on it stood squeezed along a thin tube); it closes on the arm at the elbow, where the arm's own surface goes on.
      const flare = v0 === 0 && d.shortSleeve !== undefined && d.drawnRadius
        ? SHORT_SLEEVE_FLARE * (1 - rest) * (1 - smoothstep(0.42, 0.5, v)) * Math.max(0, sleeveRadius({ ...d, radius: d.drawnRadius }, v) - sleeveRadius(d, v))
        : 0
      radii.push(sleeveRadius(d, v) * (tuck ? 1 - 0.45 * smoothstep(0.5, 0.56, v) : 1) + flare)
      // So the forearm's first of it, where the hem hung over it: the hem stays with the upper arm.
      vs.push(v0 > 0 && bareRow !== null && v < bareRow ? worn(v) : v)
    }
    const from = m.pos.length / 3
    tube(m, pts, radii, vs, ARM3D_AROUND)
    // Kept inside, out to the hanging drawing only once all but down: reached out all the way down, it stood out
    // of the forearm as it turned; not at all, the drawn sleeve's edge showed past it at rest.
    const reach = tuck ? rest ** 4 : rest
    if (reach > 0) {
      const ring = (i: number) => Math.floor((i - from) / (ARM3D_AROUND + 1))
      reachOut(d, m, from, m.pos.length / 3, (i) => pts[ring(i)], (i) => radii[ring(i)], (i) => vs[ring(i)], sub(b, a), reach)
    }
  }
  // A forearm drawn bare from the elbow has no cuff on it to show the end of: the sleeve's end there stood out as
  // a white lip across the skin.
  if (!arm3DBareFromElbow(d)) cuffFace(d, m, p, rest, sleeveRadius(d, 1), 1.6 * px)
  const du = norm(sub(p.e, p.s))
  const df = norm(sub(p.w, p.e))
  const axis = len(add(du, df)) > 1e-3 ? norm(add(du, df)) : du
  let front = sub([0, 0, 1], mul(axis, axis[2]))
  front = len(front) < 0.2 ? norm(cross(axis, [1, 0, 0])) : norm(front)
  const side = norm(cross(axis, front))
  // Hanging, no wider than the upper sleeve's end: a forearm drawn bunched and wide made a ball that, tilted
  // toward the viewer with the arm, stood up over the portrait's cuff.
  // A forearm bare from the elbow is the elbow's skin too: raised, the ball as narrow as the sleeve's stub, inside it
  // (as wide, it stood past the forearm's round end in the sleeve's colours, its outline across the skin).
  const tucked = arm3DBareFromElbow(d) ? 0.55 + 0.45 * rest ** 4 : 1
  const sleeveR = (sleeveRadius(d, 0.5) + rest * Math.min(0, sleeveRadius(d, 0.46) - sleeveRadius(d, 0.5))) * tucked
  // Under a short sleeve the raised elbow is the bare arm's: as wide as the forearm just past the sleeve's end.
  const r = bareRow === null ? sleeveR : sleeveR + (1 - rest) * Math.min(0, sleeveRadius(d, bareRow + 0.04) - sleeveR)
  // Hanging, the ball's v as far along the arm as each point of it lies (squeezed, it wore rows from nearer
  // the elbow than its place); bent, back to the elbow's own rows (spread, it showed the elbow's band as she waved).
  const vUp = 0.04 + rest * (0.5 * r / Math.max(1e-6, len(sub(p.e, p.s))) - 0.04)
  const vDown = d.restCuff === undefined
    ? 0.04 + rest * (0.5 * r / Math.max(1e-6, len(sub(p.w, p.e)) * d.cuff) - 0.04)
    : 0.04 + rest * (0.5 * forearmRow(d, Math.min(1, r / Math.max(1e-6, sleeved)), sleeved) - 0.04)
  const vPast = 0.5 * r / Math.max(1e-6, len(sub(p.e, p.s)))
  const ball = (c: V3, past = -1) => {
    const base = m.pos.length / 3
    const LAT = 12
    for (let i = 0; i <= LAT; i += 1) {
      const ph = -Math.PI / 2 + (i / LAT) * Math.PI
      for (let j = 0; j <= ARM3D_AROUND; j += 1) {
        const th = (j / ARM3D_AROUND) * Math.PI * 2
        const n = add(mul(add(mul(front, Math.cos(th)), mul(side, Math.sin(th))), Math.cos(ph)), mul(axis, Math.sin(ph)))
        m.pos.push(...add(c, mul(n, r)))
        m.nrm.push(...n)
        const own = Math.sin(ph) * (ph < 0 ? vUp : vDown)
        // The end past the elbow goes on from its tube, row for row along the upper arm (by its own poles, turned
        // from the tube's, its rows stepped where the two meet); hanging, its own rows as before.
        // No further up than the shoulder's fade reaches down (a very wide sleeve's end ran into it, its outline thinned).
        m.uv.push(j / ARM3D_AROUND, past < 0 ? 0.5 + own : worn(Math.max(0.28, 0.5 - past + rest * own - (1 - rest) * dot(n, du) * vPast)))
      }
    }
    for (let i = 0; i < LAT; i += 1) {
      for (let j = 0; j < ARM3D_AROUND; j += 1) {
        const a = base + i * (ARM3D_AROUND + 1) + j
        const b = a + ARM3D_AROUND + 1
        m.idx.push(a, b, a + 1, a + 1, b, b + 1)
      }
    }
  }
  const c = p.e
  const ballFrom = m.pos.length / 3
  // The elbow itself: the sleeve's ring turned about the hinge from the upper arm's way to the forearm's, its u
  // starting where the upper tube has it and ending where the forearm's does, turned evenly between. (As a ball
  // with its poles along the two ways' middle, a forearm folded back up the upper arm had that middle toward the
  // viewer: a pole in front, the elbow's rows drawn round it as a pale disc with stripes out from its centre.)
  {
    const SWEEP = 12
    let hinge = cross(du, df)
    if (len(hinge) < 1e-3) hinge = cross(du, Math.abs(du[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])
    hinge = norm(hinge)
    const across = cross(hinge, du)
    const angle = Math.acos(Math.min(1, Math.max(-1, dot(du, df))))
    // A tube's own front (toward the viewer, across its way), and a turn about an axis.
    const tubeFront = (d: V3): V3 => {
      const f = sub([0, 0, 1], mul(d, d[2]))
      return len(f) < 1e-6 ? norm(cross(d, [1, 0, 0])) : norm(f)
    }
    const turn = (v: V3, k: V3, t: number): V3 =>
      add(add(mul(v, Math.cos(t)), mul(cross(k, v), Math.sin(t))), mul(k, dot(k, v) * (1 - Math.cos(t))))
    // The first ring's front carried round the hinge, the rest of the way to the forearm's own front spread over
    // the rings: each ring's front found afresh from the viewer's way, a sweep passing near that way had two rings
    // next to each other half a turn apart, the strip between them twisted through the elbow. (Folded past a right
    // angle toward the viewer the two ends' fronts are near half a turn apart, and which way round the rings go
    // changes as the forearm crosses the plane of the upper arm and the viewer's way: the outline stays, the
    // elbow's rows change sides in that one step.)
    const front0 = tubeFront(du)
    const carried = turn(front0, hinge, angle)
    const wanted = tubeFront(df)
    const twist = Math.atan2(dot(cross(carried, wanted), df), dot(carried, wanted))
    const innerAt: boolean[] = []
    for (let i = 0; i <= SWEEP; i += 1) {
      const a = angle * (i / SWEEP)
      const way = norm(add(mul(du, Math.cos(a)), mul(across, Math.sin(a))))
      const ringFront = norm(turn(turn(front0, hinge, a), way, twist * (i / SWEEP)))
      const ringSide = norm(cross(way, ringFront))
      const outer = cross(way, hinge)
      const ph = -Math.PI / 2 + (i / SWEEP) * Math.PI
      const v = worn(0.5 + Math.sin(ph) * (ph < 0 ? vUp : vDown))
      for (let j = 0; j <= ARM3D_AROUND; j += 1) {
        const th = (j / ARM3D_AROUND) * Math.PI * 2
        const round = add(mul(ringFront, Math.cos(th)), mul(ringSide, Math.sin(th)))
        // Inside the bend the rings cross (the tubes are there already): each ring's inner half drawn in to the
        // hinge's end on its side (raised all the way none of it is drawn, see below); with it the strip beside
        // it that lies along the tubes' own surface (drawn over them it flickered against them).
        const inner = dot(round, outer) < 0.2
        const swept = inner ? mul(hinge, dot(round, hinge) < 0 ? -1 : 1) : round
        // Hanging it is the ball it was, point for point (its outline is drawn out to the portrait's arm from there).
        const onBall = add(mul(add(mul(front, Math.cos(th)), mul(side, Math.sin(th))), Math.cos(ph)), mul(axis, Math.sin(ph)))
        const mixed = lerp(swept, onBall, rest)
        const n = len(mixed) < 1e-3 ? onBall : norm(mixed)
        // Between the two, the inner half goes straight across inside the elbow, not round its surface in folds.
        m.pos.push(...add(c, mul(inner ? mixed : n, r)))
        m.nrm.push(...n)
        m.uv.push(j / ARM3D_AROUND, v)
        innerAt.push(inner)
      }
    }
    for (let i = 0; i < SWEEP; i += 1) {
      for (let j = 0; j < ARM3D_AROUND; j += 1) {
        const a = i * (ARM3D_AROUND + 1) + j
        const b = a + ARM3D_AROUND + 1
        // Raised, nothing drawn of the half drawn in: the slivers from the ring's edge to the hinge's end showed
        // their backs as dark strokes out from it.
        if (rest < 1e-3 && (innerAt[a] || innerAt[a + 1] || innerAt[b] || innerAt[b + 1])) continue
        m.idx.push(ballFrom + a, ballFrom + b, ballFrom + a + 1, ballFrom + a + 1, ballFrom + b, ballFrom + b + 1)
      }
    }
  }
  // Hanging, the elbow's ball takes the tubes' outline either side of it (left round, it stood out of them).
  if (rest > 0) reachOut(d, m, ballFrom, m.pos.length / 3, () => c, () => r, () => 0.5, du, rest)
  // Bent, the sleeve goes on past the elbow's middle (its point, and the cloth hanging off it): rounded off at
  // the joint, a raised forearm ended its upper arm in a round knob where the drawings run the sleeve on. Not
  // a sleeve ending at the elbow: past it was the portrait's arm where it hangs, a white patch beside the skin.
  const bend = Math.min(1, Math.max(0, (1 - dot(du, df)) / 2) / 0.5)
  if (bend > 0.05 && !arm3DBareFromElbow(d)) {
    // Under a short sleeve only as the arm hangs: raised, the elbow is bare and ends round where it is.
    const end = add(c, mul(du, r * 0.9 * bend * (bareRow === null ? 1 : rest)))
    // Raised, it wears the upper sleeve's rows back from the elbow, as far as it runs on: all of it in the elbow's
    // one row, a flower or a star lying on that row stood as stripes down it. Hanging it keeps that row, under the
    // portrait's own sleeve where a band off the upper arm would show past its edge.
    const past = vPast * 0.9 * bend * (1 - rest)
    m.gained = m.idx.length
    const rows = [0.5, Math.max(0.28, 0.5 - past / 2), Math.max(0.28, 0.5 - past)].map(worn)
    // A standing figure's ends in a round tip about the upper arm's own line, the tube's columns and rows going on
    // over it: a ball turned to the elbow's poles wore them askew, a dark mark on the sleeve fanned into stripes
    // across the elbow's point.
    if (d.restFore !== undefined) {
      tube(m, [c, lerp(c, end, 0.5), end], [r, r, r], rows, ARM3D_AROUND, true, turned => worn(Math.max(0.28, 0.5 - past - (1 - rest) * Math.sin(turned) * vPast)))
      return m
    }
    tube(m, [c, lerp(c, end, 0.5), end], [r, r, r], rows, ARM3D_AROUND)
    ball(end, past)
  }
  return m
}

/** The sleeve's row a short sleeve's bare elbow wears: just past where the sleeve ends, no nearer the shoulder than the elbow. */
export function arm3DBareElbowRow(shortSleeve: number): number {
  return Math.max(0.5, shortSleeve) + 0.05
}

/** The forearm drawn bare all the way from the elbow (the cuff measured no further down than it is ever put). */
export function arm3DBareFromElbow(d: Arm3DShape): boolean {
  return d.bare !== undefined && d.cuff < 0.2
}

/** The forearm's bare skin past the cuff, or the wrist in it: where it leaves the cuff, and how wide. */
function wristFit(d: Arm3DShape, p: Arm3DPose, rest: number) {
  const h = p.hand
  const size = len(sub(h[9], h[0]))
  const cuffAt = lerp(p.e, p.w, sleeveEnd(d, rest))
  const cuff = d.radius[d.radius.length - 1] * (d.restCuff === undefined && d.restFore === undefined ? 1 - 0.32 : 1) * 0.92
  // A cuff that hangs over the hand has no forearm bare past it, however far its end is from the wrist.
  const bare = d.restCuff === undefined
    ? len(sub(h[0], cuffAt)) > size * 0.15
    : dot(sub(h[0], cuffAt), norm(sub(p.w, p.e))) > size * 0.15
  // A bare forearm as wide as drawn (its lit and shaded skin), at the cuff inside the sleeve's outline: held to
  // the cuff's opening and a wrist's width all along, it came out about half as wide as drawn, the portrait's
  // arm showing beside it.
  const full = d.bare ?? Math.min(size * 0.34, cuff)
  const arm = d.bare === undefined ? full : Math.min(d.bare, d.radius[d.radius.length - 1] * 0.92)
  const fore = norm(sub(p.w, p.e))
  const off = mul(norm([-fore[1], fore[0], 0]), d.bareShift)
  return { h, size, cuffAt, cuff, bare, arm, full, fore, off }
}

/**
 * The cuff's end, from its rim in to just round the wrist: the drawings fit a cuff's opening to the wrist
 * and show only a thin dark gap inside it. Its v runs on past the sleeve's 1 (1.01 at the rim to 1.05 at the
 * hole) for the shading to tell it.
 */
function cuffFace(d: Arm3DShape, m: Arm3DMesh, p: Arm3DPose, rest: number, rim: number, outline: number): void {
  const { h, size, cuffAt, cuff, bare, arm, fore, off } = wristFit(d, p, rest)
  const dir = norm(sub(cuffAt, p.e))
  const r = bare ? arm : Math.min(size * WRIST * 1.15, cuff)
  // Flat as the wrist there is: a round opening gaped above and below the flattened wrist.
  const thin = bare ? arm * 0.85 : r
  const dh = norm(sub(h[9], h[0]))
  const across = norm(cross(norm(cross(sub(h[5], h[0]), sub(h[17], h[0]))), dh))
  let c = bare ? add(cuffAt, off) : add(h[0], mul(fore, dot(sub(cuffAt, h[0]), fore)))
  c = sub(c, mul(dir, dot(sub(c, cuffAt), dir)))
  // A little inside the wrist, so the wrist comes out through it with no gap.
  const holeA = Math.min(rim * 0.97, r * 0.9)
  const holeB = Math.min(rim * 0.97, thin * 0.9)
  let front = sub(across, mul(dir, dot(across, dir)))
  front = len(front) < 0.2 ? norm(cross(dir, [1, 0, 0])) : norm(front)
  const side = norm(cross(dir, front))
  // Its outer edge out as far as the sleeve's outline, in the outline's colour, only with the cuff turned
  // nearly to the viewer: at a slant its near side stood in front of the forearm as a white lip.
  const k = smoothstep(0.7, 0.9, dir[2])
  // A cuff measured where it hangs (wide at its end, turned back) is closed in to the wrist from every side, its
  // inside going back into the sleeve as it narrows (its own rows of v, 1.06 at the rim to 1.1 at the wrist):
  // open at a slant, it was a wide dark hole with a thin wrist in it.
  const lined = d.restCuff !== undefined
  const rings: [number, number, number, number][] = [[0, rim + outline * k, rim + outline * k, 1.01], [0, rim, rim, 1.02]]
  if (lined) rings.push([0, rim, rim, 1.06])
  for (let i = 1; i <= 3; i += 1) {
    const t = (i / 3) * (lined ? 1 : k)
    rings.push([t, rim * (1 - t) + holeA * t, rim * (1 - t) + holeB * t, lined ? 1.06 + 0.04 * (i / 3) : 1.02 + 0.03 * (i / 3)])
  }
  const back = lined ? mul(dir, -0.45 * rim) : null
  const base = m.pos.length / 3
  for (const [t, ra, rb, v] of rings) {
    const at = back ? add(lerp(cuffAt, c, t), mul(back, t)) : lerp(cuffAt, c, t)
    for (let j = 0; j <= ARM3D_AROUND; j += 1) {
      const th = (j / ARM3D_AROUND) * Math.PI * 2
      m.pos.push(...add(at, add(mul(front, Math.cos(th) * ra), mul(side, Math.sin(th) * rb))))
      m.nrm.push(...dir)
      m.uv.push(j / ARM3D_AROUND, v)
    }
  }
  for (let i = 0; i < rings.length - 1; i += 1) {
    for (let j = 0; j < ARM3D_AROUND; j += 1) {
      const a = base + i * (ARM3D_AROUND + 1) + j
      const b = a + ARM3D_AROUND + 1
      m.idx.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
}

/**
 * The wrist, from inside the cuff to the hand, as wide as a wrist is beside its hand and flat across the
 * palm, run on into the heel of the palm and closed there. Its v (-2 at the cuff to -3 at the closed end)
 * tells the shading it, its u how deep in the cuff's shadow it is.
 */
export function arm3DWristMesh(d: Arm3DShape, p: Arm3DPose, rest = 0): Arm3DMesh {
  const m = emptyMesh()
  const { h, size, cuffAt, cuff, bare, arm, full, fore, off } = wristFit(d, p, rest)
  const rw = Math.min(size * WRIST, cuff)
  const rin = Math.min(size * WRIST * 1.15, cuff)
  const dh = norm(sub(h[9], h[0]))
  const n = norm(cross(sub(h[5], h[0]), sub(h[17], h[0])))
  const across = norm(cross(n, dh))
  const palm = size * 0.075
  // A standing figure's hand is not always on its forearm's line (one hand for every gesture, set as each was
  // drawn): the wrist goes back into the sleeve along the sleeve, or it came out through the cloth's side.
  const aside: V3 = d.restFore === undefined ? [0, 0, 0] : sub(sub(h[0], p.e), mul(fore, dot(sub(h[0], p.e), fore)))
  // A standing figure's forearm drawn bare to the wrist wears its own skin all the way, and what is drawn round
  // the wrist: the wrist goes only just into it, and in no cuff's shadow (it stood over a wristband as a block).
  const skinTo = d.restFore !== undefined && d.restCuff === undefined
  const pts = bare
    ? [add(arm3DBareFromElbow(d) ? p.e : sub(cuffAt, mul(fore, size * 0.5)), off), add(cuffAt, off), add(lerp(cuffAt, h[0], 0.5), mul(off, 0.6)), h[0], add(h[0], mul(dh, size * 0.12)), add(h[0], mul(dh, size * 0.2))]
    : [sub(sub(h[0], mul(fore, size * (skinTo ? 0.15 : 0.9))), aside), sub(sub(h[0], mul(fore, size * (skinTo ? 0.06 : 0.3))), mul(aside, 0.7)), h[0], add(h[0], mul(dh, size * 0.12)), add(h[0], mul(dh, size * 0.2))]
  // Halfway to the hand a long bare forearm is still its full width; a short one narrows to the wrist there.
  const k = 0.5 + 0.5 * smoothstep(0.25, 0.7, len(sub(h[0], cuffAt)) / 2 / size)
  const wide = bare ? [arm, arm, rw + (full - rw) * k, rw, rw * 0.95, rw * 0.7] : [rin, rw * 1.04, rw, rw * 0.95, rw * 0.7]
  const thick = bare
    ? [arm * 0.85, arm * 0.85, rw * 0.7 + (full * 0.85 - rw * 0.7) * k, rw * 0.7, palm * 1.3, palm * 0.8]
    : [rin, rw, rw * 0.7, palm * 1.3, palm * 0.8]
  const AR = 16
  // In the cuff's shadow where it leaves the sleeve; none with no cuff on the forearm.
  const occ = arm3DBareFromElbow(d) ? [0, 0, 0, 0, 0, 0] : bare ? [1, 0.45, 0, 0, 0, 0] : skinTo ? [0, 0, 0, 0, 0] : [1, 0.4, 0, 0, 0]
  const rings = pts.map((at, i) => ({ at, wide: wide[i], thick: thick[i], occ: occ[i], v: -2 - i / (pts.length - 1), tilt: 0 }))
  // Bare from the elbow, it ends there round, as the drawn elbow is: cut flat, its end stood across the sleeve
  // below it as a straight edge, the body's dark showing past it.
  if (arm3DBareFromElbow(d)) {
    const back = norm(sub(pts[0], pts[1]))
    const CAP = 4
    for (let k = 1; k <= CAP; k += 1) {
      const t = (k / CAP) * Math.PI / 2 * 0.97
      rings.unshift({ at: add(pts[0], mul(back, arm * 0.8 * Math.sin(t))), wide: wide[0] * Math.cos(t), thick: thick[0] * Math.cos(t), occ: 0, v: -2, tilt: t })
    }
  }
  for (let i = 0; i < rings.length; i += 1) {
    const r = rings[i]
    const dd = norm(sub(rings[Math.min(rings.length - 1, i + 1)].at, rings[Math.max(0, i - 1)].at))
    const a = norm(sub(across, mul(dd, dot(across, dd))))
    const b = norm(cross(dd, a))
    for (let j = 0; j <= AR; j += 1) {
      const th = (j / AR) * Math.PI * 2
      const c = Math.cos(th)
      const sn = Math.sin(th)
      m.pos.push(...add(r.at, add(mul(a, c * r.wide), mul(b, sn * r.thick))))
      const out = norm(add(mul(a, c / r.wide), mul(b, sn / r.thick)))
      m.nrm.push(...norm(sub(mul(out, Math.cos(r.tilt)), mul(dd, Math.sin(r.tilt)))))
      m.uv.push(r.occ, r.v)
    }
  }
  for (let i = 0; i < rings.length - 1; i += 1) {
    for (let j = 0; j < AR; j += 1) {
      const a = i * (AR + 1) + j
      const b = a + AR + 1
      m.idx.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
  const centre = m.pos.length / 3
  const last = (rings.length - 1) * (AR + 1)
  m.pos.push(...add(pts[pts.length - 1], mul(dh, palm * 0.5)))
  m.nrm.push(...dh)
  m.uv.push(0, -3)
  for (let j = 0; j < AR; j += 1) m.idx.push(last + j, centre, last + j + 1)
  return m
}

/**
 * The drawn palm outline in the modelled palm's own terms at the drawn pose. Measured across in lengths of
 * wrist→middle knuckle as drawn, it came out much too wide where the hand points toward or away from the
 * viewer; so each point goes as far across as puts it where the drawing has it, then turns with the hand.
 */
export function arm3DPalmAsModelled(h: V3[], palm: Array<[number, number]> | null): Array<[number, number]> | null {
  if (!palm) return null
  const u = sub(h[9], h[0])
  const lu = len(u)
  const lu2 = Math.hypot(u[0], u[1])
  const vh = norm(cross(norm(cross(u, sub(h[17], h[5]))), u))
  const sgn = dot(vh, sub(h[17], h[5])) < 0 ? -1 : 1
  let px = -u[1] / Math.max(1e-6, lu2)
  let py = u[0] / Math.max(1e-6, lu2)
  if (px * (h[17][0] - h[5][0]) + py * (h[17][1] - h[5][1]) < 0) {
    px = -px
    py = -py
  }
  const c = sgn * (vh[0] * px + vh[1] * py)
  const along = sgn * (vh[0] * u[0] + vh[1] * u[1]) / Math.max(1e-6, lu2 * lu2)
  if (lu2 < 1e-6 || c < 0.25) return palm
  return palm.map(([a, b]) => {
    const beta = Math.max(-0.75, Math.min(0.75, (b * lu2) / (c * lu)))
    return [a - beta * lu * along, beta]
  })
}

/** One finger as a tube along a smooth curve through its joints, as wide as the drawing has it. */
function finger(d: Arm3DShape, m: Arm3DMesh, h: V3[], ci: number, chain: number[], r: number): void {
  // A finger the drawing hides is as thick as a finger is by rule: measured, it took the hand drawn over it.
  const hid = d.hiddenFingers.includes(ci)
  const drawn = hid ? 0 : d.fingers[ci] ?? 0
  const from = chain[0] === 0 ? 1 : 0
  const fr = drawn > r * 0.5 && drawn < r * 1.6 ? drawn : r
  // Measured past believing (a thumb laid on bare skin, its width running on across the chest) it is left out
  // of keyProfile for the rule's width to stand in, not taken back from the measure it was left out of.
  const own = d.keyProfile[ci]
  const prof = hid ? undefined : own ? (own.length >= 2 ? own : undefined) : d.fingerProfile[ci]
  const width = (x: number) => {
    if (!prof || prof.length < 2) return fr * (1.05 - 0.5 * x ** 1.2)
    const k = Math.min(prof.length - 1, Math.max(0, (x - 0.06) / 0.88 * (prof.length - 1)))
    const i = Math.min(prof.length - 2, Math.floor(k))
    return Math.min(r * 1.7, Math.max(r * 0.4, prof[i] + (prof[i + 1] - prof[i]) * (k - i)))
  }
  // Narrowing over the last of the finger into its rounded tip.
  const tipped = (x: number) => width(x) * (1 - 0.4 * Math.min(1, Math.max(0, (x - 0.72) / 0.28)) ** 1.5)
  const pts: V3[] = []
  const radii: number[] = []
  const vs: number[] = []
  const at = (i: number) => h[chain[Math.max(from, Math.min(chain.length - 1, i))]]
  const SUB = 6
  // Rooted a little inside the palm: the knuckles found sit a little out along the fingers.
  const inner = ci > 0 ? 1 : 0
  if (inner) {
    pts.push(add(h[chain[1]], mul(sub(h[0], h[chain[1]]), 0.15)))
    radii.push(width(0))
    vs.push(0)
  }
  for (let i = from; i < chain.length - 1; i += 1) {
    for (let s = 0; s < SUB; s += 1) {
      pts.push(catmull(at(i - 1), at(i), at(i + 1), at(i + 2), s / SUB))
      radii.push(tipped((i - from + s / SUB) / (chain.length - 1 - from)))
      vs.push(0)
    }
  }
  // The tip point is the drawn fingertip, the rounded cap within it (past it, a blunt square end).
  const tipR = tipped(1)
  const tip = h[chain[chain.length - 1]]
  const tipDir = norm(sub(tip, pts[pts.length - 1]))
  pts.push(sub(tip, mul(tipDir, Math.min(tipR, len(sub(tip, pts[pts.length - 1])) * 0.8))))
  radii.push(tipR)
  vs.push(0)
  const first = m.pos.length / 3
  tube(m, pts, radii, vs, 14, true)
  const rings = (m.pos.length / 3 - first) / 15
  for (let v = first; v < m.pos.length / 3; v += 1) {
    const f = Math.max(0, Math.floor((v - first) / 15) - inner) / Math.max(1, rings - 1 - inner)
    m.tip!.push(Math.min(1, Math.max(0, (f - 0.86) / 0.14)))
    m.along!.push(f)
    m.part!.push(ci)
    const i = Math.floor((v - first) / 15)
    const dir = i < pts.length - 1 ? norm(sub(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)])) : tipDir
    m.face!.push(Math.abs(dir[2]))
  }
}

/**
 * The hand: the fingers, and the palm as a thick plate in the drawn palm's shape (`palm`, from
 * arm3DPalmAsModelled), set back a little so a finger is over it wherever the two meet.
 */
export function arm3DHandMesh(d: Arm3DShape, p: Arm3DPose, palm: Array<[number, number]> | null): Arm3DMesh {
  const m: Arm3DMesh = { ...emptyMesh(), along: [], tip: [], part: [], face: [] }
  const h = p.hand
  const size = len(sub(h[9], h[0]))
  const r = size * 0.085
  for (const [ci, chain] of HAND_CHAINS.entries()) finger(d, m, h, ci, chain, r)
  const n = norm(cross(sub(h[5], h[0]), sub(h[17], h[0])))
  let across = norm(cross(n, sub(h[9], h[0])))
  if (dot(across, sub(h[1], h[0])) < 0) across = mul(across, -1)
  const heel = Math.max(0, size * WRIST - r * 0.82)
  let ring = [add(h[0], mul(across, heel)), ...[1, 5, 9, 13, 17].map((i) => h[i]), sub(h[0], mul(across, heel))]
  let rims = ring.map(() => r * 0.82)
  if (palm && palm.length >= 6) ({ ring, rims } = palmRing(h, n, palm, r))
  const c = mul(ring.reduce((acc, q) => add(acc, q), [0, 0, 0] as V3), 1 / ring.length)
  const palmFrom = m.pos.length / 3
  for (const sgn of [1, -1]) {
    const b = m.pos.length / 3
    const off = mul(n, sgn * r * 0.8)
    m.pos.push(...add(c, off))
    m.nrm.push(...mul(n, sgn))
    m.uv.push(0, 0)
    for (const q of ring) {
      m.pos.push(...add(q, off))
      m.nrm.push(...norm(add(mul(n, sgn), mul(norm(sub(q, c)), 0.6))))
      m.uv.push(0, 0)
    }
    // Wound so the plate's outer side is its front, as the tubes are: else its outline covers it.
    const want = mul(n, sgn)
    for (let i = 0; i < ring.length; i += 1) {
      const i1 = b + 1 + i
      const i2 = b + 1 + ((i + 1) % ring.length)
      const g = cross(sub(ring[i], c), sub(ring[(i + 1) % ring.length], c))
      if (dot(g, want) < 0) m.idx.push(b, i1, i2)
      else m.idx.push(b, i2, i1)
    }
  }
  // The palm's edge, joining the two plates.
  tube(m, [...ring, ring[0]], [...rims, rims[0]], Array.from({ length: ring.length + 1 }, () => 0), 12)
  while (m.part!.length < m.pos.length / 3) {
    m.part!.push(5)
    m.along!.push(0)
    m.tip!.push(0)
    m.face!.push(0)
  }
  for (let i = palmFrom; i < m.pos.length / 3; i += 1) m.pos[i * 3 + 2] -= r * 1.2
  return m
}

/**
 * The drawn palm's outline in the palm's plane, taken in by the rim's thickness. Past the knuckle line only
 * as far as its finger still lies in the palm's plane (a finger curled away left the plate standing over
 * where it went), nor out to the side past the outermost knuckles (a pale tab beside the hand).
 */
function palmRing(h: V3[], n: V3, outline: Array<[number, number]>, r: number): { ring: V3[]; rims: number[] } {
  const u = sub(h[9], h[0])
  let v = mul(norm(cross(norm(cross(u, sub(h[17], h[5]))), u)), len(u))
  if (dot(v, sub(h[17], h[5])) < 0) v = mul(v, -1)
  const uu = dot(u, u)
  const kn = [5, 9, 13, 17].map((j) => {
    const k = sub(h[j], h[0])
    const bone = norm(sub(h[j + 1], h[j]))
    return { a: dot(k, u) / uu, b: dot(k, v) / uu, keep: 1 - smoothstep(0.2, 0.7, Math.abs(dot(bone, n))) }
  }).sort((p, q) => p.b - q.b)
  const knAt = (b: number) => {
    if (b <= kn[0].b) return kn[0]
    for (let i = 0; i < kn.length - 1; i += 1) {
      const p = kn[i]
      const q = kn[i + 1]
      if (b <= q.b) {
        const t = (b - p.b) / Math.max(1e-6, q.b - p.b)
        return { a: p.a + (q.a - p.a) * t, b, keep: p.keep + (q.keep - p.keep) * t }
      }
    }
    return kn[kn.length - 1]
  }
  const lo = kn[0]
  const hi = kn[kn.length - 1]
  // Out to the line from the thumb's knuckle to the forefinger's: the drawn palm stops where a thumb lies over it,
  // and the modelled thumb, thinner than drawn, left a crack there between itself, the forefinger and the palm.
  const onPlane = (j: number): [number, number] => [dot(sub(h[j], h[0]), u) / uu, dot(sub(h[j], h[0]), v) / uu]
  const [t0, t1] = [onPlane(2), onPlane(5)]
  const ca = outline.reduce((s, q) => s + q[0], 0) / outline.length
  const cb = outline.reduce((s, q) => s + q[1], 0) / outline.length
  const filled = outline.map(([a, b]): [number, number] => {
    // Where the ray from the middle through this point crosses the line, if it does, at s along the ray.
    const da = a - ca
    const db = b - cb
    const ea = t1[0] - t0[0]
    const eb = t1[1] - t0[1]
    const den = da * eb - db * ea
    if (Math.abs(den) < 1e-9) return [a, b]
    const s = ((t0[0] - ca) * eb - (t0[1] - cb) * ea) / den
    const t = ((t0[0] - ca) * db - (t0[1] - cb) * da) / den
    return t >= 0 && t <= 1 && s > 1 ? [ca + da * s, cb + db * s] : [a, b]
  })
  // Past the knuckle line (between the fingers' roots) the rim thin: a full one rounded the narrow foot of each
  // gap between fingers into a pale bump.
  const rims = filled.map(([a, b]) => r * 0.82 * (1 - 0.6 * smoothstep(0, 0.08, a - knAt(b).a)))
  const pts = filled.map(([a, b]) => {
    const k = knAt(b)
    const past = a > k.a
    const a2 = past ? k.a + (a - k.a) * k.keep : a
    const b2 = !past ? b : b > hi.b ? hi.b + (b - hi.b) * hi.keep : b < lo.b ? lo.b + (b - lo.b) * lo.keep : b
    return add(h[0], add(mul(u, a2), mul(v, b2)))
  })
  const mid = mul(pts.reduce((acc, q) => add(acc, q), [0, 0, 0] as V3), 1 / pts.length)
  const ring = pts.map((q, i) => {
    const dq = len(sub(q, mid))
    return add(mid, mul(sub(q, mid), Math.max(0.3, 1 - rims[i] / Math.max(1e-6, dq))))
  })
  return { ring, rims }
}
