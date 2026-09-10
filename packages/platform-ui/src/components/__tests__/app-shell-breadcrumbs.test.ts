import { describe, it, expect } from 'vitest';
import { buildBreadcrumbs } from '../app-shell';

describe('buildBreadcrumbs', () => {
  it('titles a step the way every other crumb is titled', () => {
    const crumbs = buildBreadcrumbs(
      '/test/workflows/tealflow/runs/abc123/steps/collect-application-requirements',
      'test',
      '/test',
    );
    expect(crumbs.map((crumb) => crumb.label)).toEqual([
      'Workflows',
      'Tealflow',
      'Run',
      'Collect Application Requirements',
    ]);
  });

  it('leaves capitals a step id already carries alone', () => {
    const crumbs = buildBreadcrumbs(
      '/test/workflows/landing-zone/runs/abc/steps/validate-CDISC-extract',
      'test',
      '/test',
    );
    expect(crumbs[crumbs.length - 1].label).toBe('Validate CDISC Extract');
  });
});
