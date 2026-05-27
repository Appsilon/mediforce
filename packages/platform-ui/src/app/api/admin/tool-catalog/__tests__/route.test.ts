import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Route-level smoke. Handler behaviour (role gate, audit, conflict mapping,
// slug derivation) is covered exhaustively at L2 in
// packages/platform-api/src/handlers/tool-catalog/__tests__/. The adapter
// pipeline (HandlerError → HTTP status) is covered by route-adapter tests.
// What remains here: prove the Next.js route wires schema, services, and
// handler together, plus a couple of cross-cutting auth scenarios.

const mockCatalogList = vi.fn();
const mockCatalogGetById = vi.fn();
const mockCatalogUpsert = vi.fn();
const mockAuditAppend = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    toolCatalogRepo: {
      list: mockCatalogList,
      getById: mockCatalogGetById,
      upsert: mockCatalogUpsert,
      delete: vi.fn(),
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

import { GET, POST } from '../route';

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

function makeGetRequest(namespace?: string): NextRequest {
  const url = new URL('http://localhost/api/admin/tool-catalog');
  if (namespace !== undefined) url.searchParams.set('namespace', namespace);
  return new NextRequest(url.toString());
}

function makePostRequest(namespace: string | null, body: unknown): NextRequest {
  const url = new URL('http://localhost/api/admin/tool-catalog');
  if (namespace !== null) url.searchParams.set('namespace', namespace);
  return new NextRequest(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const catalogEntry = {
  id: 'tealflow-mcp',
  command: 'npx',
  args: ['-y', 'tealflow-mcp'],
  description: 'TealFlow deployment MCP',
};

describe('GET /api/admin/tool-catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockResolvedValue(adminCaller());
    mockAuditAppend.mockResolvedValue(undefined);
  });

  it('[DATA] lists entries in a namespace', async () => {
    mockCatalogList.mockResolvedValue([catalogEntry]);

    const res = await GET(makeGetRequest('appsilon'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.entries).toEqual([catalogEntry]);
    expect(mockCatalogList).toHaveBeenCalledWith('appsilon');
  });

  it('[ERROR] 400 when namespace missing', async () => {
    const res = await GET(makeGetRequest());

    expect(res.status).toBe(400);
    expect(mockCatalogList).not.toHaveBeenCalled();
  });

  it('[AUTHZ] api-key caller passes', async () => {
    mockResolveCallerIdentity.mockResolvedValue(apiKeyCaller);
    mockCatalogList.mockResolvedValue([]);

    const res = await GET(makeGetRequest('appsilon'));
    expect(res.status).toBe(200);
  });

  it('[AUTHZ] plain member gets 403 (bug fix)', async () => {
    mockResolveCallerIdentity.mockResolvedValue(memberCaller());

    const res = await GET(makeGetRequest('appsilon'));

    expect(res.status).toBe(403);
    expect(mockCatalogList).not.toHaveBeenCalled();
  });

  it('[AUTHZ] non-member (no role on namespace) gets 403', async () => {
    mockResolveCallerIdentity.mockResolvedValue(adminCaller('other-ns'));

    const res = await GET(makeGetRequest('appsilon'));

    expect(res.status).toBe(403);
    expect(mockCatalogList).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/tool-catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockResolvedValue(adminCaller());
    mockAuditAppend.mockResolvedValue(undefined);
  });

  it('[DATA] creates an entry with client-supplied id (201)', async () => {
    mockCatalogGetById.mockResolvedValue(null);
    mockCatalogUpsert.mockResolvedValue(catalogEntry);

    const res = await POST(makePostRequest('appsilon', catalogEntry));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.entry).toEqual(catalogEntry);
    expect(mockCatalogUpsert).toHaveBeenCalledWith('appsilon', catalogEntry);
  });

  it('[DATA] derives id from command when not supplied', async () => {
    mockCatalogGetById.mockResolvedValue(null);
    mockCatalogUpsert.mockImplementation(
      (_ns: string, entry: unknown) => Promise.resolve(entry),
    );

    const res = await POST(
      makePostRequest('appsilon', { command: '/usr/bin/npx', args: ['-y', 'foo'] }),
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.entry.id).toBe('npx');
    expect(mockCatalogGetById).toHaveBeenCalledWith('appsilon', 'npx');
  });

  it('[ERROR] 400 when namespace missing', async () => {
    const res = await POST(makePostRequest(null, catalogEntry));
    expect(res.status).toBe(400);
    expect(mockCatalogUpsert).not.toHaveBeenCalled();
  });

  it('[ERROR] 400 on schema validation failure (missing command)', async () => {
    const res = await POST(makePostRequest('appsilon', { id: 'foo' }));

    expect(res.status).toBe(400);
    expect(mockCatalogUpsert).not.toHaveBeenCalled();
  });

  it('[ERROR] 400 on unknown field (strict schema)', async () => {
    const res = await POST(
      makePostRequest('appsilon', {
        id: 'foo',
        command: 'npx',
        rogueField: 'should not be accepted',
      }),
    );

    expect(res.status).toBe(400);
  });

  it('[ERROR] 400 when id cannot be derived from command', async () => {
    const res = await POST(makePostRequest('appsilon', { args: ['-y'] }));

    expect(res.status).toBe(400);
  });

  it('[ERROR] 409 on deterministic-slug collision', async () => {
    mockCatalogGetById.mockResolvedValue(catalogEntry);

    const res = await POST(makePostRequest('appsilon', catalogEntry));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(JSON.stringify(json)).toContain('tealflow-mcp');
    expect(mockCatalogUpsert).not.toHaveBeenCalled();
  });

  it('[AUTHZ] plain member gets 403 on POST (bug fix)', async () => {
    mockResolveCallerIdentity.mockResolvedValue(memberCaller());

    const res = await POST(makePostRequest('appsilon', catalogEntry));

    expect(res.status).toBe(403);
    expect(mockCatalogUpsert).not.toHaveBeenCalled();
  });
});
