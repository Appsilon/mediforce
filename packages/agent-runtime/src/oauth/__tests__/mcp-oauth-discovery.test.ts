import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deriveProviderSlug,
  discoverMcpAuthServer,
  extractResourceMetadataUrl,
  McpDiscoveryError,
} from '../mcp-oauth-discovery.js';

describe('extractResourceMetadataUrl', () => {
  it('pulls the URL out of an RFC 9728 challenge header', () => {
    const header =
      'Bearer error="invalid_token", resource_metadata="https://example.com/.well-known/oauth-protected-resource/mcp"';
    expect(extractResourceMetadataUrl(header)).toBe(
      'https://example.com/.well-known/oauth-protected-resource/mcp',
    );
  });

  it('returns null when the header is absent or missing the hint', () => {
    expect(extractResourceMetadataUrl(null)).toBeNull();
    expect(extractResourceMetadataUrl('Bearer realm="x"')).toBeNull();
  });
});

describe('deriveProviderSlug', () => {
  it('collapses issuer hostnames into a safe slug', () => {
    expect(deriveProviderSlug('https://readwise.io/o/')).toBe('readwise-io');
    expect(deriveProviderSlug('https://auth.example.com/oauth2')).toBe('auth-example-com');
  });
});

describe('discoverMcpAuthServer', () => {
  const originalFetch = globalThis.fetch;
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockJsonResponse(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  }

  it('follows the challenge hint → resource metadata → AS metadata', async () => {
    const resourceUrl = 'https://mcp.example.com/mcp';
    fetchMock.mockImplementationOnce(async () => {
      return new Response('{"error":"invalid_token"}', {
        status: 401,
        headers: {
          'WWW-Authenticate':
            'Bearer error="invalid_token", resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"',
        },
      });
    });
    fetchMock.mockImplementationOnce(async () =>
      mockJsonResponse({
        resource: resourceUrl,
        authorization_servers: ['https://as.example.com/o'],
        scopes_supported: ['openid', 'read'],
      }),
    );
    fetchMock.mockImplementationOnce(async () =>
      mockJsonResponse({
        issuer: 'https://as.example.com/o',
        authorization_endpoint: 'https://as.example.com/o/authorize',
        token_endpoint: 'https://as.example.com/o/token',
        registration_endpoint: 'https://as.example.com/o/register',
        revocation_endpoint: 'https://as.example.com/o/revoke',
        scopes_supported: ['openid', 'read', 'write'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'none'],
      }),
    );

    const result = await discoverMcpAuthServer(resourceUrl);
    expect(result.resourceUrl).toBe(resourceUrl);
    expect(result.resourceMetadata.authorization_servers).toEqual(['https://as.example.com/o']);
    expect(result.authServer.registration_endpoint).toBe('https://as.example.com/o/register');
    expect(result.authServer.token_endpoint_auth_methods_supported).toEqual([
      'client_secret_basic',
      'none',
    ]);
  });

  it('falls back to .well-known/oauth-protected-resource when no hint is provided', async () => {
    const resourceUrl = 'https://mcp.example.com/api';
    fetchMock.mockImplementationOnce(async () =>
      new Response('{"error":"invalid_token"}', { status: 401, headers: {} }),
    );
    fetchMock.mockImplementationOnce(async (input) => {
      expect(String(input)).toBe(
        'https://mcp.example.com/.well-known/oauth-protected-resource/api',
      );
      return mockJsonResponse({
        resource: resourceUrl,
        authorization_servers: ['https://as.example.com/'],
      });
    });
    fetchMock.mockImplementationOnce(async () =>
      mockJsonResponse({
        issuer: 'https://as.example.com/',
        authorization_endpoint: 'https://as.example.com/authorize',
        token_endpoint: 'https://as.example.com/token',
      }),
    );

    const result = await discoverMcpAuthServer(resourceUrl);
    expect(result.authServer.issuer).toBe('https://as.example.com/');
  });

  it('throws McpDiscoveryError when resource metadata is malformed', async () => {
    fetchMock.mockImplementationOnce(async () =>
      new Response('', {
        status: 401,
        headers: {
          'WWW-Authenticate':
            'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"',
        },
      }),
    );
    fetchMock.mockImplementationOnce(async () => mockJsonResponse({ resource: 'x' }));

    await expect(discoverMcpAuthServer('https://mcp.example.com/mcp')).rejects.toBeInstanceOf(
      McpDiscoveryError,
    );
  });

  it('tries openid-configuration when oauth-authorization-server 404s', async () => {
    const resourceUrl = 'https://mcp.example.com/mcp';
    fetchMock.mockImplementationOnce(async () =>
      new Response('', {
        status: 401,
        headers: {
          'WWW-Authenticate':
            'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"',
        },
      }),
    );
    fetchMock.mockImplementationOnce(async () =>
      mockJsonResponse({
        resource: resourceUrl,
        authorization_servers: ['https://as.example.com'],
      }),
    );
    fetchMock.mockImplementationOnce(async () => new Response('', { status: 404 }));
    fetchMock.mockImplementationOnce(async () =>
      mockJsonResponse({
        issuer: 'https://as.example.com',
        authorization_endpoint: 'https://as.example.com/authorize',
        token_endpoint: 'https://as.example.com/token',
      }),
    );

    const result = await discoverMcpAuthServer(resourceUrl);
    expect(result.authServer.issuer).toBe('https://as.example.com');
  });
});
