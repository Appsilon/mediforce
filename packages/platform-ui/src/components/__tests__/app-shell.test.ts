import { describe, it, expect } from 'vitest';
import { buildSwitchHref } from '../app-shell';

describe('buildSwitchHref', () => {
  it('preserves a stable list section when switching workspace', () => {
    expect(buildSwitchHref('/acme/runs', 'acme', 'globex')).toBe('/globex/runs');
  });

  it('preserves the agents section across workspaces', () => {
    expect(buildSwitchHref('/acme/agents/models', 'acme', 'globex')).toBe('/globex/agents/models');
  });

  it('falls back to the target workspace root for a workflow detail route', () => {
    expect(buildSwitchHref('/acme/workflows/signal-screen', 'acme', 'globex')).toBe('/globex');
  });

  it('falls back to the target workspace root for a run detail route', () => {
    expect(buildSwitchHref('/acme/workflows/signal-screen/runs/abc-123', 'acme', 'globex')).toBe('/globex');
  });

  it('falls back to the target workspace root when already on the workspace home', () => {
    expect(buildSwitchHref('/acme', 'acme', 'globex')).toBe('/globex');
  });

  it('falls back to the target workspace root for an unrecognized section', () => {
    expect(buildSwitchHref('/acme/settings', 'acme', 'globex')).toBe('/globex');
  });

  it('treats every preserved section as switchable', () => {
    for (const section of ['/runs', '/agents', '/tools', '/tasks', '/monitoring']) {
      expect(buildSwitchHref(`/acme${section}`, 'acme', 'globex')).toBe(`/globex${section}`);
    }
  });

  it('handles a current handle that does not prefix the pathname', () => {
    expect(buildSwitchHref('/globex/runs', 'acme', 'globex')).toBe('/globex');
  });
});
