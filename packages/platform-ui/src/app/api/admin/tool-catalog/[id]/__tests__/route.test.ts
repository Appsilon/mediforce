import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---- Mocks ----

const mockNamespaceGet = vi.fn();
const mockCatalogGetById = vi.fn();
const mockCatalogUpsert = vi.fn();
const mockCatalogDelete = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    namespaceRepo: { getNamespace: mockNamespaceGet },
    toolCatalogRepo: {
      getById: mockCatalogGetById,
      upsert: mockCatalogUpsert,
      delete: mockCatalogDelete,
    },
  }),
}));

import { GET, PATCH, DELETE } from '../route';

// ---- Helpers ----

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

// ---- GET ----

describe('GET /api/admin/tool-catalog/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('[DATA] returns entry by id', async () => {
    mockNamespaceGet.mockResolvedValue(existingNamespace);
    mockCatalogGetById.mockResolvedValue(catalogEntry);

    const res = await GET(
      makeGetRequest('tealflow-mcp', 'appsilon'),
      { params: makeParams('tealflow-mcp') },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.entry).toEqual(catalogEntry);
  });

  it('[ERROR] 400 when namespace missing', async () => {
    const res = await GET(
      makeGetRequest('tealflow-mcp'),
      { params: makeParams('tealflow-mcp') },
    );
    expect(res.status).toBe(400);
  });

  it('[ERROR] 404 when namespace does not exist', async () => {
    mockNamespaceGet.mockResolvedValue(null);
    const res = await GET(
      makeGetRequest('tealflow-mcp', 'nope'),
      { params: makeParams('tealflow-mcp') },
    );
    expect(res.status).toBe(404);
  });

  it('[ERROR] 404 when entry not found', async () => {
    mockNamespaceGet.mockResolvedValue(existingNamespace);
    mockCatalogGetById.mockResolvedValue(null);

    const res = await GET(
      makeGetRequest('unknown', 'appsilon'),
      { params: makeParams('unknown') },
    );
    expect(res.status).toBe(404);
  });
});

// ---- PATCH ----

describe('PATCH /api/admin/tool-catalog/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('[DATA] merges partial update with existing entry', async () => {
    mockNamespaceGet.mockResolvedValue(existingNamespace);
    mockCatalogGetById.mockResolvedValue(catalogEntry);
    mockCatalogUpsert.mockImplementation((_ns: string, entry: unknown) => Promise.resolve(entry));

    const res = await PATCH(
      makePatchRequest('tealflow-mcp', 'appsilon', { description: 'Updated description' }),
      { params: makeParams('tealflow-mcp') },
    );
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

  it('[DATA] preserves the path-param id even if body tries to override', async () => {
    mockNamespaceGet.mockResolvedValue(existingNamespace);
    mockCatalogGetById.mockResolvedValue(catalogEntry);

    // body.id is forbidden by .strict() — ensures the PATCH schema blocks
    // renames that would silently break existing bindings.
    const res = await PATCH(
      makePatchRequest('tealflow-mcp', 'appsilon', { id: 'renamed' }),
      { params: makeParams('tealflow-mcp') },
    );
    expect(res.status).toBe(400);
    expect(mockCatalogUpsert).not.toHaveBeenCalled();
  });

  it('[ERROR] 400 on schema validation failure', async () => {
    mockNamespaceGet.mockResolvedValue(existingNamespace);

    const res = await PATCH(
      makePatchRequest('tealflow-mcp', 'appsilon', { args: 'not-an-array' }),
      { params: makeParams('tealflow-mcp') },
    );
    expect(res.status).toBe(400);
  });

  it('[ERROR] 404 when entry does not exist', async () => {
    mockNamespaceGet.mockResolvedValue(existingNamespace);
    mockCatalogGetById.mockResolvedValue(null);

    const res = await PATCH(
      makePatchRequest('unknown', 'appsilon', { description: 'x' }),
      { params: makeParams('unknown') },
    );
    expect(res.status).toBe(404);
  });

  it('[ERROR] 404 when namespace missing', async () => {
    mockNamespaceGet.mockResolvedValue(null);

    const res = await PATCH(
      makePatchRequest('tealflow-mcp', 'nope', { description: 'x' }),
      { params: makeParams('tealflow-mcp') },
    );
    expect(res.status).toBe(404);
  });
});

// ---- DELETE ----

describe('DELETE /api/admin/tool-catalog/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('[DATA] deletes an existing entry', async () => {
    mockNamespaceGet.mockResolvedValue(existingNamespace);
    mockCatalogDelete.mockResolvedValue(undefined);

    const res = await DELETE(
      makeDeleteRequest('tealflow-mcp', 'appsilon'),
      { params: makeParams('tealflow-mcp') },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockCatalogDelete).toHaveBeenCalledWith('appsilon', 'tealflow-mcp');
  });

  it('[DATA] idempotent — 200 even when entry does not exist', async () => {
    mockNamespaceGet.mockResolvedValue(existingNamespace);
    mockCatalogDelete.mockResolvedValue(undefined);

    const res = await DELETE(
      makeDeleteRequest('unknown', 'appsilon'),
      { params: makeParams('unknown') },
    );
    expect(res.status).toBe(200);
    expect(mockCatalogDelete).toHaveBeenCalledWith('appsilon', 'unknown');
  });

  it('[ERROR] 404 when namespace missing', async () => {
    mockNamespaceGet.mockResolvedValue(null);

    const res = await DELETE(
      makeDeleteRequest('tealflow-mcp', 'nope'),
      { params: makeParams('tealflow-mcp') },
    );
    expect(res.status).toBe(404);
    expect(mockCatalogDelete).not.toHaveBeenCalled();
  });
});
