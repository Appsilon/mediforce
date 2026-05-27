import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Route-level smoke. Handler behaviour (role gate, audit, deleter contract)
// is covered exhaustively at L2 in
// packages/platform-api/src/handlers/docker-images/__tests__/. What remains
// here: prove the Next.js route wires schema, services, and handler together.

const mockDeleterDelete = vi.fn();
const mockAuditAppend = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    dockerImageDeleter: { delete: mockDeleterDelete },
    auditRepo: { append: mockAuditAppend },
    instanceRepo: { getById: vi.fn() },
    namespaceRepo: {},
  }),
  getAppBaseUrl: () => 'http://localhost:3000',
}));

const mockResolveCallerIdentity = vi.fn();

vi.mock('@/lib/api-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-auth')>('@/lib/api-auth');
  return {
    ...actual,
    resolveCallerIdentity: (...args: unknown[]) => mockResolveCallerIdentity(...args),
  };
});

import { DELETE } from '../route';

function adminCaller(handle = 'appsilon') {
  return {
    kind: 'user' as const,
    uid: 'uid-admin',
    namespaces: new Set([handle]),
    namespaceRoles: new Map([[handle, 'admin' as const]]),
    isSystemActor: false as const,
  };
}

function memberCaller(handle = 'appsilon') {
  return {
    kind: 'user' as const,
    uid: 'uid-member',
    namespaces: new Set([handle]),
    namespaceRoles: new Map([[handle, 'member' as const]]),
    isSystemActor: false as const,
  };
}

const apiKeyCaller = { kind: 'apiKey' as const, isSystemActor: true as const };

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/admin/docker-images', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('DELETE /api/admin/docker-images', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockResolvedValue(adminCaller());
    mockAuditAppend.mockResolvedValue(undefined);
    mockDeleterDelete.mockResolvedValue({ deleted: 'sha256:abc' });
  });

  it('[DATA] deletes the image for an admin caller', async () => {
    const res = await DELETE(makeRequest({ imageId: 'sha256:abc' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.deleted).toBe('sha256:abc');
    expect(mockDeleterDelete).toHaveBeenCalledWith('sha256:abc');
    expect(mockAuditAppend).toHaveBeenCalledTimes(1);
  });

  it('[AUTHZ] api-key caller passes', async () => {
    mockResolveCallerIdentity.mockResolvedValue(apiKeyCaller);

    const res = await DELETE(makeRequest({ imageId: 'sha256:abc' }));
    expect(res.status).toBe(200);
    expect(mockDeleterDelete).toHaveBeenCalled();
  });

  it('[AUTHZ] plain member gets 403', async () => {
    mockResolveCallerIdentity.mockResolvedValue(memberCaller());

    const res = await DELETE(makeRequest({ imageId: 'sha256:abc' }));

    expect(res.status).toBe(403);
    expect(mockDeleterDelete).not.toHaveBeenCalled();
  });

  it('[ERROR] 400 when imageId is missing', async () => {
    const res = await DELETE(makeRequest({}));

    expect(res.status).toBe(400);
    expect(mockDeleterDelete).not.toHaveBeenCalled();
  });

  it('[ERROR] 400 when imageId is empty string', async () => {
    const res = await DELETE(makeRequest({ imageId: '   ' }));

    expect(res.status).toBe(400);
    expect(mockDeleterDelete).not.toHaveBeenCalled();
  });
});
