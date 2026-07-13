import { describe, it, expect } from 'vitest';
import { buildNamespaceSwitchHref } from '../namespace-switcher-utils';

describe('buildNamespaceSwitchHref', () => {
  it('preserves the section when switching between stable list routes', () => {
    expect(buildNamespaceSwitchHref('/acme/runs', 'acme', 'personal')).toBe('/personal/runs');
    expect(buildNamespaceSwitchHref('/acme/agents', 'acme', 'personal')).toBe('/personal/agents');
    expect(buildNamespaceSwitchHref('/acme/tools', 'acme', 'personal')).toBe('/personal/tools');
    expect(buildNamespaceSwitchHref('/acme/tasks', 'acme', 'personal')).toBe('/personal/tasks');
    expect(buildNamespaceSwitchHref('/acme/monitoring', 'acme', 'personal')).toBe('/personal/monitoring');
  });

  it('lands on the target workspace root from the workspace home', () => {
    expect(buildNamespaceSwitchHref('/acme', 'acme', 'personal')).toBe('/personal');
  });

  it('falls back to the target workspace root for resource-detail routes', () => {
    expect(buildNamespaceSwitchHref('/acme/agents/some-agent', 'acme', 'personal')).toBe('/personal');
    expect(buildNamespaceSwitchHref('/acme/workflows/biomedical-report', 'acme', 'personal')).toBe('/personal');
    expect(buildNamespaceSwitchHref('/acme/workflows/biomedical-report/runs/abc', 'acme', 'personal')).toBe('/personal');
  });

  it('falls back to the target root for action routes', () => {
    expect(buildNamespaceSwitchHref('/acme/agents/new', 'acme', 'personal')).toBe('/personal');
    expect(buildNamespaceSwitchHref('/acme/workflows/new', 'acme', 'personal')).toBe('/personal');
  });

  it('normalizes a trailing slash on a stable list route', () => {
    expect(buildNamespaceSwitchHref('/acme/runs/', 'acme', 'personal')).toBe('/personal/runs');
  });

  it('treats an unmatched current handle as root and still lands on root', () => {
    expect(buildNamespaceSwitchHref('/unknown/runs', 'acme', 'personal')).toBe('/personal');
  });
});
