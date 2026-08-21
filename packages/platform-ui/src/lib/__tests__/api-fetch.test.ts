import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../api-fetch';

describe('apiFetch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports 4xx responses to the browser error channel', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 403, statusText: 'Forbidden' })),
    );

    let detail: { status: number; message: string } | undefined;
    const listener = (event: Event) => {
      detail = (event as CustomEvent<{ status: number; message: string }>).detail;
    };
    window.addEventListener('mediforce:api-error', listener);

    await apiFetch('/api/workspaces/secret');

    window.removeEventListener('mediforce:api-error', listener);
    expect(detail).toEqual({ status: 403, message: 'Forbidden' });
  });

  it('can silence expected 4xx responses used for capability discovery', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 404, statusText: 'Not Found' })),
    );
    const listener = vi.fn();
    window.addEventListener('mediforce:api-error', listener);

    await apiFetch('/api/auth/password-login', { reportErrors: false });

    window.removeEventListener('mediforce:api-error', listener);
    expect(listener).not.toHaveBeenCalled();
  });
});
