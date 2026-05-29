import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { CoworkSession } from '@mediforce/platform-core';
import { buildCoworkSession } from '@mediforce/platform-core/testing';
import { createQueryWrapper } from '@/test/react-query';

const getByInstanceMock = vi.fn<(...args: unknown[]) => Promise<CoworkSession>>();
class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
vi.mock('@/lib/mediforce', () => ({
  mediforce: { cowork: { getByInstance: getByInstanceMock } },
  ApiError,
}));
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  where: vi.fn(),
  orderBy: vi.fn(),
}));

const { useActiveCoworkSession } = await import('../use-tasks');

describe('useActiveCoworkSession', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getByInstanceMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not call the API when instanceId is null', () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useActiveCoworkSession(null), { wrapper });

    expect(result.current.session).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(getByInstanceMock).not.toHaveBeenCalled();
  });

  it('returns the active session for the instance', async () => {
    const session = buildCoworkSession({ id: 'sess-1', status: 'active' });
    getByInstanceMock.mockResolvedValue(session);

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useActiveCoworkSession('inst-a'), { wrapper });

    await vi.waitFor(() => expect(result.current.loading).toBe(false));
    expect(getByInstanceMock).toHaveBeenCalledWith({ instanceId: 'inst-a' });
    expect(result.current.session?.id).toBe('sess-1');
  });

  it('returns null when the session exists but is not active', async () => {
    getByInstanceMock.mockResolvedValue(
      buildCoworkSession({ id: 'sess-final', status: 'finalized' }),
    );

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useActiveCoworkSession('inst-a'), { wrapper });

    await vi.waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.session).toBeNull();
  });

  it('returns null on 404 (no session yet) and stops polling', async () => {
    getByInstanceMock.mockRejectedValue(new ApiError(404, 'not found'));

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useActiveCoworkSession('inst-a'), { wrapper });

    await vi.waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.session).toBeNull();
    expect(getByInstanceMock).toHaveBeenCalledTimes(1);

    // Advance well past the 1.5 s critical-live interval — the 404 must have
    // disarmed refetchInterval; otherwise the server gets hammered for
    // every instance page without a cowork session.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getByInstanceMock).toHaveBeenCalledTimes(1);
  });

  it('switches in-flight requests when instanceId changes without leaking stale data', async () => {
    let resolveFirst: ((value: CoworkSession) => void) | null = null;
    getByInstanceMock.mockImplementationOnce(
      () => new Promise<CoworkSession>((resolve) => { resolveFirst = resolve; }),
    );
    getByInstanceMock.mockResolvedValueOnce(
      buildCoworkSession({ id: 'sess-b', status: 'active' }),
    );

    const { wrapper } = createQueryWrapper();
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useActiveCoworkSession(id),
      { wrapper, initialProps: { id: 'inst-a' as string | null } },
    );

    rerender({ id: 'inst-b' });
    await vi.waitFor(() => expect(result.current.session?.id).toBe('sess-b'));

    resolveFirst?.(buildCoworkSession({ id: 'sess-stale', status: 'active' }));
    expect(result.current.session?.id).toBe('sess-b');
  });
});
