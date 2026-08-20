import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockTransferNamespace = vi.fn();
const mockTriggerTransfer = vi.fn();
const mockAuditAppend = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    processRepo: { transferWorkflowNamespace: mockTransferNamespace },
    triggerRepo: { transferWorkflowNamespace: mockTriggerTransfer },
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
  return new NextRequest(
    `http://localhost/api/workflow-definitions/${encodeURIComponent(name)}/transfer`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

describe('POST /api/workflow-definitions/:name/transfer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey', isSystemActor: true });
    mockTransferNamespace.mockResolvedValue(undefined);
  });

  it('[DATA] transfers workflow and returns 200 with success envelope', async () => {
    const res = await POST(
      makeRequest('my-wf', { sourceNamespace: 'src', targetNamespace: 'tgt' }),
      { params: makeParams('my-wf') },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      success: true,
      name: 'my-wf',
      sourceNamespace: 'src',
      targetNamespace: 'tgt',
    });
    expect(mockTransferNamespace).toHaveBeenCalledWith('src', 'my-wf', 'tgt');
    expect(mockTriggerTransfer).toHaveBeenCalledWith('src', 'my-wf', 'tgt');
    expect(mockAuditAppend).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'workflow.transferred', entityId: 'my-wf' }),
    );
  });

  it('[AUTHZ] returns 403 when caller is missing source namespace membership', async () => {
    mockResolveCallerIdentity.mockReturnValue({
      kind: 'user',
      uid: 'u-1',
      namespaces: new Set(['tgt']),
      isSystemActor: false,
    });

    const res = await POST(
      makeRequest('my-wf', { sourceNamespace: 'src', targetNamespace: 'tgt' }),
      { params: makeParams('my-wf') },
    );

    expect(res.status).toBe(403);
    expect(mockTransferNamespace).not.toHaveBeenCalled();
    expect(mockAuditAppend).not.toHaveBeenCalled();
  });

  it('[AUTHZ] returns 403 when caller is missing target namespace membership', async () => {
    mockResolveCallerIdentity.mockReturnValue({
      kind: 'user',
      uid: 'u-1',
      namespaces: new Set(['src']),
      isSystemActor: false,
    });

    const res = await POST(
      makeRequest('my-wf', { sourceNamespace: 'src', targetNamespace: 'tgt' }),
      { params: makeParams('my-wf') },
    );

    expect(res.status).toBe(403);
    expect(mockTransferNamespace).not.toHaveBeenCalled();
  });

  it('[ERROR] returns 400 on missing sourceNamespace', async () => {
    const res = await POST(
      makeRequest('my-wf', { targetNamespace: 'tgt' }),
      { params: makeParams('my-wf') },
    );

    expect(res.status).toBe(400);
    expect(mockTransferNamespace).not.toHaveBeenCalled();
  });
});
