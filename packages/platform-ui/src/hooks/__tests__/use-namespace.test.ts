import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createQueryWrapper } from '@/test/react-query';

const getNamespaceMock = vi.fn();
class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

vi.mock('@/lib/mediforce', () => ({
  mediforce: { namespaces: { get: getNamespaceMock } },
  ApiError,
}));

const { useNamespace } = await import('../use-namespace');

describe('useNamespace', () => {
  beforeEach(() => {
    getNamespaceMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('surfaces a 404 so the workspace shell can render an access error page', async () => {
    const error = new ApiError(404, 'Not found');
    getNamespaceMock.mockRejectedValue(error);
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useNamespace('private-workspace'), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe(error);
    expect(result.current.namespace).toBeNull();
    expect(result.current.accessDenied).toBe(true);
  });

  it('flags a 403 as an access error', async () => {
    getNamespaceMock.mockRejectedValue(new ApiError(403, 'Forbidden'));
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useNamespace('private-workspace'), { wrapper });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.accessDenied).toBe(true);
  });

  it('does not call a backend outage an access error', async () => {
    getNamespaceMock.mockRejectedValue(new ApiError(500, 'Internal Server Error'));
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useNamespace('my-workspace'), { wrapper });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.accessDenied).toBe(false);
  });

  it('does not call a network failure an access error', async () => {
    getNamespaceMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useNamespace('my-workspace'), { wrapper });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.accessDenied).toBe(false);
  });
});
