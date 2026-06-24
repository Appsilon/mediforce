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

// registerWorkflow (which import delegates to) rejects agent steps with no image
// unless local-agent mode is on, and otherwise probes the container runtime for
// image warnings — stub the docker seam so these tests stay offline.
vi.mock('../../system/_docker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../system/_docker')>();
  return {
    ...actual,
    isLocalAgentMode: vi.fn().mockReturnValue(false),
    fetchFromContainerWorker: vi.fn().mockResolvedValue({ available: false }),
    fetchFromLocalDocker: vi.fn().mockResolvedValue({ available: false }),
  };
});

// A valid .wd.json template — no namespace, version, or createdAt. The agent
// step needs an image so registerWorkflow's image check passes.
const _template = buildWorkflowDefinition({
  name: 'imported-workflow',
  namespace: 'unused',
  version: 1,
});
_template.steps[1].agent = { ..._template.steps[1].agent, image: 'test-image' };
const { namespace: _ns, version: _v, createdAt: _ca, ...VALID_TEMPLATE } = _template;

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

  // A 40-char hex SHA — full SHAs skip the resolution round-trip, so a single
  // fetch mock (the raw file) is all most tests need.
  const SHA = 'a'.repeat(40);

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

  it('stores a WorkflowDefinition with source.url, source.path, source.commit set', async () => {
    mockFetchOk(VALID_TEMPLATE);
    const { scope, processRepo } = buildScope();

    const result = await importWorkflow(
      { repo: 'https://github.com/Appsilon/mediforce-workflows', path: 'wf/wf.wd.json', ref: SHA, namespace: 'test-ns' },
      scope,
    );

    expect(result).toEqual({ success: true, name: 'imported-workflow', version: 1 });
    const stored = await processRepo.getWorkflowDefinition('test-ns', 'imported-workflow', 1);
    expect(stored?.source).toEqual({
      url: 'https://github.com/Appsilon/mediforce-workflows',
      path: 'wf/wf.wd.json',
      commit: SHA,
    });
  });

  it('resolves a branch ref to a commit SHA, fetches at that SHA, and stores it', async () => {
    // First fetch: GitHub API resolves "main" -> SHA (plain text). Second: raw file.
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve(`${SHA}\n`) } as Response)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(VALID_TEMPLATE) } as Response);
    const { scope, processRepo } = buildScope();

    await importWorkflow(
      { repo: 'https://github.com/Appsilon/mediforce-workflows', path: 'wf/wf.wd.json', namespace: 'test-ns' },
      scope,
    );

    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      'https://api.github.com/repos/Appsilon/mediforce-workflows/commits/main',
    );
    expect(vi.mocked(fetch).mock.calls[1][0]).toContain(`/${SHA}/`);
    const stored = await processRepo.getWorkflowDefinition('test-ns', 'imported-workflow', 1);
    expect(stored?.source?.commit).toBe(SHA);
  });

  it('imports cleanly when the .wd.json declares a namespace (target wins)', async () => {
    mockFetchOk({ ...VALID_TEMPLATE, namespace: 'should-be-ignored' });
    const { scope, processRepo } = buildScope();

    await importWorkflow(
      { repo: 'https://github.com/Appsilon/mediforce-workflows', path: 'wf.wd.json', ref: SHA, namespace: 'test-ns' },
      scope,
    );

    const stored = await processRepo.getWorkflowDefinition('test-ns', 'imported-workflow', 1);
    expect(stored?.namespace).toBe('test-ns');
  });

  it('throws ValidationError when fetch returns non-OK status', async () => {
    mockFetchFail(404, 'Not Found');
    const { scope } = buildScope();

    await expect(
      importWorkflow(
        { repo: 'https://github.com/Appsilon/mediforce-workflows', path: 'missing.wd.json', ref: SHA, namespace: 'test-ns' },
        scope,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when .wd.json has invalid shape', async () => {
    mockFetchOk({ name: 'bad', steps: [] }); // missing required triggers
    const { scope } = buildScope();

    await expect(
      importWorkflow(
        { repo: 'https://github.com/Appsilon/mediforce-workflows', path: 'bad.wd.json', ref: SHA, namespace: 'test-ns' },
        scope,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError for non-GitHub repo URL before any network call', async () => {
    const { scope } = buildScope();

    await expect(
      importWorkflow(
        { repo: 'https://gitlab.com/org/repo', path: 'wf.wd.json', ref: 'main', namespace: 'test-ns' },
        scope,
      ),
    ).rejects.toThrow(ValidationError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
