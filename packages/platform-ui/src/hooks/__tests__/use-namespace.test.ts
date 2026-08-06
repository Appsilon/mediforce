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
  });
});
