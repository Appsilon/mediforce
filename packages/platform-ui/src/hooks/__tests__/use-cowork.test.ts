import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { CoworkSession } from '@mediforce/platform-core';
import { buildCoworkSession } from '@mediforce/platform-core/testing';
import { createQueryWrapper } from '@/test/react-query';

const getMock = vi.fn<(...args: unknown[]) => Promise<CoworkSession>>();
class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
vi.mock('@/lib/mediforce', () => ({
  mediforce: { cowork: { get: getMock } },
  ApiError,
}));

const { useCoworkSession, useCoworkTurns } = await import('../use-cowork');

describe('useCoworkSession', () => {
  beforeEach(() => {
    getMock.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not call the API when sessionId is undefined', () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useCoworkSession(undefined, false), { wrapper });

    expect(result.current.session).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(getMock).not.toHaveBeenCalled();
  });

  it('fetches and exposes the session once the request resolves', async () => {
    getMock.mockResolvedValue(buildCoworkSession({ id: 'sess-1' }));
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useCoworkSession('sess-1', false), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getMock).toHaveBeenCalledWith({ sessionId: 'sess-1' });
    expect(result.current.session?.id).toBe('sess-1');
  });

  it('stops polling once the session reaches finalized', async () => {
    getMock.mockResolvedValueOnce(buildCoworkSession({ id: 'sess-1', status: 'active' }));
    getMock.mockResolvedValue(buildCoworkSession({ id: 'sess-1', status: 'finalized' }));
    const { wrapper } = createQueryWrapper();

    renderHook(() => useCoworkSession('sess-1', false), { wrapper });

    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(5_500);
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getMock).toHaveBeenCalledTimes(2);
  });

  it('stops polling on 4xx error (no retry storm)', async () => {
    getMock.mockRejectedValue(new ApiError(400, 'Invalid'));
    const { wrapper } = createQueryWrapper();

    renderHook(() => useCoworkSession('sess-1', false), { wrapper });

    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it('signals notFound=true on 404 without surfacing as error', async () => {
    getMock.mockRejectedValue(new ApiError(404, 'Not found'));
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useCoworkSession('sess-1', false), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notFound).toBe(true);
    expect(result.current.error).toBeNull();
  });
});

describe('useCoworkTurns — isSending cadence flip', () => {
  beforeEach(() => {
    getMock.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls every 5 s while idle', async () => {
    getMock.mockResolvedValue(
      buildCoworkSession({ id: 'sess-1', status: 'active' }),
    );
    const { wrapper } = createQueryWrapper();

    renderHook(() => useCoworkTurns('sess-1', false), { wrapper });

    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(5_500);
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
  });

  it('polls every 1 s while isSending=true (CRITICAL LIVE)', async () => {
    getMock.mockResolvedValue(
      buildCoworkSession({ id: 'sess-1', status: 'active' }),
    );
    const { wrapper } = createQueryWrapper();

    renderHook(() => useCoworkTurns('sess-1', true), { wrapper });

    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(1_100);
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(1_100);
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(3));
  });

  it('returns just the turns array (selector)', async () => {
    const session = buildCoworkSession({ id: 'sess-1' });
    session.turns = [
      {
        id: 't-1',
        role: 'human',
        content: 'hi',
        timestamp: session.createdAt,
        artifactDelta: null,
      },
    ];
    getMock.mockResolvedValue(session);
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useCoworkTurns('sess-1', false), { wrapper });

    await waitFor(() => expect(result.current.turns.length).toBe(1));
    expect(result.current.turns[0].id).toBe('t-1');
  });

  it('queryFn preserves optimistic prepends not yet visible on the server', async () => {
    // Race scenario: refetchInterval ticks after onMutate has prepended an
    // optimistic turn but before the server has persisted the human turn.
    // The queryFn must merge optimistic-prefixed cache entries instead of
    // overwriting them with the stale server turns.
    const { wrapper, queryClient } = createQueryWrapper();
    const optimistic = {
      id: 'optimistic-abc',
      role: 'human' as const,
      content: 'still flying',
      timestamp: '2026-05-28T00:00:00.000Z',
      artifactDelta: null,
    };
    queryClient.setQueryData(
      ['cowork', 'sess-1', 'turns'],
      [optimistic],
    );
    getMock.mockResolvedValue(
      buildCoworkSession({ id: 'sess-1', turns: [] }),
    );

    renderHook(() => useCoworkTurns('sess-1', false), { wrapper });

    await waitFor(() => expect(getMock).toHaveBeenCalled());
    const cached = queryClient.getQueryData<typeof optimistic[]>([
      'cowork',
      'sess-1',
      'turns',
    ]);
    expect(cached?.some((t) => t.content === 'still flying')).toBe(true);
  });

  it('queryFn drops optimistic entries once the server has caught up', async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    const optimistic = {
      id: 'optimistic-abc',
      role: 'human' as const,
      content: 'now persisted',
      timestamp: '2026-05-28T00:00:00.000Z',
      artifactDelta: null,
    };
    queryClient.setQueryData(['cowork', 'sess-1', 'turns'], [optimistic]);
    const session = buildCoworkSession({ id: 'sess-1' });
    session.turns = [
      {
        id: 'srv-1',
        role: 'human',
        content: 'now persisted',
        timestamp: '2026-05-28T00:00:01.000Z',
        artifactDelta: null,
      },
    ];
    getMock.mockResolvedValue(session);

    renderHook(() => useCoworkTurns('sess-1', false), { wrapper });

    await waitFor(() => expect(getMock).toHaveBeenCalled());
    const cached = queryClient.getQueryData<typeof optimistic[]>([
      'cowork',
      'sess-1',
      'turns',
    ]);
    expect(cached?.length).toBe(1);
    expect(cached?.[0].id).toBe('srv-1');
  });
});
