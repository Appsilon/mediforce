import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  buildWorkflowDefinition,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { importWorkflow } from '../import-workflow.js';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope.js';

const REPO = 'https://github.com/Appsilon/mediforce-workflows';
const PATH = 'workflow-designer/workflow-designer.wd.json';

function makeTemplate() {
  const wd = buildWorkflowDefinition({ name: 'workflow-designer', namespace: 'team-alpha' });
  const { version: _v, namespace: _n, createdAt: _c, ...body } = wd;
  return body;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('importWorkflow handler', () => {
  let processRepo: InMemoryProcessRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    resetFactorySequence();
    processRepo = new InMemoryProcessRepository();
    const instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository(instanceRepo);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function buildScope(namespaces = ['team-alpha']) {
    return createTestScope({
      processRepo,
      auditRepo,
      caller: userCaller('user-42', namespaces),
    });
  }

  it('fetches the file, registers the workflow, and returns source metadata', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(makeTemplate()));
    const scope = buildScope();

    const result = await importWorkflow(
      { repo: REPO, path: PATH, ref: 'main', namespace: 'team-alpha' },
      scope,
    );

    expect(result.success).toBe(true);
    expect(result.name).toBe('workflow-designer');
    expect(result.version).toBe(1);
    expect(result.source).toEqual({ repo: REPO, path: PATH });

    const [fetchUrl] = vi.mocked(globalThis.fetch).mock.calls[0]!;
    expect(fetchUrl).toBe(
      `https://raw.githubusercontent.com/Appsilon/mediforce-workflows/main/${PATH}`,
    );
  });

  it('stores source on the saved definition', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(makeTemplate()));
    await importWorkflow(
      { repo: REPO, path: PATH, ref: 'main', namespace: 'team-alpha' },
      buildScope(),
    );
    const saved = await processRepo.getWorkflowDefinition('team-alpha', 'workflow-designer', 1);
    expect(saved?.source).toEqual({ repo: REPO, path: PATH });
  });

  it('throws ValidationError for non-GitHub URLs', async () => {
    const scope = buildScope();
    await expect(
      importWorkflow(
        { repo: 'https://gitlab.com/org/repo', path: PATH, ref: 'main', namespace: 'team-alpha' },
        scope,
      ),
    ).rejects.toThrow(/Only GitHub URLs/);
  });

  it('throws ValidationError when the file fetch returns non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Not Found', { status: 404 }));
    await expect(
      importWorkflow(
        { repo: REPO, path: PATH, ref: 'main', namespace: 'team-alpha' },
        buildScope(),
      ),
    ).rejects.toThrow(/404/);
  });

  it('throws ValidationError when the file is not a valid workflow template', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ bad: 'data' }));
    await expect(
      importWorkflow(
        { repo: REPO, path: PATH, ref: 'main', namespace: 'team-alpha' },
        buildScope(),
      ),
    ).rejects.toThrow();
  });

  it('respects the ref parameter when building the fetch URL', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(makeTemplate()));
    await importWorkflow(
      { repo: REPO, path: PATH, ref: 'v2.0.0', namespace: 'team-alpha' },
      buildScope(),
    );
    const [fetchUrl] = vi.mocked(globalThis.fetch).mock.calls[0]!;
    expect(fetchUrl).toContain('/v2.0.0/');
  });
});
