import { describe, it, expect } from 'vitest';
import { adminBackHref, routes } from '../routes';

describe('admin routes', () => {
  it('carries the entry point so the back arrow can return to it', () => {
    expect(routes.adminToolCatalog('acme', { from: 'tools' })).toBe('/acme/admin/tool-catalog?from=tools');
    expect(routes.adminOAuthProviders('acme', { from: 'settings' })).toBe(
      '/acme/admin/oauth-providers?from=settings',
    );
    expect(routes.adminToolCatalog('acme')).toBe('/acme/admin/tool-catalog');
  });
});

describe('adminBackHref', () => {
  it('returns to tools when that is where the user came from', () => {
    expect(adminBackHref('acme', 'tools')).toBe('/acme/tools');
  });

  it('falls back to settings for a direct visit or an unknown entry point', () => {
    expect(adminBackHref('acme', null)).toBe('/acme/settings');
    expect(adminBackHref('acme', 'workflows')).toBe('/acme/settings');
  });
});
