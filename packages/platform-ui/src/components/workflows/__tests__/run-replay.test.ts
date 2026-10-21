import { describe, it, expect } from 'vitest';
import type { StepExecution } from '@mediforce/platform-core';
import {
  buildReplayPath,
  replayDwellsMs,
  JOURNEY_DWELL_MS,
  PROPORTIONAL_TOTAL_DWELL_MS,
} from '../run-replay';

function execution(stepId: string, startedAt: string): StepExecution {
  return {
    id: `${stepId}-${startedAt}`,
    instanceId: 'run-1',
    stepId,
    status: 'completed',
    input: {},
    output: null,
    verdict: null,
    executedBy: 'test',
    startedAt,
    completedAt: null,
    iterationNumber: 0,
    gateResult: null,
    error: null,
  };
}

// draft → review → draft (loop) → review → publish, delivered out of order.
const executions = [
  execution('review', '2026-10-21T10:01:00.000Z'),
  execution('draft', '2026-10-21T10:00:00.000Z'),
  execution('publish', '2026-10-21T10:10:00.000Z'),
  execution('draft', '2026-10-21T10:03:00.000Z'),
  execution('review', '2026-10-21T10:04:00.000Z'),
];
const edgeIds = new Set(['draft->review', 'review->draft', 'review->publish']);

describe('buildReplayPath hops', () => {
  it('follows executions in start order, loops included', () => {
    const hops = buildReplayPath(executions, edgeIds).hops;
    expect(hops.map((hop) => `${hop.from}->${hop.to}`)).toEqual([
      'draft->review',
      'review->draft',
      'draft->review',
      'review->publish',
    ]);
    expect(hops.map((hop) => hop.realGapMs)).toEqual([60_000, 120_000, 60_000, 360_000]);
  });

  it('leaves the edge empty when the diagram draws no arrow between the steps', () => {
    const hops = buildReplayPath(executions, new Set(['draft->review'])).hops;
    expect(hops.map((hop) => hop.edgeId)).toEqual(['draft->review', null, 'draft->review', null]);
  });

  it('has no hops for zero or one execution', () => {
    expect(buildReplayPath([], edgeIds).hops).toEqual([]);
    expect(buildReplayPath([execution('draft', '2026-10-21T10:00:00.000Z')], edgeIds).hops).toEqual([]);
  });
});

describe('buildReplayPath terminal hop', () => {
  const terminalStepIds = new Set(['done', 'rejected']);
  const ran = [
    execution('draft', '2026-10-21T10:00:00.000Z'),
    { ...execution('review', '2026-10-21T10:01:00.000Z'), completedAt: '2026-10-21T10:03:00.000Z' },
  ];

  it('rides into the only terminal step the last step has an arrow to', () => {
    const hops = buildReplayPath(ran, new Set(['draft->review', 'review->done']), terminalStepIds).hops;
    expect(hops.at(-1)).toEqual({ from: 'review', to: 'done', edgeId: 'review->done', realGapMs: 120_000 });
  });

  it('follows the last step\'s routing when it could end at several terminal steps', () => {
    const routed = [ran[0], { ...ran[1], gateResult: { next: 'rejected', reason: 'verdict' } }];
    const hops = buildReplayPath(routed, new Set(['draft->review', 'review->done', 'review->rejected']), terminalStepIds).hops;
    expect(hops.at(-1)?.to).toBe('rejected');
  });

  it('adds no hop when the terminal step cannot be told apart, or the run has not completed', () => {
    const edges = new Set(['draft->review', 'review->done', 'review->rejected']);
    expect(buildReplayPath(ran, edges, terminalStepIds).hops).toHaveLength(1);
    expect(buildReplayPath(ran, new Set(['draft->review', 'review->done'])).hops).toHaveLength(1);
  });
});

describe('buildReplayPath first step', () => {
  it('is the earliest started step', () => {
    expect(buildReplayPath(executions, edgeIds).firstStepId).toBe('draft');
    expect(buildReplayPath([], edgeIds).firstStepId).toBeNull();
  });
});

describe('replayDwellsMs', () => {
  const hops = buildReplayPath(executions, edgeIds).hops;

  it('journey pacing waits the same beat at every step', () => {
    expect(replayDwellsMs(hops, 'journey')).toEqual([JOURNEY_DWELL_MS, JOURNEY_DWELL_MS, JOURNEY_DWELL_MS, JOURNEY_DWELL_MS]);
  });

  it('proportional pacing squeezes real time into a fixed total, keeping ratios', () => {
    const dwells = replayDwellsMs(hops, 'proportional');
    expect(dwells.reduce((sum, dwell) => sum + dwell, 0)).toBeCloseTo(PROPORTIONAL_TOTAL_DWELL_MS);
    expect(dwells[3] / dwells[0]).toBeCloseTo(6);
  });

  it('proportional pacing falls back to the journey beat when no time passed', () => {
    const instant = buildReplayPath(
      [execution('draft', '2026-10-21T10:00:00.000Z'), execution('review', '2026-10-21T10:00:00.000Z')],
      edgeIds,
    ).hops;
    expect(replayDwellsMs(instant, 'proportional')).toEqual([JOURNEY_DWELL_MS]);
  });
});
