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

function buildScope() {
  const processRepo = new InMemoryProcessRepository();
  const instanceRepo = new InMemoryProcessInstanceRepository();
  const auditRepo = new InMemoryAuditRepository(instanceRepo);
  return createTestScope({ processRepo, auditRepo, caller: userCaller('user-1', ['test-ns']) });
}

describe('getManifest handler', () => {
  beforeEach(() => {
    resetFactorySequence();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns parsed manifest from index.json', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(VALID_MANIFEST),
    } as Response);
    const scope = buildScope();

    const result = await getManifest(
      { repo: 'https://github.com/Appsilon/mediforce-workflows' },
      scope,
    );

    expect(result.workflows).toHaveLength(2);
    expect(result.workflows[0].name).toBe('Workflow Designer');
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('index.json');
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('/main/');
  });

  it('uses provided ref in the raw URL', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(VALID_MANIFEST),
    } as Response);
    const scope = buildScope();

    await getManifest(
      { repo: 'https://github.com/Appsilon/mediforce-workflows', ref: 'v2.0' },
      scope,
    );

    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('/v2.0/');
  });

  it('throws ValidationError when fetch fails', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' } as Response);
    const scope = buildScope();

    await expect(
      getManifest({ repo: 'https://github.com/Appsilon/mediforce-workflows' }, scope),
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when manifest has invalid shape', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ workflows: [{ missing_name_field: true }] }),
    } as Response);
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
