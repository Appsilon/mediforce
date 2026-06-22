import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { CoworkSession } from '@mediforce/platform-core';
import { buildCoworkSession } from '@mediforce/platform-core/testing';
import { createQueryWrapper } from '@/test/react-query';

const listMock = vi.fn<(...args: unknown[]) => Promise<{ sessions: CoworkSession[] }>>();
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
vi.mock('@/lib/mediforce', () => ({
  mediforce: { cowork: { list: listMock } },
  ApiError,
}));

const { useMyCoworkSessions, useFinalizedCoworkSessions } = await import('../use-tasks');

describe('useMyCoworkSessions', () => {
  beforeEach(() => {
    listMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls list with the provided role and active status, sorted createdAt asc', async () => {
    listMock.mockResolvedValue({
      sessions: [
        buildCoworkSession({ id: 's2', createdAt: '2024-02-01T00:00:00.000Z' }),
        buildCoworkSession({ id: 's1', createdAt: '2024-01-01T00:00:00.000Z' }),
      ],
    });

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useMyCoworkSessions('reviewer'), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listMock).toHaveBeenCalledWith({ role: 'reviewer', status: ['active'] });
    expect(result.current.data.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('passes role: undefined when role argument is null', async () => {
    listMock.mockResolvedValue({ sessions: [] });

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useMyCoworkSessions(null), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listMock).toHaveBeenCalledWith({ role: undefined, status: ['active'] });
  });

  it('surfaces errors and does not retry on 4xx', async () => {
    const err = new ApiError(403, 'forbidden');
    listMock.mockRejectedValue(err);

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useMyCoworkSessions('reviewer'), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(err);
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual([]);
  });
});

describe('useFinalizedCoworkSessions', () => {
  beforeEach(() => {
    listMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls list with finalized status and sorts finalizedAt desc', async () => {
    listMock.mockResolvedValue({
      sessions: [
        buildCoworkSession({ id: 'older', status: 'finalized', finalizedAt: '2024-01-01T00:00:00.000Z' }),
        buildCoworkSession({ id: 'newer', status: 'finalized', finalizedAt: '2024-03-01T00:00:00.000Z' }),
      ],
    });

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useFinalizedCoworkSessions('analyst'), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listMock).toHaveBeenCalledWith({ role: 'analyst', status: ['finalized'] });
    expect(result.current.data.map((s) => s.id)).toEqual(['newer', 'older']);
  });

  it('passes role: undefined when role argument is null', async () => {
    listMock.mockResolvedValue({ sessions: [] });

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useFinalizedCoworkSessions(null), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listMock).toHaveBeenCalledWith({ role: undefined, status: ['finalized'] });
  });
});

// PRD §9 rule 4: polling must stop on 4xx — covers both cowork session hooks.
describe('polling stops on 4xx error (PRD §9 rule 4)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    ['useMyCoworkSessions', () => useMyCoworkSessions('reviewer')],
    ['useFinalizedCoworkSessions', () => useFinalizedCoworkSessions('analyst')],
  ] as const)('%s stops polling after a 4xx error', async (_name, hookFactory) => {
    listMock.mockRejectedValue(new ApiError(403, 'forbidden'));
    const { wrapper } = createQueryWrapper();

    renderHook(hookFactory, { wrapper });

    await vi.waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(listMock).toHaveBeenCalledTimes(1);
  });
});
