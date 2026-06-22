import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockIsNameDeleted = vi.fn();
const mockGetLatestVersion = vi.fn();
const mockSaveWorkflowDefinition = vi.fn();
const mockAuditAppend = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    processRepo: {
      isWorkflowNameDeleted: mockIsNameDeleted,
      getLatestWorkflowVersion: mockGetLatestVersion,
      saveWorkflowDefinition: mockSaveWorkflowDefinition,
    },
    auditRepo: { append: mockAuditAppend },
    namespaceRepo: {},
    modelRegistryRepo: { list: vi.fn().mockResolvedValue([]) },
  }),
}));

const mockResolveCallerIdentity = vi.fn();

vi.mock('@/lib/api-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-auth')>('@/lib/api-auth');
  return {
    ...actual,
    resolveCallerIdentity: (...args: unknown[]) => mockResolveCallerIdentity(...args),
  };
});

import { POST } from '../route';

function makeRequest(namespace: string | null, body: unknown): NextRequest {
  const url = new URL('http://localhost/api/workflow-definitions');
  if (namespace !== null) url.searchParams.set('namespace', namespace);
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  name: 'wf-new',
  visibility: 'private',
  steps: [{ id: 's1', name: 'Step 1', executor: 'human', assignedRole: 'reviewer' }],
  transitions: [{ from: 's1', to: '__end__' }],
  triggers: [{ type: 'manual', name: 'manual' }],
};

describe('POST /api/workflow-definitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey', isSystemActor: true });
    mockIsNameDeleted.mockResolvedValue(false);
    mockGetLatestVersion.mockResolvedValue(0);
    mockSaveWorkflowDefinition.mockResolvedValue(undefined);
  });

  it('[DATA] registers a new workflow as v1 and emits audit', async () => {
    const res = await POST(makeRequest('ns-1', validBody), {});
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toMatchObject({ success: true, name: 'wf-new', version: 1 });
    expect(mockSaveWorkflowDefinition).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'wf-new', namespace: 'ns-1', version: 1 }),
    );
    expect(mockAuditAppend).toHaveBeenCalledWith(expect.objectContaining({ action: 'workflow.created' }));
  });

  it('[DATA] increments version when prior versions exist', async () => {
    mockGetLatestVersion.mockResolvedValue(2);

    const res = await POST(makeRequest('ns-1', validBody), {});
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.version).toBe(3);
    expect(mockAuditAppend).toHaveBeenCalledWith(expect.objectContaining({ action: 'workflow.version_added' }));
  });

  it('[ERROR] returns 400 when a deleted name is re-used', async () => {
    mockIsNameDeleted.mockResolvedValue(true);

    const res = await POST(makeRequest('ns-1', validBody), {});

    expect(res.status).toBe(400);
    expect(mockSaveWorkflowDefinition).not.toHaveBeenCalled();
  });

  it('[AUTHZ] returns 403 when caller lacks namespace membership', async () => {
    mockResolveCallerIdentity.mockReturnValue({
      kind: 'user',
      uid: 'u-1',
      namespaces: new Set(['other-ns']),
      isSystemActor: false,
    });

    const res = await POST(makeRequest('ns-1', validBody), {});

    expect(res.status).toBe(403);
    expect(mockSaveWorkflowDefinition).not.toHaveBeenCalled();
  });

  it('[ERROR] returns 400 when body fails contract validation', async () => {
    const res = await POST(makeRequest('ns-1', { name: 'no-steps' }), {});
    expect(res.status).toBe(400);
  });
});
