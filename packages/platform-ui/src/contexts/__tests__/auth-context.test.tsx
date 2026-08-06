import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { API_ERROR_EVENT } from '@/lib/api-error-events';

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated', update: vi.fn() }),
  signIn: vi.fn(),
  signOut: vi.fn(),
  getProviders: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/mediforce', () => ({
  mediforce: { users: { clearMustChangePassword: vi.fn() } },
  ApiError: class extends Error {},
}));

vi.mock('@/hooks/use-user-me', () => ({
  useUserMe: () => ({ data: undefined, isError: false }),
}));

const { AuthProvider, useAuth, CredentialsSignInError } = await import('../auth-context');

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('AuthProvider — password sign-in', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 401, statusText: 'Unauthorized' })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not raise the global session-expiry toast for wrong credentials', async () => {
    const listener = vi.fn();
    window.addEventListener(API_ERROR_EVENT, listener);
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => wrapper({ children: <AuthProvider>{children}</AuthProvider> }),
    });

    await expect(result.current.signInWithEmail('user@example.com', 'wrong')).rejects.toBeInstanceOf(
      CredentialsSignInError,
    );
    await waitFor(() => expect(result.current.passwordAuthEnabled).not.toBeNull());

    window.removeEventListener(API_ERROR_EVENT, listener);
    expect(listener).not.toHaveBeenCalled();
  });
});
