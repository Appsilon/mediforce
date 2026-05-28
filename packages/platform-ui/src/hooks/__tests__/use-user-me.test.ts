import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { GetMeOutput } from '@mediforce/platform-api/contract';
import { createQueryWrapper } from '@/test/react-query';

const meMock = vi.fn<(...args: unknown[]) => Promise<GetMeOutput>>();
class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
vi.mock('@/lib/mediforce', () => ({
  mediforce: { users: { me: meMock } },
  ApiError,
}));

const { useUserMe } = await import('../use-user-me');

const SAMPLE: GetMeOutput = {
  user: { uid: 'uid-marek', email: 'marek@example.test', displayName: 'Marek' },
  namespaces: [
    { handle: 'marek', type: 'personal', displayName: 'Marek', role: 'owner' },
    { handle: 'acme', type: 'organization', displayName: 'Acme Co.', role: 'admin' },
  ],
};

describe('useUserMe', () => {
  beforeEach(() => {
    meMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not call the API when disabled (e.g. signed-out)', () => {
    const { wrapper } = createQueryWrapper();
    renderHook(() => useUserMe({ enabled: false }), { wrapper });

    expect(meMock).not.toHaveBeenCalled();
  });

  it('fetches and exposes the bundle once the request resolves', async () => {
    meMock.mockResolvedValue(SAMPLE);
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useUserMe(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(meMock).toHaveBeenCalledTimes(1);
    expect(result.current.data?.user.uid).toBe('uid-marek');
    expect(result.current.data?.namespaces).toHaveLength(2);
  });

  it('surfaces a 4xx error without retrying', async () => {
    const err = new ApiError(403, 'forbidden');
    meMock.mockRejectedValue(err);
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useUserMe(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(err);
    expect(meMock).toHaveBeenCalledTimes(1);
  });

  it('shares one fetch across two consumers mounted on the same client (dedup)', async () => {
    meMock.mockResolvedValue(SAMPLE);
    const { wrapper } = createQueryWrapper();

    const a = renderHook(() => useUserMe(), { wrapper });
    const b = renderHook(() => useUserMe(), { wrapper });

    await waitFor(() => expect(a.result.current.isLoading).toBe(false));
    await waitFor(() => expect(b.result.current.isLoading).toBe(false));
    expect(meMock).toHaveBeenCalledTimes(1);
  });

  it('toggles from disabled to enabled and then fetches', async () => {
    meMock.mockResolvedValue(SAMPLE);
    const { wrapper } = createQueryWrapper();

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useUserMe({ enabled }),
      { wrapper, initialProps: { enabled: false } },
    );

    expect(meMock).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(meMock).toHaveBeenCalledTimes(1);
    expect(result.current.data?.user.uid).toBe('uid-marek');
  });
});
