import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { AgentEvent } from '@mediforce/platform-core';
import { buildAgentEvent } from '@mediforce/platform-core/testing';
import { createQueryWrapper } from '@/test/react-query';

const agentEventsMock = vi.fn<(...args: unknown[]) => Promise<{ events: AgentEvent[] }>>();
class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
vi.mock('@/lib/mediforce', () => ({
  mediforce: { processes: { agentEvents: agentEventsMock } },
  ApiError,
}));

const { useAgentEvents } = await import('../use-agent-events');

describe('useAgentEvents', () => {
  beforeEach(() => {
    agentEventsMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('does not call the API when instanceId is null', () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useAgentEvents(null, null, 'running'), { wrapper });
    expect(result.current.data).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(agentEventsMock).not.toHaveBeenCalled();
  });

  it('returns events in the order the server returned them (sequence ASC)', async () => {
    agentEventsMock.mockResolvedValue({
      events: [
        buildAgentEvent({ id: 'e-1', sequence: 0 }),
        buildAgentEvent({ id: 'e-2', sequence: 1 }),
        buildAgentEvent({ id: 'e-3', sequence: 2 }),
      ],
    });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useAgentEvents('inst-a', null, 'running'), { wrapper });

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    // First fetch has no cursor → full log.
    expect(agentEventsMock).toHaveBeenCalledWith({
      instanceId: 'inst-a',
      stepId: undefined,
    });
    expect(result.current.data.map((e) => e.sequence)).toEqual([0, 1, 2]);
  });

  it('passes the stepId filter through to the client call', async () => {
    agentEventsMock.mockResolvedValue({ events: [] });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useAgentEvents('inst-a', 'step-analyze', 'running'), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(agentEventsMock).toHaveBeenCalledWith({
      instanceId: 'inst-a',
      stepId: 'step-analyze',
      afterSequence: undefined,
    });
  });

  // `sequence` cannot carry a cursor — it restarts at 0 per step, and per worker
  // lifetime — so every poll re-reads the log and merges by id.
  it('re-reads the full log on every poll and accumulates by id', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    agentEventsMock
      .mockResolvedValueOnce({
        events: [
          buildAgentEvent({ id: 'e-1', stepId: 'extract', sequence: 0 }),
          buildAgentEvent({ id: 'e-2', stepId: 'extract', sequence: 1 }),
        ],
      })
      .mockResolvedValueOnce({
        events: [buildAgentEvent({ id: 'e-3', stepId: 'extract', sequence: 2 })],
      });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useAgentEvents('inst-a', 'extract', 'running'), { wrapper });

    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(agentEventsMock).toHaveBeenNthCalledWith(1, {
      instanceId: 'inst-a',
      stepId: 'extract',
    });

    await vi.advanceTimersByTimeAsync(2_000);
    await waitFor(() => expect(result.current.data).toHaveLength(3));
    expect(agentEventsMock).toHaveBeenNthCalledWith(2, {
      instanceId: 'inst-a',
      stepId: 'extract',
    });
    expect(result.current.data.map((e) => e.sequence)).toEqual([0, 1, 2]);
  });

  it('surfaces 4xx errors immediately and stops polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    agentEventsMock.mockRejectedValue(new ApiError(404, 'gone'));
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useAgentEvents('inst-a', null, 'running'), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(agentEventsMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(agentEventsMock).toHaveBeenCalledTimes(1);
  });

  it('stops polling when instanceStatus is terminal (failed)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    agentEventsMock.mockResolvedValue({ events: [] });
    const { wrapper } = createQueryWrapper();
    renderHook(() => useAgentEvents('inst-a', null, 'failed'), { wrapper });

    await waitFor(() => expect(agentEventsMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(agentEventsMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * `sequence` is assigned per (instance, step) — `PostgresAgentEventLog.write`
 * numbers from the length of that step's own events — so every step in a run
 * starts again at 0. Treating it as an instance-wide cursor loses events:
 * one step's entries overwrite another's, and a step that starts after an
 * earlier one has climbed past its sequence numbers is never fetched at all.
 */
describe('useAgentEvents across steps sharing sequence numbers', () => {
  it('keeps both steps\' events when their sequence numbers collide', async () => {
    agentEventsMock.mockResolvedValue({
      events: [
        buildAgentEvent({ id: 'extract-0', stepId: 'extract', sequence: 0 }),
        buildAgentEvent({ id: 'validate-0', stepId: 'validate', sequence: 0 }),
        buildAgentEvent({ id: 'validate-1', stepId: 'validate', sequence: 1 }),
      ],
    });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useAgentEvents('inst-a', null, 'running'), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.map((e) => e.id).sort()).toEqual(['extract-0', 'validate-0', 'validate-1']);
  });

  it('picks up a later step whose events restart at sequence 0', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    agentEventsMock.mockResolvedValueOnce({
      events: [
        buildAgentEvent({ id: 'extract-0', stepId: 'extract', sequence: 0 }),
        buildAgentEvent({ id: 'extract-1', stepId: 'extract', sequence: 1 }),
      ],
    });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useAgentEvents('inst-a', null, 'running'), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(2));

    // A second step begins, numbering from 0 again. An instance-wide cursor of
    // 1 would have asked for `sequence > 1` and never seen it.
    agentEventsMock.mockResolvedValue({
      events: [
        buildAgentEvent({ id: 'extract-0', stepId: 'extract', sequence: 0 }),
        buildAgentEvent({ id: 'extract-1', stepId: 'extract', sequence: 1 }),
        buildAgentEvent({ id: 'validate-0', stepId: 'validate', sequence: 0 }),
      ],
    });
    await vi.advanceTimersByTimeAsync(2_000);

    await waitFor(() => expect(result.current.data).toHaveLength(3));
    for (const call of agentEventsMock.mock.calls) {
      expect(call[0] as Record<string, unknown>).not.toHaveProperty('afterSequence');
    }
  });
});
