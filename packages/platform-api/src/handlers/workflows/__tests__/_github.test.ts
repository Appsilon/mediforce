import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildRawUrl, resolveCommitSha, resolveGitHubSource } from '../_github';
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

  it('supports a GitHub tree URL as a scoped source directory', () => {
    const result = buildRawUrl(
      'https://github.com/Appsilon/mediforce/tree/main/docs/workflow-examples',
      'main',
      '01-linear-pipeline.wd.json',
    );
    expect(result).toBe(
      'https://raw.githubusercontent.com/Appsilon/mediforce/main/docs/workflow-examples/01-linear-pipeline.wd.json',
    );
  });

  it('uses the ref embedded in a GitHub tree URL when no ref is supplied', () => {
    const result = buildRawUrl(
      'https://github.com/Appsilon/mediforce/tree/release/docs/workflow-examples',
      undefined,
      '01-linear-pipeline.wd.json',
    );
    expect(result).toBe(
      'https://raw.githubusercontent.com/Appsilon/mediforce/release/docs/workflow-examples/01-linear-pipeline.wd.json',
    );
  });

  it('allows an explicit path prefix when fetching a resolved tree source', () => {
    const result = buildRawUrl(
      'https://github.com/Appsilon/mediforce',
      'abc1234abc1234abc1234abc1234abc1234abc12',
      '01-linear-pipeline.wd.json',
      'docs/workflow-examples',
    );
    expect(result).toBe(
      'https://raw.githubusercontent.com/Appsilon/mediforce/abc1234abc1234abc1234abc1234abc1234abc12/docs/workflow-examples/01-linear-pipeline.wd.json',
    );
  });

  it('throws ValidationError for non-GitHub hosts', () => {
    expect(() => buildRawUrl('https://gitlab.com/org/repo', 'main', 'wf.wd.json')).toThrow(
      ValidationError,
    );
  });

  it('throws ValidationError for unsupported GitHub sub-paths', () => {
    expect(() =>
      buildRawUrl('https://github.com/Appsilon/mediforce-workflows/blob/main/wf.wd.json', 'main', 'wf.wd.json'),
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

  it('uses a tree URL ref for commit resolution when no ref is supplied', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 404 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 404 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(`${SHA}\n`),
      } as Response);

    await resolveCommitSha(
      'https://github.com/Appsilon/mediforce/tree/release/docs/workflow-examples',
    );

    expect(vi.mocked(fetch).mock.calls[2][0]).toBe(
      'https://api.github.com/repos/Appsilon/mediforce/commits/release',
    );
  });

  it('resolves the longest valid slash-containing tree URL ref', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 404 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 404 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(`${SHA}\n`),
      } as Response);

    await expect(
      resolveCommitSha(
        'https://github.com/Appsilon/mediforce/tree/feat/workflow-import-examples-default/docs/workflow-examples',
      ),
    ).resolves.toBe(SHA);

    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
      'https://api.github.com/repos/Appsilon/mediforce/commits/feat%2Fworkflow-import-examples-default%2Fdocs%2Fworkflow-examples',
      'https://api.github.com/repos/Appsilon/mediforce/commits/feat%2Fworkflow-import-examples-default%2Fdocs',
      'https://api.github.com/repos/Appsilon/mediforce/commits/feat%2Fworkflow-import-examples-default',
    ]);
  });

  it('returns the resolved directory prefix for a slash-containing tree source', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 404 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 404 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(`${SHA}\n`),
      } as Response);

    await expect(
      resolveGitHubSource(
        'https://github.com/Appsilon/mediforce/tree/feat/workflow-import-examples-default/docs/workflow-examples',
      ),
    ).resolves.toEqual({
      repo: 'https://github.com/Appsilon/mediforce',
      ref: 'feat/workflow-import-examples-default',
      pathPrefix: 'docs/workflow-examples',
      commit: SHA,
    });
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
