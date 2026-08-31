import type { BehaviorPlan } from './behavior'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BehaviorScheduler,
  MAX_PREPARATION_RETIME_MS,
} from './behaviorScheduler'

function plan(endMs = 1_000): BehaviorPlan {
  return {
    id: 'plan-1',
    originMs: 0,
    pegs: [
      { id: 'start', atMs: 100, revision: 0 },
      { id: 'stroke', atMs: 300, revision: 0 },
      { id: 'hold', atMs: 380, revision: 0 },
      { id: 'relax', atMs: 800, revision: 0 },
      { id: 'end', atMs: endMs, revision: 0 },
    ],
    behaviors: [
      {
        id: 'behavior-1',
        function: 'acknowledge',
        kind: 'oneShot',
        source: 'performance',
        resources: ['face.expression', 'body.torso'],
        channels: ['expression', 'headBody'],
        timing: {
          start: 'start',
          stroke: 'stroke',
          hold: 'hold',
          relax: 'relax',
          end: 'end',
        },
        form: { family: 'performance-cue', id: 'respond' },
        intensity: 1,
      },
    ],
  }
}

test('moves through explicit preparation, commitment, hold and recovery phases', () => {
  const scheduler = new BehaviorScheduler()
  scheduler.replace(plan(), 0)
  assert.equal(scheduler.tick(0)[0]?.phase, 'planned')
  assert.equal(scheduler.tick(150)[0]?.phase, 'preparing')
  assert.equal(scheduler.tick(320)[0]?.phase, 'committed')
  assert.equal(scheduler.tick(500)[0]?.phase, 'holding')
  assert.equal(scheduler.tick(850)[0]?.phase, 'recovering')
  assert.equal(scheduler.tick(1_000)[0]?.phase, 'complete')
  assert.equal(scheduler.snapshots(1_001).length, 0)
})

test('retimes freely before preparation, clamps during preparation, and locks the stroke after commitment', () => {
  const scheduler = new BehaviorScheduler()
  scheduler.replace(plan(), 0)
  assert.equal(scheduler.retimePeg('stroke', 340, 0), 'retimed')
  const before = scheduler.snapshots(0)[0]
  assert.equal(before?.strokeAtMs, 340)
  assert.equal(scheduler.retimePeg('stroke', 900, 150), 'retimed')
  assert.equal(
    scheduler.snapshots(150)[0]?.strokeAtMs,
    Math.min(340 + MAX_PREPARATION_RETIME_MS, 380),
  )
  assert.equal(scheduler.retimePeg('stroke', 700, 670), 'locked')
})

test('a compatible event revision retimes pegs without restarting lifecycle', () => {
  const scheduler = new BehaviorScheduler()
  const feedback: string[] = []
  scheduler.subscribe((event) => feedback.push(event.type))
  scheduler.replace(plan(), 0)
  const revised = plan()
  revised.pegs = revised.pegs.map((peg) =>
    peg.id === 'stroke' ? { ...peg, atMs: 340, revision: 1 } : peg,
  )
  const report = scheduler.retimePlan(revised, 0)
  assert.equal(report.compatible, true)
  assert.equal(report.pegs.stroke, 'retimed')
  assert.equal(scheduler.snapshots(0)[0]?.strokeAtMs, 340)
  assert.equal(feedback.filter((type) => type === 'scheduled').length, 1)
  assert.ok(feedback.includes('retimed'))
})

test('incremental revisions append future behavior without restarting committed work', () => {
  const scheduler = new BehaviorScheduler()
  const scheduled: string[] = []
  scheduler.subscribe((event) => {
    if (event.type === 'scheduled') scheduled.push(event.behaviorId)
  })
  scheduler.replace(plan(), 0)
  scheduler.tick(320)
  const revised = plan(1_200)
  revised.pegs = [
    ...revised.pegs,
    { id: 'start-2', atMs: 700, revision: 0 },
    { id: 'stroke-2', atMs: 800, revision: 0 },
    { id: 'hold-2', atMs: 840, revision: 0 },
    { id: 'relax-2', atMs: 980, revision: 0 },
    { id: 'end-2', atMs: 1_100, revision: 0 },
  ]
  revised.behaviors = [
    ...revised.behaviors,
    {
      ...revised.behaviors[0]!,
      id: 'behavior-2',
      timing: {
        start: 'start-2',
        stroke: 'stroke-2',
        hold: 'hold-2',
        relax: 'relax-2',
        end: 'end-2',
      },
    },
  ]
  const report = scheduler.reconcilePlan(revised, 320)
  assert.equal(report.compatible, true)
  assert.deepEqual(report.added, ['behavior-2'])
  assert.equal(scheduler.snapshots(320)[0]?.phase, 'committed')
  assert.deepEqual(scheduled, ['behavior-1', 'behavior-2'])
})

test('an anticipator keeps moving the next rhythmic event after commitment', () => {
  const scheduler = new BehaviorScheduler()
  const rhythmic = plan()
  rhythmic.pegs = [
    ...rhythmic.pegs,
    { id: 'next-beat', atMs: 600, revision: 0, confidence: 0.3 },
  ]
  rhythmic.behaviors = [
    {
      ...rhythmic.behaviors[0]!,
      kind: 'rhythmic',
      source: 'music',
      anticipation: 'next-beat',
      timing: {
        ...rhythmic.behaviors[0]!.timing,
        relax: null,
        end: null,
      },
    },
  ]
  scheduler.replace(rhythmic, 0)
  scheduler.tick(500)
  assert.equal(scheduler.retimePeg('next-beat', 920, 500, 0.86), 'retimed')
  const snapshot = scheduler.snapshots(500)[0]
  assert.equal(snapshot?.phase, 'holding')
  assert.equal(snapshot?.anticipatedAtMs, 920)
  assert.equal(snapshot?.anticipationConfidence, 0.86)
})

test('interrupts a committed behavior through recovery instead of snapping it away', () => {
  const scheduler = new BehaviorScheduler()
  scheduler.replace(plan(), 0)
  scheduler.tick(500)
  assert.equal(scheduler.interrupt('behavior-1', 520, 180), true)
  const recovering = scheduler.snapshots(520)[0]
  assert.equal(recovering?.phase, 'recovering')
  assert.equal(recovering?.endsAtMs, 700)
  assert.equal(scheduler.tick(700)[0]?.phase, 'complete')
})

test('records realizer rejection as lifecycle feedback', () => {
  const scheduler = new BehaviorScheduler()
  const feedback: string[] = []
  scheduler.subscribe((event) =>
    feedback.push(
      `${event.type}:${event.behaviorId}:${event.reason ?? 'none'}`,
    ),
  )
  const behaviorPlan = plan()
  scheduler.replace(behaviorPlan, 0)
  scheduler.reportRealizer(
    behaviorPlan.behaviors[0]!.id,
    'rejected',
    20,
    'unsupported-form',
  )
  assert.ok(feedback.includes('scheduled:behavior-1:none'))
  assert.ok(feedback.includes('rejected:behavior-1:unsupported-form'))
  assert.equal(scheduler.snapshots(21)[0]?.phase, 'rejected')
})

test('keeps rhythmic and tracking behaviors open until an explicit interruption', () => {
  for (const kind of ['rhythmic', 'tracking'] as const) {
    const scheduler = new BehaviorScheduler()
    const open: BehaviorPlan = {
      id: `plan-${kind}`,
      originMs: 0,
      pegs: [
        { id: `${kind}:start`, atMs: 0, revision: 0 },
        { id: `${kind}:stroke`, atMs: 100, revision: 0 },
        { id: `${kind}:hold`, atMs: 140, revision: 0 },
      ],
      behaviors: [
        {
          id: kind,
          function: kind === 'rhythmic' ? 'entrain' : 'orient',
          kind,
          source: kind === 'rhythmic' ? 'music' : 'performance',
          resources: kind === 'rhythmic' ? ['body.torso'] : ['face.gaze'],
          channels: kind === 'rhythmic' ? ['headBody'] : ['gaze'],
          timing: {
            start: `${kind}:start`,
            stroke: `${kind}:stroke`,
            hold: `${kind}:hold`,
            relax: null,
            end: null,
          },
          form: { family: kind, id: 'default' },
          intensity: 1,
        },
      ],
    }
    scheduler.replace(open, 0)
    assert.equal(scheduler.tick(5_000)[0]?.phase, 'holding')
    assert.equal(scheduler.interrupt(kind, 5_000, 200), true)
    assert.equal(scheduler.tick(5_000)[0]?.phase, 'recovering')
    assert.equal(scheduler.tick(5_200)[0]?.phase, 'complete')
  }
})
