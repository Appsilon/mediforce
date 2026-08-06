import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildRawUrl, resolveGitHubSource } from '../_github';
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

  // A tree URL still mixes the ref with the directory it scopes to, so building a
  // raw URL from one would guess a prefix instead of using the resolved boundary.
  it('throws ValidationError for a tree URL', () => {
    expect(() =>
      buildRawUrl(
        'https://github.com/Appsilon/mediforce/tree/main/docs/workflow-examples',
        'main',
        '01-linear-pipeline.wd.json',
      ),
    ).toThrow(/canonical repo URL/);
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

describe('resolveGitHubSource', () => {
  const SHA = 'abc1234abc1234abc1234abc1234abc1234abc12'; // 40 hex chars
  const OTHER_SHA = 'def5678def5678def5678def5678def5678def56';
  const REPO = 'https://github.com/Appsilon/mediforce-workflows';

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a full 40-char SHA as-is without any network call', async () => {
    expect((await resolveGitHubSource(REPO, SHA)).commit).toBe(SHA);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('resolves a branch ref via the GitHub commits API and trims the SHA', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(`${SHA}\n`),
    } as Response);

    expect((await resolveGitHubSource(REPO, 'main')).commit).toBe(SHA);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      'https://api.github.com/repos/Appsilon/mediforce-workflows/commits/main',
    );
  });

  // The URL GitHub shows while browsing a branch with no subdirectory selected.
  // It has one tree segment, so the ref is the whole of it and the source scopes
  // to the repository root.
  it('accepts a branch-root tree URL as ref with an empty path prefix', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(SHA),
    } as Response);

    await expect(
      resolveGitHubSource('https://github.com/Appsilon/mediforce/tree/main'),
    ).resolves.toEqual({
      repo: 'https://github.com/Appsilon/mediforce',
      ref: 'main',
      pathPrefix: '',
      commit: SHA,
    });
  });

  it('uses a tree URL ref for commit resolution when no ref is supplied', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 422 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 422 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(`${SHA}\n`),
      } as Response);

    await resolveGitHubSource(
      'https://github.com/Appsilon/mediforce/tree/release/docs/workflow-examples',
    );

    expect(vi.mocked(fetch).mock.calls[2][0]).toBe(
      'https://api.github.com/repos/Appsilon/mediforce/commits/release',
    );
  });

  it('resolves the longest valid slash-containing tree URL ref', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 422 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 422 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(`${SHA}\n`),
      } as Response);

    await expect(
      resolveGitHubSource(
        'https://github.com/Appsilon/mediforce/tree/feat/workflow-import-examples-default/docs/workflow-examples',
      ).then((source) => source.commit),
    ).resolves.toBe(SHA);

    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
      'https://api.github.com/repos/Appsilon/mediforce/commits/feat%2Fworkflow-import-examples-default%2Fdocs%2Fworkflow-examples',
      'https://api.github.com/repos/Appsilon/mediforce/commits/feat%2Fworkflow-import-examples-default%2Fdocs',
      'https://api.github.com/repos/Appsilon/mediforce/commits/feat%2Fworkflow-import-examples-default',
    ]);
  });

  it('returns the resolved directory prefix for a slash-containing tree source', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 422 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 422 } as Response)
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

  // GitHub answers a get-commit probe for `main/docs/workflow-examples` with 422
  // ("No commit found for SHA"), not 404 — treating only 404 as a candidate miss
  // aborts resolution before `main` is ever tried, breaking the default source.
  it('treats a 422 tree candidate as a miss and keeps probing shorter refs', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 422, statusText: 'Unprocessable Entity' } as Response)
      .mockResolvedValueOnce({ ok: false, status: 422, statusText: 'Unprocessable Entity' } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(`${SHA}\n`),
      } as Response);

    await expect(
      resolveGitHubSource('https://github.com/Appsilon/mediforce/tree/main/docs/workflow-examples'),
    ).resolves.toEqual({
      repo: 'https://github.com/Appsilon/mediforce',
      ref: 'main',
      pathPrefix: 'docs/workflow-examples',
      commit: SHA,
    });
  });

  it('keeps the tree directory when an unrelated ref overrides a slash-containing tree ref', async () => {
    vi.mocked(fetch)
      // Boundary probe over `feat/topic/docs/workflow-examples`: two misses,
      // then `feat/topic` resolves — so the directory is `docs/workflow-examples`.
      .mockResolvedValueOnce({ ok: false, status: 422 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 422 } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve(SHA) } as Response)
      // The override itself.
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(OTHER_SHA),
      } as Response);

    await expect(
      resolveGitHubSource(
        'https://github.com/Appsilon/mediforce/tree/feat/topic/docs/workflow-examples',
        'release',
      ),
    ).resolves.toEqual({
      repo: 'https://github.com/Appsilon/mediforce',
      ref: 'release',
      pathPrefix: 'docs/workflow-examples',
      commit: OTHER_SHA,
    });
  });

  it('falls back to the first tree segment when the URL ref no longer exists', async () => {
    vi.mocked(fetch)
      // Every boundary candidate misses — the pinned branch was deleted.
      .mockResolvedValueOnce({ ok: false, status: 422 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 422 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 422 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(OTHER_SHA),
      } as Response);

    await expect(
      resolveGitHubSource(
        'https://github.com/Appsilon/mediforce/tree/deleted-branch/docs/workflow-examples',
        'main',
      ),
    ).resolves.toEqual({
      repo: 'https://github.com/Appsilon/mediforce',
      ref: 'main',
      pathPrefix: 'docs/workflow-examples',
      commit: OTHER_SHA,
    });
  });

  it('reports which tree URL failed when no candidate ref exists', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 422 } as Response);

    await expect(
      resolveGitHubSource('https://github.com/Appsilon/mediforce/tree/no/such/ref'),
    ).rejects.toThrow(/no\/such\/ref/);
  });

  it('throws "not found" on 404', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404 } as Response);
    await expect(resolveGitHubSource(REPO, 'no-such-tag')).rejects.toThrow(/not found/i);
  });

  it('throws "rate limit" on 403', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 403 } as Response);
    await expect(resolveGitHubSource(REPO, 'main')).rejects.toThrow(/rate limit/i);
  });

  it('throws for a non-GitHub host before any network call', async () => {
    await expect(resolveGitHubSource('https://gitlab.com/org/repo', 'main')).rejects.toThrow(
      ValidationError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
