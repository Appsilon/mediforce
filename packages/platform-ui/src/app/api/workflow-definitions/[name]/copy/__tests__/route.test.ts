import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { WorkflowDefinition } from '@mediforce/platform-core';

const sourceDefinition: WorkflowDefinition = {
  name: 'my-workflow',
  version: 3,
  namespace: 'source-ns',
  visibility: 'public',
  steps: [{ id: 'step-1', name: 'Step 1', executor: 'human', assignedRole: 'reviewer' }],
  transitions: [{ from: 'step-1', to: '__end__' }],
  triggers: [{ type: 'manual', name: 'manual' }],
  createdAt: '2026-05-01T00:00:00Z',
};

const mockGetWorkflowDefinition = vi.fn();
const mockGetLatestWorkflowVersion = vi.fn();
const mockSaveWorkflowDefinition = vi.fn();
const mockAuditAppend = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    processRepo: {
      getWorkflowDefinition: mockGetWorkflowDefinition,
      getLatestWorkflowVersion: mockGetLatestWorkflowVersion,
      saveWorkflowDefinition: mockSaveWorkflowDefinition,
    },
    auditRepo: { append: mockAuditAppend },
    namespaceRepo: {},
  }),
}));

let mockCallerIdentity: {
  kind: string;
  uid?: string;
  namespaces?: Set<string>;
  namespaceRoles?: Map<string, 'owner' | 'admin' | 'member'>;
  isSystemActor: boolean;
} = { kind: 'apiKey', isSystemActor: true };

vi.mock('@/lib/api-auth', () => ({
  resolveCallerIdentity: () => mockCallerIdentity,
  callerCanAccess: (_caller: unknown, ns: string) => {
    if (mockCallerIdentity.kind === 'apiKey') return true;
    return mockCallerIdentity.namespaces?.has(ns) ?? false;
  },
  requireNamespaceAccess: (_caller: unknown, ns: string) => {
    if (mockCallerIdentity.kind === 'apiKey') return null;
    if (mockCallerIdentity.namespaces?.has(ns)) return null;
    const { NextResponse } = require('next/server');
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  },
}));

import { POST } from '../route';

function makeRequest(
  name: string,
  targetNamespace: string,
  body?: Record<string, unknown>,
  sourceNamespace?: string,
): NextRequest {
  const url = new URL(`http://localhost/api/workflow-definitions/${encodeURIComponent(name)}/copy`);
  url.searchParams.set('targetNamespace', targetNamespace);
  if (sourceNamespace !== undefined) {
    url.searchParams.set('namespace', sourceNamespace);
  }
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

describe('POST /api/workflow-definitions/[name]/copy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallerIdentity = { kind: 'apiKey', isSystemActor: true };
    // First call: source version lookup; Second call: target exists check
    mockGetLatestWorkflowVersion.mockImplementation((namespace: string, _name: string) =>
      namespace === 'target-ns' ? Promise.resolve(0) : Promise.resolve(3),
    );
    mockGetWorkflowDefinition.mockResolvedValue(sourceDefinition);
    mockSaveWorkflowDefinition.mockResolvedValue(undefined);
  });

  it('copies a public workflow — 201', async () => {
    const res = await POST(makeRequest('my-workflow', 'target-ns', undefined, 'source-ns'), {
      params: Promise.resolve({ name: 'my-workflow' }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.name).toBe('my-workflow');
    expect(json.version).toBe(1); // namespace-scoped, always starts at 1
    expect(json.copiedFrom).toEqual({
      namespace: 'source-ns',
      name: 'my-workflow',
      version: 3,
    });

    expect(mockSaveWorkflowDefinition).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'my-workflow',
        namespace: 'target-ns',
        version: 1,
        visibility: 'private',
        copiedFrom: { namespace: 'source-ns', name: 'my-workflow', version: 3 },
      }),
    );
  });

  it('copies with custom targetName — 201', async () => {
    const res = await POST(makeRequest('my-workflow', 'target-ns', { targetName: 'renamed-wf' }, 'source-ns'), {
      params: Promise.resolve({ name: 'my-workflow' }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.name).toBe('renamed-wf');
    expect(json.version).toBe(1);
  });

  it('copies at specific version', async () => {
    const res = await POST(makeRequest('my-workflow', 'target-ns', { version: 2 }, 'source-ns'), {
      params: Promise.resolve({ name: 'my-workflow' }),
    });
    expect(res.status).toBe(201);
    expect(mockGetWorkflowDefinition).toHaveBeenCalledWith('source-ns', 'my-workflow', 2);
  });

  it('returns 409 when name exists in target namespace', async () => {
    mockGetLatestWorkflowVersion.mockImplementation((namespace: string, _name: string) =>
      namespace === 'target-ns' ? Promise.resolve(2) : Promise.resolve(3),
    );

    const res = await POST(makeRequest('my-workflow', 'target-ns', undefined, 'source-ns'), {
      params: Promise.resolve({ name: 'my-workflow' }),
    });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.message).toContain('already exists');
  });

  it('returns 404 for non-existent workflow', async () => {
    mockGetLatestWorkflowVersion.mockResolvedValue(0);

    const res = await POST(makeRequest('no-such', 'target-ns'), {
      params: Promise.resolve({ name: 'no-such' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 for private workflow when caller lacks source access', async () => {
    mockCallerIdentity = {
      kind: 'user',
      uid: 'u-1',
      namespaces: new Set(['target-ns']),
      namespaceRoles: new Map([['target-ns', 'member']]),
      isSystemActor: false,
    };
    mockGetWorkflowDefinition.mockResolvedValue({ ...sourceDefinition, visibility: 'private' });

    const res = await POST(makeRequest('my-workflow', 'target-ns', undefined, 'source-ns'), {
      params: Promise.resolve({ name: 'my-workflow' }),
    });
    expect(res.status).toBe(404);
  });

  it('copies private workflow when caller has source namespace access', async () => {
    mockCallerIdentity = {
      kind: 'user',
      uid: 'u-1',
      namespaces: new Set(['source-ns', 'target-ns']),
      namespaceRoles: new Map([
        ['source-ns', 'member'],
        ['target-ns', 'member'],
      ]),
      isSystemActor: false,
    };
    mockGetWorkflowDefinition.mockResolvedValue({ ...sourceDefinition, visibility: 'private' });

    const res = await POST(makeRequest('my-workflow', 'target-ns', undefined, 'source-ns'), {
      params: Promise.resolve({ name: 'my-workflow' }),
    });
    expect(res.status).toBe(201);
  });

  it('returns 403 when caller is not member of target namespace', async () => {
    mockCallerIdentity = {
      kind: 'user',
      uid: 'u-1',
      namespaces: new Set(['other-ns']),
      namespaceRoles: new Map([['other-ns', 'member']]),
      isSystemActor: false,
    };

    const res = await POST(makeRequest('my-workflow', 'target-ns', undefined, 'source-ns'), {
      params: Promise.resolve({ name: 'my-workflow' }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 400 when targetNamespace query param is missing', async () => {
    const url = new URL('http://localhost/api/workflow-definitions/my-workflow/copy');
    const req = new NextRequest(url, { method: 'POST' });

    const res = await POST(req, {
      params: Promise.resolve({ name: 'my-workflow' }),
    });
    expect(res.status).toBe(400);
  });

  it('copied workflow is always private regardless of source', async () => {
    const res = await POST(makeRequest('my-workflow', 'target-ns', undefined, 'source-ns'), {
      params: Promise.resolve({ name: 'my-workflow' }),
    });
    expect(res.status).toBe(201);

    const savedDef = mockSaveWorkflowDefinition.mock.calls[0][0];
    expect(savedDef.visibility).toBe('private');
  });
});
