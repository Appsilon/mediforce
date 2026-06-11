import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  buildWorkflowDefinition,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { importWorkflow } from '../import-workflow';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';
import { ValidationError } from '../../../errors';

// A valid .wd.json template — no namespace, version, or createdAt
const { namespace: _ns, version: _v, createdAt: _ca, ...VALID_TEMPLATE } = buildWorkflowDefinition({
  name: 'imported-workflow',
  namespace: 'unused',
  version: 1,
});

function buildScope() {
  const processRepo = new InMemoryProcessRepository();
  const instanceRepo = new InMemoryProcessInstanceRepository();
  const auditRepo = new InMemoryAuditRepository(instanceRepo);
  return {
    scope: createTestScope({ processRepo, auditRepo, caller: userCaller('user-1', ['test-ns']) }),
    processRepo,
  };
}

describe('importWorkflow handler', () => {
  beforeEach(() => {
    resetFactorySequence();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetchOk(body: unknown) {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(body),
    } as Response);
  }

  function mockFetchFail(status = 404, statusText = 'Not Found') {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status,
      statusText,
    } as Response);
  }

  it('stores a WorkflowDefinition with source.repo, source.path, source.ref set', async () => {
    mockFetchOk(VALID_TEMPLATE);
    const { scope, processRepo } = buildScope();

    const result = await importWorkflow(
      { repo: 'https://github.com/Appsilon/mediforce-workflows', path: 'wf/wf.wd.json', ref: 'v1.0', namespace: 'test-ns' },
      scope,
    );

    expect(result).toEqual({ success: true, name: 'imported-workflow', version: 1 });
    const stored = await processRepo.getWorkflowDefinition('test-ns', 'imported-workflow', 1);
    expect(stored?.source).toEqual({
      repo: 'https://github.com/Appsilon/mediforce-workflows',
      path: 'wf/wf.wd.json',
      ref: 'v1.0',
    });
  });

  it('defaults ref to "main" when not provided', async () => {
    mockFetchOk(VALID_TEMPLATE);
    const { scope, processRepo } = buildScope();

    await importWorkflow(
      { repo: 'https://github.com/Appsilon/mediforce-workflows', path: 'wf/wf.wd.json', namespace: 'test-ns' },
      scope,
    );

    const stored = await processRepo.getWorkflowDefinition('test-ns', 'imported-workflow', 1);
    expect(stored?.source?.ref).toBe('main');
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('/main/');
  });

  it('throws ValidationError when fetch returns non-OK status', async () => {
    mockFetchFail(404, 'Not Found');
    const { scope } = buildScope();

    await expect(
      importWorkflow(
        { repo: 'https://github.com/Appsilon/mediforce-workflows', path: 'missing.wd.json', namespace: 'test-ns' },
        scope,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError for non-GitHub repo URL', async () => {
    const { scope } = buildScope();

    await expect(
      importWorkflow(
        { repo: 'https://gitlab.com/org/repo', path: 'wf.wd.json', namespace: 'test-ns' },
        scope,
      ),
    ).rejects.toThrow(ValidationError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('throws ValidationError when .wd.json has invalid shape', async () => {
    mockFetchOk({ name: 'bad', steps: [] }); // missing required triggers
    const { scope } = buildScope();

    await expect(
      importWorkflow(
        { repo: 'https://github.com/Appsilon/mediforce-workflows', path: 'bad.wd.json', namespace: 'test-ns' },
        scope,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when .wd.json declares a namespace', async () => {
    mockFetchOk({ ...VALID_TEMPLATE, namespace: 'should-not-be-here' });
    const { scope } = buildScope();

    await expect(
      importWorkflow(
        { repo: 'https://github.com/Appsilon/mediforce-workflows', path: 'wf.wd.json', namespace: 'test-ns' },
        scope,
      ),
    ).rejects.toThrow(ValidationError);
  });
});
