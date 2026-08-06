import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { getManifest } from '../get-manifest';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';
import { ValidationError } from '../../../errors';

const VALID_MANIFEST = {
  workflows: [
    { name: 'Workflow Designer', path: 'workflow-designer/workflow-designer.wd.json', description: 'Design workflows.', tags: ['meta'] },
    { name: 'SDTM Migration', path: 'sdtm/sdtm.wd.json' },
  ],
};

const SHA = 'abc1234abc1234abc1234abc1234abc1234abc12'; // 40 hex chars

function buildScope() {
  const processRepo = new InMemoryProcessRepository();
  const instanceRepo = new InMemoryProcessInstanceRepository();
  const auditRepo = new InMemoryAuditRepository(instanceRepo);
  return createTestScope({ processRepo, auditRepo, caller: userCaller('user-1', ['test-ns']) });
}

/**
 * Queue the GitHub round-trips a manifest fetch makes: `missedCandidates` tree
 * candidates GitHub rejects with 422, then the commit resolution, then the raw
 * workflows-index.json.
 */
function mockGitHub(missedCandidates: number, manifest: unknown = VALID_MANIFEST) {
  for (let i = 0; i < missedCandidates; i++) {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 422 } as Response);
  }
  vi.mocked(fetch)
    .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve(SHA) } as Response)
    .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(manifest) } as Response);
}

function fetchedUrls(): unknown[] {
  return vi.mocked(fetch).mock.calls.map(([url]) => url);
}

describe('getManifest handler', () => {
  beforeEach(() => {
    resetFactorySequence();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns parsed manifest from workflows-index.json pinned to the resolved commit', async () => {
    mockGitHub(0);
    const scope = buildScope();

    const result = await getManifest(
      { repo: 'https://github.com/Appsilon/mediforce-workflows' },
      scope,
    );

    expect(result.workflows).toHaveLength(2);
    expect(result.workflows[0].name).toBe('Workflow Designer');
    expect(fetchedUrls()[0]).toBe(
      'https://api.github.com/repos/Appsilon/mediforce-workflows/commits/main',
    );
    expect(fetchedUrls().at(-1)).toBe(
      `https://raw.githubusercontent.com/Appsilon/mediforce-workflows/${SHA}/workflows-index.json`,
    );
  });

  it('resolves the provided ref before fetching the manifest', async () => {
    mockGitHub(0);
    const scope = buildScope();

    await getManifest(
      { repo: 'https://github.com/Appsilon/mediforce-workflows', ref: 'v2.0' },
      scope,
    );

    expect(fetchedUrls()[0]).toBe(
      'https://api.github.com/repos/Appsilon/mediforce-workflows/commits/v2.0',
    );
    expect(fetchedUrls().at(-1)).toContain(`/${SHA}/`);
  });

  it('fetches a manifest from a tree-scoped source', async () => {
    // `main/docs/workflow-examples` and `main/docs` miss before `main` resolves.
    mockGitHub(2);
    const scope = buildScope();

    await getManifest(
      { repo: 'https://github.com/Appsilon/mediforce/tree/main/docs/workflow-examples' },
      scope,
    );

    expect(fetchedUrls().at(-1)).toBe(
      `https://raw.githubusercontent.com/Appsilon/mediforce/${SHA}/docs/workflow-examples/workflows-index.json`,
    );
  });

  it('supports a tree source whose branch name contains slashes', async () => {
    mockGitHub(2);
    const scope = buildScope();

    await getManifest(
      { repo: 'https://github.com/Appsilon/mediforce/tree/feat/workflow-import-examples-default/docs/workflow-examples' },
      scope,
    );

    expect(fetchedUrls().at(-1)).toBe(
      `https://raw.githubusercontent.com/Appsilon/mediforce/${SHA}/docs/workflow-examples/workflows-index.json`,
    );
  });

  it('keeps the tree directory when the caller overrides the ref', async () => {
    // Boundary probe: two misses, then `feat/topic` resolves. The override is
    // resolved separately and must not shift the directory.
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 422 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 422 } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve(SHA) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve(SHA) } as Response)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(VALID_MANIFEST) } as Response);
    const scope = buildScope();

    await getManifest(
      {
        repo: 'https://github.com/Appsilon/mediforce/tree/feat/topic/docs/workflow-examples',
        ref: 'release',
      },
      scope,
    );

    expect(fetchedUrls().at(-1)).toBe(
      `https://raw.githubusercontent.com/Appsilon/mediforce/${SHA}/docs/workflow-examples/workflows-index.json`,
    );
  });

  // `index.json` is the name repos published a browse manifest under before
  // `workflows-index.json`; dropping it would un-browse every existing repo.
  it('falls back to index.json when workflows-index.json is absent', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve(SHA) } as Response)
      .mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(VALID_MANIFEST) } as Response);
    const scope = buildScope();

    const result = await getManifest(
      { repo: 'https://github.com/Appsilon/mediforce-workflows' },
      scope,
    );

    expect(result.workflows).toHaveLength(2);
    expect(fetchedUrls().slice(-2)).toEqual([
      `https://raw.githubusercontent.com/Appsilon/mediforce-workflows/${SHA}/workflows-index.json`,
      `https://raw.githubusercontent.com/Appsilon/mediforce-workflows/${SHA}/index.json`,
    ]);
  });

  // Only "the file is not there" justifies trying the legacy name. Falling back on
  // a rate limit or a server error would report "no manifest" for a repo that has
  // one, and hide the real failure behind the second request's status.
  it('does not fall back when the canonical manifest fetch fails for another reason', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve(SHA) } as Response)
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' } as Response);
    const scope = buildScope();

    await expect(
      getManifest({ repo: 'https://github.com/Appsilon/mediforce-workflows' }, scope),
    ).rejects.toThrow(/Failed to fetch manifest: 500 Internal Server Error/);
    expect(fetchedUrls().at(-1)).toBe(
      `https://raw.githubusercontent.com/Appsilon/mediforce-workflows/${SHA}/workflows-index.json`,
    );
  });

  it('throws ValidationError when neither manifest name exists', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve(SHA) } as Response)
      .mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' } as Response);
    const scope = buildScope();

    await expect(
      getManifest({ repo: 'https://github.com/Appsilon/mediforce-workflows' }, scope),
    ).rejects.toThrow(/Failed to fetch manifest: 404 Not Found .*workflows-index\.json/);
  });

  it('throws ValidationError when manifest has invalid shape', async () => {
    mockGitHub(0, { workflows: [{ missing_name_field: true }] });
    const scope = buildScope();

    await expect(
      getManifest({ repo: 'https://github.com/Appsilon/mediforce-workflows' }, scope),
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError for non-GitHub repo URL', async () => {
    const scope = buildScope();

    await expect(
      getManifest({ repo: 'https://gitlab.com/org/repo' }, scope),
    ).rejects.toThrow(ValidationError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
