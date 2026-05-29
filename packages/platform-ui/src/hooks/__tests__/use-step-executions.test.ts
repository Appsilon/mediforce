import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { StepExecution } from '@mediforce/platform-core';
import { buildStepExecution } from '@mediforce/platform-core/testing';
import { createQueryWrapper } from '@/test/react-query';

type StepEntry = {
  stepId: string;
  name: string;
  type: 'creation' | 'review' | 'decision' | 'terminal';
  executorType: 'human' | 'agent' | 'script' | 'cowork' | 'action' | 'unknown';
  status: 'completed' | 'running' | 'pending';
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  execution: StepExecution | null;
};

type GetStepsResult = {
  instanceId: string;
  definitionName: string;
  definitionVersion: string;
  instanceStatus: 'running' | 'completed' | 'failed' | 'paused';
  currentStepId: string | null;
  steps: StepEntry[];
};

function entry(stepId: string, execution: StepExecution | null): StepEntry {
  return {
    stepId,
    name: stepId,
    type: 'review',
    executorType: 'agent',
    status: execution !== null ? 'completed' : 'pending',
    input: null,
    output: null,
    execution,
  };
}

function result(instanceId: string, steps: StepEntry[], status: GetStepsResult['instanceStatus'] = 'running'): GetStepsResult {
  return {
    instanceId,
    definitionName: 'wf',
    definitionVersion: '1',
    instanceStatus: status,
    currentStepId: null,
    steps,
  };
}

const getStepsMock = vi.fn<(...args: unknown[]) => Promise<GetStepsResult>>();
class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
vi.mock('@/lib/mediforce', () => ({
  mediforce: { processes: { getSteps: getStepsMock } },
  ApiError,
}));

const { useStepExecutions } = await import('../use-step-executions');

describe('useStepExecutions', () => {
  beforeEach(() => {
    getStepsMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('does not call the API when instanceId is null', () => {
    const { wrapper } = createQueryWrapper();
    const { result: r } = renderHook(() => useStepExecutions(null, 'running'), { wrapper });
    expect(r.current.data).toEqual([]);
    expect(r.current.loading).toBe(false);
    expect(getStepsMock).not.toHaveBeenCalled();
  });

  it('returns StepExecution[] extracted from entries (null executions filtered)', async () => {
    const ex1 = buildStepExecution({ id: 'ex-1', stepId: 's1' });
    const ex2 = buildStepExecution({ id: 'ex-2', stepId: 's2' });
    getStepsMock.mockResolvedValue(result('inst-a', [
      entry('s1', ex1),
      entry('s-pending', null),
      entry('s2', ex2),
    ]));
    const { wrapper } = createQueryWrapper();
    const { result: r } = renderHook(() => useStepExecutions('inst-a', 'running'), { wrapper });

    expect(r.current.loading).toBe(true);
    await waitFor(() => expect(r.current.loading).toBe(false));
    expect(getStepsMock).toHaveBeenCalledWith({ instanceId: 'inst-a' });
    expect(r.current.data.map((e) => e.id)).toEqual(['ex-1', 'ex-2']);
  });

  it('surfaces 4xx errors immediately and stops polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getStepsMock.mockRejectedValue(new ApiError(403, 'forbidden'));
    const { wrapper } = createQueryWrapper();
    const { result: r } = renderHook(() => useStepExecutions('inst-a', 'running'), { wrapper });

    await waitFor(() => expect(r.current.loading).toBe(false));
    expect(getStepsMock).toHaveBeenCalledTimes(1);
    expect(r.current.data).toEqual([]);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(getStepsMock).toHaveBeenCalledTimes(1);
  });

  it('stops polling when instanceStatus is terminal (completed)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getStepsMock.mockResolvedValue(result('inst-a', [], 'completed'));
    const { wrapper } = createQueryWrapper();
    renderHook(() => useStepExecutions('inst-a', 'completed'), { wrapper });

    await waitFor(() => expect(getStepsMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getStepsMock).toHaveBeenCalledTimes(1);
  });

  it('switches in-flight requests when instanceId changes without leaking stale data', async () => {
    let resolveFirst: ((value: GetStepsResult) => void) | null = null;
    getStepsMock.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );
    getStepsMock.mockResolvedValueOnce(result('inst-b', [
      entry('s-b', buildStepExecution({ id: 'ex-b', instanceId: 'inst-b' })),
    ]));

    const { wrapper } = createQueryWrapper();
    const { result: r, rerender } = renderHook(
      ({ id }: { id: string }) => useStepExecutions(id, 'running'),
      { wrapper, initialProps: { id: 'inst-a' } },
    );

    rerender({ id: 'inst-b' });
    await waitFor(() => expect(r.current.data.map((e) => e.id)).toEqual(['ex-b']));

    resolveFirst?.(result('inst-a', [entry('s-stale', buildStepExecution({ id: 'ex-stale' }))]));
    expect(r.current.data.map((e) => e.id)).toEqual(['ex-b']);
  });
});
