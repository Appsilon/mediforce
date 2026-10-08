import { describe, it, expect } from 'vitest';
import { adminBackHref, routes } from '../routes';

describe('admin routes', () => {
  it('carries the entry point so the back arrow can return to it', () => {
    expect(routes.adminOAuthProviders('acme', { from: 'mcp' })).toBe('/acme/admin/oauth-providers?from=mcp');
    expect(routes.adminOAuthProviders('acme', { from: 'settings' })).toBe(
      '/acme/admin/oauth-providers?from=settings',
    );
    expect(routes.adminOAuthProviders('acme')).toBe('/acme/admin/oauth-providers');
  });
});

describe('mcp route', () => {
  it('opens a catalog entry or the add dialog through the query', () => {
    expect(routes.mcp('acme')).toBe('/acme/mcp');
    expect(routes.mcp('acme', { id: 'github mcp' })).toBe('/acme/mcp?id=github+mcp');
    expect(routes.mcp('acme', { create: true })).toBe('/acme/mcp?new=1');
  });
});

describe('adminBackHref', () => {
  it('returns to the MCP page when that is where the user came from', () => {
    expect(adminBackHref('acme', 'mcp')).toBe('/acme/mcp');
  });

  it('falls back to settings for a direct visit or an unknown entry point', () => {
    expect(adminBackHref('acme', null)).toBe('/acme/settings');
    expect(adminBackHref('acme', 'workflows')).toBe('/acme/settings');
  });
});
