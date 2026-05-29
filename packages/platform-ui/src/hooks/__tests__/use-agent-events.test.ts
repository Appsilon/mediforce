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
      afterSequence: undefined,
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

  it('polls incrementally: first fetch full, then afterSequence cursor, accumulating deltas', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    agentEventsMock
      .mockResolvedValueOnce({
        events: [
          buildAgentEvent({ id: 'e-1', sequence: 0 }),
          buildAgentEvent({ id: 'e-2', sequence: 1 }),
        ],
      })
      .mockResolvedValueOnce({
        events: [buildAgentEvent({ id: 'e-3', sequence: 2 })],
      });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useAgentEvents('inst-a', null, 'running'), { wrapper });

    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(agentEventsMock).toHaveBeenNthCalledWith(1, {
      instanceId: 'inst-a',
      stepId: undefined,
      afterSequence: undefined,
    });

    await vi.advanceTimersByTimeAsync(2_000);
    await waitFor(() => expect(result.current.data).toHaveLength(3));
    // Second poll carries the max seen sequence (1) as the cursor.
    expect(agentEventsMock).toHaveBeenNthCalledWith(2, {
      instanceId: 'inst-a',
      stepId: undefined,
      afterSequence: 1,
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
