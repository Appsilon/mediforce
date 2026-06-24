import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildRawUrl, resolveCommitSha } from '../_github';
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

describe('resolveCommitSha', () => {
  const SHA = 'abc1234abc1234abc1234abc1234abc1234abc12'; // 40 hex chars
  const REPO = 'https://github.com/Appsilon/mediforce-workflows';

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a full 40-char SHA as-is without any network call', async () => {
    expect(await resolveCommitSha(REPO, SHA)).toBe(SHA);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('resolves a branch ref via the GitHub commits API and trims the SHA', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(`${SHA}\n`),
    } as Response);

    expect(await resolveCommitSha(REPO, 'main')).toBe(SHA);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      'https://api.github.com/repos/Appsilon/mediforce-workflows/commits/main',
    );
  });

  it('throws "not found" on 404', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404 } as Response);
    await expect(resolveCommitSha(REPO, 'no-such-tag')).rejects.toThrow(/not found/i);
  });

  it('throws "rate limit" on 403', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 403 } as Response);
    await expect(resolveCommitSha(REPO, 'main')).rejects.toThrow(/rate limit/i);
  });

  it('throws for a non-GitHub host before any network call', async () => {
    await expect(resolveCommitSha('https://gitlab.com/org/repo', 'main')).rejects.toThrow(
      ValidationError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
