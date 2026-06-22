import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { WorkflowDefinition } from '@mediforce/platform-core';

const mockGetWorkflowDefinition = vi.fn();
const mockGetDefaultVersion = vi.fn();
const mockSetDefaultVersion = vi.fn();
const mockAuditAppend = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    processRepo: {
      getWorkflowDefinition: mockGetWorkflowDefinition,
      getDefaultWorkflowVersion: mockGetDefaultVersion,
      setDefaultWorkflowVersion: mockSetDefaultVersion,
    },
    auditRepo: { append: mockAuditAppend },
    namespaceRepo: {},
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

const makeParams = (name: string) => Promise.resolve({ name });

function makeRequest(name: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/workflow-definitions/${encodeURIComponent(name)}/default-version`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const existingDefinition: WorkflowDefinition = {
  name: 'wf-1',
  version: 2,
  namespace: 'ns-1',
  visibility: 'private',
  steps: [{ id: 's1', name: 'S1', executor: 'human', assignedRole: 'reviewer' }],
  transitions: [{ from: 's1', to: '__end__' }],
  triggers: [{ type: 'manual', name: 'manual' }],
  createdAt: '2026-01-01T00:00:00Z',
};

describe('POST /api/workflow-definitions/:name/default-version', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey', isSystemActor: true });
    mockGetDefaultVersion.mockResolvedValue(1);
    mockGetWorkflowDefinition.mockResolvedValue(existingDefinition);
    mockSetDefaultVersion.mockResolvedValue(undefined);
  });

  it('[DATA] sets default version and emits audit', async () => {
    const res = await POST(makeRequest('wf-1', { namespace: 'ns-1', version: 2 }), {
      params: makeParams('wf-1'),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, name: 'wf-1', namespace: 'ns-1', version: 2 });
    expect(mockSetDefaultVersion).toHaveBeenCalledWith('ns-1', 'wf-1', 2);
    expect(mockAuditAppend).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'workflow.default_version_changed' }),
    );
  });

  it('[ERROR] returns 404 when version does not exist', async () => {
    mockGetWorkflowDefinition.mockResolvedValue(null);

    const res = await POST(makeRequest('wf-1', { namespace: 'ns-1', version: 9 }), {
      params: makeParams('wf-1'),
    });

    expect(res.status).toBe(404);
    expect(mockSetDefaultVersion).not.toHaveBeenCalled();
  });

  it('[AUTHZ] non-member sees 404 (anti-enum) — wrapper hides private wf from outsider', async () => {
    mockResolveCallerIdentity.mockReturnValue({
      kind: 'user',
      uid: 'u-1',
      namespaces: new Set(['other-ns']),
      isSystemActor: false,
    });

    const res = await POST(makeRequest('wf-1', { namespace: 'ns-1', version: 2 }), {
      params: makeParams('wf-1'),
    });

    expect(res.status).toBe(404);
    expect(mockSetDefaultVersion).not.toHaveBeenCalled();
  });

  it('[ERROR] returns 400 when version is missing', async () => {
    const res = await POST(makeRequest('wf-1', { namespace: 'ns-1' }), {
      params: makeParams('wf-1'),
    });

    expect(res.status).toBe(400);
  });
});
