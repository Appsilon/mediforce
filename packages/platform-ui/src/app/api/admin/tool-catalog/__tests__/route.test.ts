import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---- Mocks ----

const mockNamespaceGet = vi.fn();
const mockCatalogList = vi.fn();
const mockCatalogGetById = vi.fn();
const mockCatalogUpsert = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    namespaceRepo: { getNamespace: mockNamespaceGet },
    toolCatalogRepo: {
      list: mockCatalogList,
      getById: mockCatalogGetById,
      upsert: mockCatalogUpsert,
    },
  }),
}));

import { GET, POST } from '../route';

// ---- Helpers ----

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

const existingNamespace = {
  handle: 'appsilon',
  type: 'organization',
  displayName: 'Appsilon',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const catalogEntry = {
  id: 'tealflow-mcp',
  command: 'npx',
  args: ['-y', 'tealflow-mcp'],
  description: 'TealFlow deployment MCP',
};

// ---- Tests ----

describe('GET /api/admin/tool-catalog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('[DATA] lists entries in a namespace', async () => {
    mockNamespaceGet.mockResolvedValue(existingNamespace);
    mockCatalogList.mockResolvedValue([catalogEntry]);

    const res = await GET(makeGetRequest('appsilon'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.entries).toEqual([catalogEntry]);
    expect(mockCatalogList).toHaveBeenCalledWith('appsilon');
  });

  it('[ERROR] 400 when namespace query param is missing', async () => {
    const res = await GET(makeGetRequest());
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('namespace');
    expect(mockNamespaceGet).not.toHaveBeenCalled();
  });

  it('[ERROR] 404 when namespace does not exist', async () => {
    mockNamespaceGet.mockResolvedValue(null);

    const res = await GET(makeGetRequest('nope'));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('nope');
    expect(mockCatalogList).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/tool-catalog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('[DATA] creates an entry with client-supplied id', async () => {
    mockNamespaceGet.mockResolvedValue(existingNamespace);
    mockCatalogGetById.mockResolvedValue(null);
    mockCatalogUpsert.mockResolvedValue(catalogEntry);

    const res = await POST(makePostRequest('appsilon', catalogEntry));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.entry).toEqual(catalogEntry);
    expect(mockCatalogUpsert).toHaveBeenCalledWith('appsilon', catalogEntry);
  });

  it('[DATA] derives id from command when not supplied', async () => {
    mockNamespaceGet.mockResolvedValue(existingNamespace);
    mockCatalogGetById.mockResolvedValue(null);
    mockCatalogUpsert.mockImplementation((_ns: string, entry: unknown) => Promise.resolve(entry));

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

  it('[ERROR] 400 on schema validation failure', async () => {
    mockNamespaceGet.mockResolvedValue(existingNamespace);

    // missing required `command`
    const res = await POST(makePostRequest('appsilon', { id: 'foo' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Validation failed');
    expect(mockCatalogUpsert).not.toHaveBeenCalled();
  });

  it('[ERROR] 400 on unknown field (strict schema)', async () => {
    mockNamespaceGet.mockResolvedValue(existingNamespace);

    const res = await POST(
      makePostRequest('appsilon', {
        id: 'foo',
        command: 'npx',
        rogueField: 'should not be accepted',
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Validation failed');
  });

  it('[ERROR] 400 when id cannot be derived from command', async () => {
    mockNamespaceGet.mockResolvedValue(existingNamespace);

    const res = await POST(makePostRequest('appsilon', { args: ['-y'] }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('id');
  });

  it('[ERROR] 404 when namespace does not exist', async () => {
    mockNamespaceGet.mockResolvedValue(null);

    const res = await POST(makePostRequest('nope', catalogEntry));
    expect(res.status).toBe(404);
    expect(mockCatalogUpsert).not.toHaveBeenCalled();
  });

  it('[ERROR] 409 on deterministic-slug collision', async () => {
    mockNamespaceGet.mockResolvedValue(existingNamespace);
    mockCatalogGetById.mockResolvedValue(catalogEntry);

    const res = await POST(makePostRequest('appsilon', catalogEntry));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toContain('tealflow-mcp');
    expect(mockCatalogUpsert).not.toHaveBeenCalled();
  });
});
