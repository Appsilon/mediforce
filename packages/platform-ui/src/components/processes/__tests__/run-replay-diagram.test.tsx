import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import type { StepExecution } from '@mediforce/platform-core';

const rendered = vi.hoisted(() => ({
  travels: [] as Array<import('@/components/workflows/workflow-diagram').DiagramReplayFrame['travel']>,
}));

vi.mock('@/components/workflows/workflow-diagram', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/components/workflows/workflow-diagram')>();
  return {
    ...original,
    WorkflowDiagram: ({ replay }: { replay?: import('@/components/workflows/workflow-diagram').DiagramReplayFrame }) => {
      rendered.travels.push(replay?.travel ?? null);
      return (
        <div
          data-testid="diagram"
          data-active={replay?.activeStepId ?? ''}
          data-travel={replay?.travel?.edgeId ?? ''}
          data-traversals={JSON.stringify([...(replay?.edgeTraversals ?? new Map())])}
        />
      );
    },
  };
});

import { RunReplayDiagram } from '../run-replay-diagram';
import { buildWorkflowDefinition } from '@mediforce/platform-core/testing';

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

const definition = buildWorkflowDefinition({
  steps: [
    { id: 'draft', name: 'Draft', type: 'creation', executor: 'agent' },
    { id: 'review', name: 'Review', type: 'review', executor: 'human' },
    { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
  ],
  transitions: [
    { from: 'draft', to: 'review' },
    { from: 'review', to: 'draft' },
    { from: 'review', to: 'done' },
  ],
});

// draft → review → draft → review: the review loop taken once.
const stepExecutions = [
  execution('draft', '2026-10-21T10:00:00.000Z'),
  execution('review', '2026-10-21T10:01:00.000Z'),
  execution('draft', '2026-10-21T10:30:00.000Z'),
  execution('review', '2026-10-21T10:31:00.000Z'),
];

function diagram() {
  const element = screen.getByTestId('diagram');
  return {
    active: element.dataset.active,
    travel: element.dataset.travel,
    traversals: JSON.parse(element.dataset.traversals ?? '[]') as Array<[string, number]>,
  };
}

describe('RunReplayDiagram', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    rendered.travels.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  it('[RENDER] opens on the whole path the run took, loop counts included', () => {
    render(<RunReplayDiagram definition={definition} stepExecutions={stepExecutions} />);

    expect(screen.getByTestId('run-replay-position')).toHaveTextContent('Hop 3 of 3 · Review');
    expect(diagram().active).toBe('review');
    expect(diagram().traversals).toEqual([['draft->review', 2], ['review->draft', 1]]);
  });

  it('[CLICK] replay walks the ball hop by hop and stops at the last step', () => {
    render(<RunReplayDiagram definition={definition} stepExecutions={stepExecutions} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Path only' }));
    fireEvent.click(screen.getByRole('button', { name: /Replay run/ }));

    expect(diagram().active).toBe('draft');
    expect(diagram().traversals).toEqual([]);

    act(() => { vi.advanceTimersByTime(300); });
    expect(diagram().travel).toBe('draft->review');

    act(() => { vi.advanceTimersByTime(700); });
    expect(diagram().active).toBe('review');
    expect(screen.getByTestId('run-replay-position')).toHaveTextContent('Hop 1 of 3 · Review');

    for (let tick = 0; tick < 10; tick++) act(() => { vi.advanceTimersByTime(1_000); });
    expect(diagram().active).toBe('review');
    expect(diagram().travel).toBe('');
    expect(screen.getByRole('button', { name: /Replay run/ })).toBeInTheDocument();
  });

  it('[CLICK] pausing mid-hop lets the ball finish its ride, then holds at the step', () => {
    render(<RunReplayDiagram definition={definition} stepExecutions={stepExecutions} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Path only' }));
    fireEvent.click(screen.getByRole('button', { name: /Replay run/ }));
    act(() => { vi.advanceTimersByTime(300); });
    const ride = rendered.travels.at(-1);
    expect(ride?.edgeId).toBe('draft->review');

    fireEvent.click(screen.getByRole('button', { name: /Pause/ }));
    // A new travel object would restart the ball's <animateMotion> from the source.
    expect(rendered.travels.at(-1)).toBe(ride);

    act(() => { vi.advanceTimersByTime(700); });
    expect(diagram().active).toBe('review');
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(diagram().active).toBe('review');
    expect(diagram().travel).toBe('');
    expect(screen.getByTestId('run-replay-position')).toHaveTextContent('Hop 1 of 3 · Review');

    fireEvent.click(screen.getByRole('button', { name: /Replay run/ }));
    act(() => { vi.advanceTimersByTime(300); });
    expect(diagram().travel).toBe('review->draft');
  });

  it('[RENDER] no controls for a run with a single step', () => {
    render(<RunReplayDiagram definition={definition} stepExecutions={stepExecutions.slice(0, 1)} />);

    expect(screen.queryByTestId('run-replay-controls')).not.toBeInTheDocument();
  });
});
