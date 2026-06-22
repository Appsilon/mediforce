import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Route smoke for the [id] adapter. Handler behaviour is covered by L2
// handler tests in packages/platform-api/src/handlers/tool-catalog/__tests__/.
// This file only proves the dynamic-segment params + query namespace get
// stitched into the input shape correctly, plus the cross-cutting auth gate.

const mockCatalogGetById = vi.fn();
const mockCatalogUpsert = vi.fn();
const mockCatalogDelete = vi.fn();
const mockAuditAppend = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    toolCatalogRepo: {
      list: vi.fn(),
      getById: mockCatalogGetById,
      upsert: mockCatalogUpsert,
      delete: mockCatalogDelete,
    },
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

import { GET, PATCH, DELETE } from '../route';

const catalogEntry = {
  id: 'tealflow-mcp',
  command: 'npx',
  args: ['-y', 'tealflow-mcp'],
  description: 'TealFlow deployment MCP',
};

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

const makeParams = (id: string) => Promise.resolve({ id });

function makeGetRequest(id: string, namespace?: string): NextRequest {
  const url = new URL(`http://localhost/api/admin/tool-catalog/${id}`);
  if (namespace !== undefined) url.searchParams.set('namespace', namespace);
  return new NextRequest(url.toString());
}

function makePatchRequest(id: string, namespace: string | null, body: unknown): NextRequest {
  const url = new URL(`http://localhost/api/admin/tool-catalog/${id}`);
  if (namespace !== null) url.searchParams.set('namespace', namespace);
  return new NextRequest(url.toString(), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest(id: string, namespace?: string): NextRequest {
  const url = new URL(`http://localhost/api/admin/tool-catalog/${id}`);
  if (namespace !== undefined) url.searchParams.set('namespace', namespace);
  return new NextRequest(url.toString(), { method: 'DELETE' });
}

describe('GET /api/admin/tool-catalog/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockResolvedValue(adminCaller());
  });

  it('[DATA] returns entry by id (wiring smoke)', async () => {
    mockCatalogGetById.mockResolvedValue(catalogEntry);

    const res = await GET(makeGetRequest('tealflow-mcp', 'appsilon'), { params: makeParams('tealflow-mcp') });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.entry).toEqual(catalogEntry);
    expect(mockCatalogGetById).toHaveBeenCalledWith('appsilon', 'tealflow-mcp');
  });

  it('[ERROR] 404 when entry not found', async () => {
    mockCatalogGetById.mockResolvedValue(null);

    const res = await GET(makeGetRequest('unknown', 'appsilon'), { params: makeParams('unknown') });

    expect(res.status).toBe(404);
  });

  it('[AUTHZ] plain member gets 403 (bug fix)', async () => {
    mockResolveCallerIdentity.mockResolvedValue(memberCaller());

    const res = await GET(makeGetRequest('tealflow-mcp', 'appsilon'), { params: makeParams('tealflow-mcp') });

    expect(res.status).toBe(403);
    expect(mockCatalogGetById).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/admin/tool-catalog/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockResolvedValue(adminCaller());
    mockAuditAppend.mockResolvedValue(undefined);
  });

  it('[DATA] merges partial update with existing entry', async () => {
    mockCatalogGetById.mockResolvedValue(catalogEntry);
    mockCatalogUpsert.mockImplementation((_ns: string, entry: unknown) => Promise.resolve(entry));

    const res = await PATCH(makePatchRequest('tealflow-mcp', 'appsilon', { description: 'Updated description' }), {
      params: makeParams('tealflow-mcp'),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.entry).toEqual({
      ...catalogEntry,
      description: 'Updated description',
    });
    expect(mockCatalogUpsert).toHaveBeenCalledWith('appsilon', {
      ...catalogEntry,
      description: 'Updated description',
    });
  });

  it('[CANONICAL] path id wins over body id (rename attempt is silently ignored)', async () => {
    // The route adapter strips `id` from the body before validation, then
    // reinstates it from the path segment — bindings reference id, so renames
    // must never reach the repo.
    mockCatalogGetById.mockResolvedValue(catalogEntry);
    mockCatalogUpsert.mockImplementation((_ns: string, entry: unknown) => Promise.resolve(entry));

    const res = await PATCH(makePatchRequest('tealflow-mcp', 'appsilon', { id: 'renamed', description: 'x' }), {
      params: makeParams('tealflow-mcp'),
    });

    expect(res.status).toBe(200);
    expect(mockCatalogUpsert).toHaveBeenCalledWith('appsilon', {
      ...catalogEntry,
      description: 'x',
    });
  });

  it('[ERROR] 400 on schema validation failure', async () => {
    const res = await PATCH(makePatchRequest('tealflow-mcp', 'appsilon', { args: 'not-an-array' }), {
      params: makeParams('tealflow-mcp'),
    });

    expect(res.status).toBe(400);
  });

  it('[ERROR] 404 when entry does not exist', async () => {
    mockCatalogGetById.mockResolvedValue(null);

    const res = await PATCH(makePatchRequest('unknown', 'appsilon', { description: 'x' }), {
      params: makeParams('unknown'),
    });

    expect(res.status).toBe(404);
  });

  it('[AUTHZ] plain member gets 403 (bug fix)', async () => {
    mockResolveCallerIdentity.mockResolvedValue(memberCaller());

    const res = await PATCH(makePatchRequest('tealflow-mcp', 'appsilon', { description: 'x' }), {
      params: makeParams('tealflow-mcp'),
    });

    expect(res.status).toBe(403);
    expect(mockCatalogUpsert).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/tool-catalog/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockResolvedValue(adminCaller());
    mockAuditAppend.mockResolvedValue(undefined);
  });

  it('[DATA] deletes an existing entry', async () => {
    mockCatalogGetById.mockResolvedValue(catalogEntry);
    mockCatalogDelete.mockResolvedValue(undefined);

    const res = await DELETE(makeDeleteRequest('tealflow-mcp', 'appsilon'), { params: makeParams('tealflow-mcp') });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockCatalogDelete).toHaveBeenCalledWith('appsilon', 'tealflow-mcp');
  });

  it('[DATA] idempotent — 200 even when entry does not exist', async () => {
    mockCatalogGetById.mockResolvedValue(null);
    mockCatalogDelete.mockResolvedValue(undefined);

    const res = await DELETE(makeDeleteRequest('unknown', 'appsilon'), { params: makeParams('unknown') });

    expect(res.status).toBe(200);
    expect(mockCatalogDelete).toHaveBeenCalledWith('appsilon', 'unknown');
  });

  it('[AUTHZ] plain member gets 403 (bug fix)', async () => {
    mockResolveCallerIdentity.mockResolvedValue(memberCaller());

    const res = await DELETE(makeDeleteRequest('tealflow-mcp', 'appsilon'), { params: makeParams('tealflow-mcp') });

    expect(res.status).toBe(403);
    expect(mockCatalogDelete).not.toHaveBeenCalled();
  });
});
