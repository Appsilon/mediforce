import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetSecrets = vi.fn();
const mockSetSecrets = vi.fn();
const mockAuditAppend = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    secretsRepo: { getSecrets: mockGetSecrets, setSecrets: mockSetSecrets },
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

import { GET, PUT } from '../route';

function makeGetRequest(namespace: string | null, workflow: string | null): NextRequest {
  const url = new URL('http://localhost/api/workflow-secrets/values');
  if (namespace !== null) url.searchParams.set('namespace', namespace);
  if (workflow !== null) url.searchParams.set('workflow', workflow);
  return new NextRequest(url, { method: 'GET' });
}

function makePutRequest(namespace: string, workflow: string, body: unknown): NextRequest {
  const url = new URL('http://localhost/api/workflow-secrets/values');
  url.searchParams.set('namespace', namespace);
  url.searchParams.set('workflow', workflow);
  return new NextRequest(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/workflow-secrets/values', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey', isSystemActor: true });
    mockGetSecrets.mockResolvedValue({ API_KEY: 'sk-abc', WEBHOOK: 'https://x' });
  });

  it('[DATA] returns plaintext values for member and audits the reveal', async () => {
    const res = await GET(makeGetRequest('ns-1', 'wf-1'), {});
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ secrets: { API_KEY: 'sk-abc', WEBHOOK: 'https://x' } });
    expect(mockAuditAppend).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'workflow_secret.values_revealed' }),
    );
  });

  it('[AUTHZ] non-member gets 403 — value reveal cannot soft-fail', async () => {
    mockResolveCallerIdentity.mockReturnValue({
      kind: 'user',
      uid: 'u-1',
      namespaces: new Set(['other-ns']),
      isSystemActor: false,
    });

    const res = await GET(makeGetRequest('ns-1', 'wf-1'), {});

    expect(res.status).toBe(403);
    expect(mockGetSecrets).not.toHaveBeenCalled();
    expect(mockAuditAppend).not.toHaveBeenCalled();
  });

  it('[ERROR] returns 400 when workflow missing', async () => {
    const res = await GET(makeGetRequest('ns-1', null), {});
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/workflow-secrets/values', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey', isSystemActor: true });
    mockSetSecrets.mockResolvedValue(undefined);
  });

  it('[DATA] atomic bulk replace + audit', async () => {
    const res = await PUT(makePutRequest('ns-1', 'wf-1', { secrets: { K1: 'v1', K2: 'v2' } }), {});
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, savedKeyCount: 2 });
    expect(mockSetSecrets).toHaveBeenCalledWith('ns-1', 'wf-1', { K1: 'v1', K2: 'v2' });
    expect(mockAuditAppend).toHaveBeenCalledWith(expect.objectContaining({ action: 'workflow_secret.bulk_saved' }));
  });

  it('[AUTHZ] non-member gets 403 (wrapper assertNamespaceWrite)', async () => {
    mockResolveCallerIdentity.mockReturnValue({
      kind: 'user',
      uid: 'u-1',
      namespaces: new Set(['other-ns']),
      isSystemActor: false,
    });

    const res = await PUT(makePutRequest('ns-1', 'wf-1', { secrets: { K1: 'v1' } }), {});

    expect(res.status).toBe(403);
    expect(mockSetSecrets).not.toHaveBeenCalled();
  });

  it('[ERROR] returns 400 when secrets field is missing', async () => {
    const res = await PUT(makePutRequest('ns-1', 'wf-1', {}), {});
    expect(res.status).toBe(400);
  });
});
