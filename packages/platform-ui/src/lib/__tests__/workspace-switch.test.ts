import { describe, it, expect } from 'vitest';
import { workspaceSwitchHref } from '../workspace-switch';

describe('workspaceSwitchHref', () => {
  it('preserves the section when on a stable list route', () => {
    expect(workspaceSwitchHref('/acme/runs', 'acme', 'beta')).toBe('/beta/runs');
    expect(workspaceSwitchHref('/acme/agents', 'acme', 'beta')).toBe('/beta/agents');
    expect(workspaceSwitchHref('/acme/tools', 'acme', 'beta')).toBe('/beta/tools');
    expect(workspaceSwitchHref('/acme/tasks', 'acme', 'beta')).toBe('/beta/tasks');
    expect(workspaceSwitchHref('/acme/monitoring', 'acme', 'beta')).toBe('/beta/monitoring');
  });

  it('falls back to the workspace root for resource-detail routes', () => {
    expect(workspaceSwitchHref('/acme/runs/run-123', 'acme', 'beta')).toBe('/beta');
    expect(workspaceSwitchHref('/acme/agents/agent-9', 'acme', 'beta')).toBe('/beta');
    expect(workspaceSwitchHref('/acme/agents/models', 'acme', 'beta')).toBe('/beta');
    expect(workspaceSwitchHref('/acme/workflows/onboarding', 'acme', 'beta')).toBe('/beta');
    expect(workspaceSwitchHref('/acme/workflows/onboarding/runs/run-1', 'acme', 'beta')).toBe('/beta');
    expect(workspaceSwitchHref('/acme/workflows/onboarding/runs/run-1/steps/some-step', 'acme', 'beta')).toBe(
      '/beta',
    );
  });

  it('falls back to the workspace root when already on the home page', () => {
    expect(workspaceSwitchHref('/acme', 'acme', 'beta')).toBe('/beta');
    expect(workspaceSwitchHref('/acme/', 'acme', 'beta')).toBe('/beta');
  });

  it('falls back to root for an unknown top-level section', () => {
    expect(workspaceSwitchHref('/acme/settings', 'acme', 'beta')).toBe('/beta');
    expect(workspaceSwitchHref('/acme/catalog', 'acme', 'beta')).toBe('/beta');
  });

  it('tolerates a missing current handle (no workspace in path)', () => {
    expect(workspaceSwitchHref('/runs', '', 'beta')).toBe('/beta/runs');
    expect(workspaceSwitchHref('/runs/run-1', '', 'beta')).toBe('/beta');
  });
});
