import { describe, it, expect } from 'vitest';
import type { StepExecution } from '@mediforce/platform-core';
import {
  buildReplayHops,
  firstReplayStep,
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

describe('buildReplayHops', () => {
  it('follows executions in start order, loops included', () => {
    const hops = buildReplayHops(executions, edgeIds);
    expect(hops.map((hop) => `${hop.from}->${hop.to}`)).toEqual([
      'draft->review',
      'review->draft',
      'draft->review',
      'review->publish',
    ]);
    expect(hops.map((hop) => hop.realGapMs)).toEqual([60_000, 120_000, 60_000, 360_000]);
  });

  it('leaves the edge empty when the diagram draws no arrow between the steps', () => {
    const hops = buildReplayHops(executions, new Set(['draft->review']));
    expect(hops.map((hop) => hop.edgeId)).toEqual(['draft->review', null, 'draft->review', null]);
  });

  it('has no hops for zero or one execution', () => {
    expect(buildReplayHops([], edgeIds)).toEqual([]);
    expect(buildReplayHops([execution('draft', '2026-10-21T10:00:00.000Z')], edgeIds)).toEqual([]);
  });
});

describe('firstReplayStep', () => {
  it('is the earliest started step', () => {
    expect(firstReplayStep(executions)).toBe('draft');
    expect(firstReplayStep([])).toBeNull();
  });
});

describe('replayDwellsMs', () => {
  const hops = buildReplayHops(executions, edgeIds);

  it('journey pacing waits the same beat at every step', () => {
    expect(replayDwellsMs(hops, 'journey')).toEqual([JOURNEY_DWELL_MS, JOURNEY_DWELL_MS, JOURNEY_DWELL_MS, JOURNEY_DWELL_MS]);
  });

  it('proportional pacing squeezes real time into a fixed total, keeping ratios', () => {
    const dwells = replayDwellsMs(hops, 'proportional');
    expect(dwells.reduce((sum, dwell) => sum + dwell, 0)).toBeCloseTo(PROPORTIONAL_TOTAL_DWELL_MS);
    expect(dwells[3] / dwells[0]).toBeCloseTo(6);
  });

  it('proportional pacing falls back to the journey beat when no time passed', () => {
    const instant = buildReplayHops(
      [execution('draft', '2026-10-21T10:00:00.000Z'), execution('review', '2026-10-21T10:00:00.000Z')],
      edgeIds,
    );
    expect(replayDwellsMs(instant, 'proportional')).toEqual([JOURNEY_DWELL_MS]);
  });
});
