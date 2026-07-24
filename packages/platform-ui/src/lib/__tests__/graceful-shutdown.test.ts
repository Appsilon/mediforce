import { describe, it, expect, vi } from 'vitest';
import {
  markInFlightExecutionsInterrupted,
  rekickInterruptedRuns,
} from '../graceful-shutdown';

describe('markInFlightExecutionsInterrupted', () => {
  it('marks every in-flight execution interrupted with a completedAt + reason', async () => {
    const updateStepExecution = vi.fn().mockResolvedValue(undefined);
    const marked = await markInFlightExecutionsInterrupted({
      instanceRepo: { updateStepExecution },
      inFlight: () => [
        ['run-1', 'exec-1'],
        ['run-2', 'exec-2'],
      ],
      now: () => new Date('2026-07-21T12:00:00.000Z'),
    });

    expect(marked).toBe(2);
    expect(updateStepExecution).toHaveBeenCalledTimes(2);
    expect(updateStepExecution).toHaveBeenCalledWith('run-1', 'exec-1', expect.objectContaining({
      status: 'interrupted',
      completedAt: '2026-07-21T12:00:00.000Z',
      error: expect.stringContaining('shutdown'),
    }));
    expect(updateStepExecution).toHaveBeenCalledWith('run-2', 'exec-2', expect.objectContaining({
      status: 'interrupted',
    }));
  });

  it('no-ops when nothing is in flight', async () => {
    const updateStepExecution = vi.fn();
    const marked = await markInFlightExecutionsInterrupted({
      instanceRepo: { updateStepExecution },
      inFlight: () => [],
    });
    expect(marked).toBe(0);
    expect(updateStepExecution).not.toHaveBeenCalled();
  });

  it('counts only the writes that succeed — a failing write does not starve the rest', async () => {
    const updateStepExecution = vi.fn()
      .mockRejectedValueOnce(new Error('db timeout'))
      .mockResolvedValueOnce(undefined);
    const marked = await markInFlightExecutionsInterrupted({
      instanceRepo: { updateStepExecution },
      inFlight: () => [
        ['run-1', 'exec-1'],
        ['run-2', 'exec-2'],
      ],
    });
    expect(marked).toBe(1);
    expect(updateStepExecution).toHaveBeenCalledTimes(2);
  });
});

describe('rekickInterruptedRuns', () => {
  const runningInstance = (over: Record<string, unknown>) => ({
    id: 'run-x', currentStepId: 'step-a', ...over,
  });

  it('re-kicks only running instances whose current execution is interrupted', async () => {
    const getByStatusAll = vi.fn().mockResolvedValue([
      runningInstance({ id: 'run-interrupted', currentStepId: 'step-a' }),
      runningInstance({ id: 'run-live', currentStepId: 'step-b' }),
      runningInstance({ id: 'run-no-step', currentStepId: null }),
    ]);
    const getLatestStepExecution = vi.fn().mockImplementation((id: string) => {
      if (id === 'run-interrupted') return Promise.resolve({ status: 'interrupted' });
      if (id === 'run-live') return Promise.resolve({ status: 'running' });
      return Promise.resolve(null);
    });
    const kick = vi.fn().mockResolvedValue(undefined);

    const rekicked = await rekickInterruptedRuns({
      instanceRepo: { getByStatusAll, getLatestStepExecution },
      runKicker: { kick },
    });

    expect(rekicked).toEqual(['run-interrupted']);
    expect(getByStatusAll).toHaveBeenCalledWith('running');
    expect(kick).toHaveBeenCalledTimes(1);
    expect(kick).toHaveBeenCalledWith('run-interrupted', { triggeredBy: 'boot-rekick-interrupted' });
    // The run with a null currentStepId is skipped before any execution lookup.
    expect(getLatestStepExecution).not.toHaveBeenCalledWith('run-no-step', expect.anything());
  });

  it('re-kicks nothing when no interrupted runs exist', async () => {
    const kick = vi.fn();
    const rekicked = await rekickInterruptedRuns({
      instanceRepo: {
        getByStatusAll: vi.fn().mockResolvedValue([runningInstance({ id: 'run-live' })]),
        getLatestStepExecution: vi.fn().mockResolvedValue({ status: 'running' }),
      },
      runKicker: { kick },
    });
    expect(rekicked).toEqual([]);
    expect(kick).not.toHaveBeenCalled();
  });
});
