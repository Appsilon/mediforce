import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DcrError, pickAuthMethod, registerOAuthClient } from '../dcr-client.js';

describe('pickAuthMethod', () => {
  it('prefers client_secret_basic, then post, then none', () => {
    expect(pickAuthMethod(['none', 'client_secret_basic', 'client_secret_post'])).toBe(
      'client_secret_basic',
    );
    expect(pickAuthMethod(['none', 'client_secret_post'])).toBe('client_secret_post');
    expect(pickAuthMethod(['none'])).toBe('none');
  });

  it('defaults to client_secret_basic when the AS did not advertise', () => {
    expect(pickAuthMethod(undefined)).toBe('client_secret_basic');
    expect(pickAuthMethod([])).toBe('client_secret_basic');
  });
});

describe('registerOAuthClient', () => {
  const originalFetch = globalThis.fetch;
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('posts a RFC 7591 body and returns the normalized client credentials', async () => {
    fetchMock.mockImplementationOnce(async (input, init) => {
      expect(input).toBe('https://as.example.com/register');
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.client_name).toBe('Mediforce (ns) — readwise');
      expect(body.redirect_uris).toEqual(['https://app.example.com/callback']);
      expect(body.grant_types).toEqual(['authorization_code', 'refresh_token']);
      expect(body.response_types).toEqual(['code']);
      expect(body.token_endpoint_auth_method).toBe('client_secret_basic');
      expect(body.scope).toBe('openid read write');
      return new Response(
        JSON.stringify({
          client_id: 'cid',
          client_secret: 'sec',
          token_endpoint_auth_method: 'client_secret_basic',
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const result = await registerOAuthClient('https://as.example.com/register', {
      clientName: 'Mediforce (ns) — readwise',
      redirectUris: ['https://app.example.com/callback'],
      scopes: ['openid', 'read', 'write'],
      tokenEndpointAuthMethod: 'client_secret_basic',
    });

    expect(result).toEqual({
      client_id: 'cid',
      client_secret: 'sec',
      token_endpoint_auth_method: 'client_secret_basic',
    });
  });

  it('handles public clients that omit client_secret', async () => {
    fetchMock.mockImplementationOnce(async () =>
      new Response(
        JSON.stringify({ client_id: 'public-cid', token_endpoint_auth_method: 'none' }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await registerOAuthClient('https://as.example.com/register', {
      clientName: 'ns-server',
      redirectUris: ['https://app.example.com/cb'],
      scopes: ['read'],
      tokenEndpointAuthMethod: 'none',
    });

    expect(result.client_id).toBe('public-cid');
    expect(result.client_secret).toBeUndefined();
  });

  it('throws DcrError with the provider-reported code on non-2xx', async () => {
    fetchMock.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ error: 'invalid_redirect_uri' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(
      registerOAuthClient('https://as.example.com/register', {
        clientName: 'x',
        redirectUris: ['not-a-url'],
        scopes: ['read'],
        tokenEndpointAuthMethod: 'client_secret_basic',
      }),
    ).rejects.toMatchObject({ name: 'DcrError', detail: 'invalid_redirect_uri' });
  });

  it('throws DcrError when the response lacks client_id', async () => {
    fetchMock.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ nope: true }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(
      registerOAuthClient('https://as.example.com/register', {
        clientName: 'x',
        redirectUris: ['https://app.example.com/cb'],
        scopes: ['read'],
        tokenEndpointAuthMethod: 'client_secret_basic',
      }),
    ).rejects.toBeInstanceOf(DcrError);
  });
});
