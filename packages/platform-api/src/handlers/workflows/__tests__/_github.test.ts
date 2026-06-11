import { describe, it, expect } from 'vitest';
import { buildRawUrl } from '../_github';
import { ValidationError } from '../../../errors';

describe('buildRawUrl', () => {
  it('converts a canonical GitHub repo URL to a raw.githubusercontent.com URL', () => {
    const result = buildRawUrl(
      'https://github.com/Appsilon/mediforce-workflows',
      'main',
      'workflow-designer/workflow-designer.wd.json',
    );
    expect(result).toBe(
      'https://raw.githubusercontent.com/Appsilon/mediforce-workflows/main/workflow-designer/workflow-designer.wd.json',
    );
  });

  it('strips a trailing .git suffix from the repo URL', () => {
    const result = buildRawUrl(
      'https://github.com/Appsilon/mediforce-workflows.git',
      'main',
      'wf.wd.json',
    );
    expect(result).toBe(
      'https://raw.githubusercontent.com/Appsilon/mediforce-workflows/main/wf.wd.json',
    );
  });

  it('throws ValidationError for non-GitHub hosts', () => {
    expect(() => buildRawUrl('https://gitlab.com/org/repo', 'main', 'wf.wd.json')).toThrow(
      ValidationError,
    );
  });

  it('throws ValidationError for repo URLs with sub-paths (e.g. /tree/main)', () => {
    expect(() =>
      buildRawUrl('https://github.com/Appsilon/mediforce-workflows/tree/main', 'main', 'wf.wd.json'),
    ).toThrow(ValidationError);
  });

  it('throws ValidationError for a bare owner-only URL', () => {
    expect(() =>
      buildRawUrl('https://github.com/Appsilon', 'main', 'wf.wd.json'),
    ).toThrow(ValidationError);
  });

  it('throws ValidationError for an invalid URL string', () => {
    expect(() => buildRawUrl('not-a-url', 'main', 'wf.wd.json')).toThrow(ValidationError);
  });
});
