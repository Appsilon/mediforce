import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { FirestoreToolCatalogRepository } from '../firestore/tool-catalog-repository.js';
import type { ToolCatalogEntry } from '@mediforce/platform-core';

// Mock Firestore using the chainable stub pattern used elsewhere in this
// package. Any call returns `chain` so `.collection().doc().get()` works;
// terminal calls (get/set/delete) are controllable spies.
const {
  mockGet, mockSet, mockDelete, mockDoc, mockCollection,
} = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockSet: vi.fn(),
  mockDelete: vi.fn(),
  mockDoc: vi.fn(),
  mockCollection: vi.fn(),
}));

function buildChain() {
  return {
    doc: mockDoc,
    collection: mockCollection,
    get: mockGet,
    set: mockSet,
    delete: mockDelete,
  };
}

function resetChainMocks() {
  vi.resetAllMocks();
  const chain = buildChain();
  mockCollection.mockReturnValue(chain);
  mockDoc.mockReturnValue(chain);
  mockSet.mockResolvedValue(undefined);
  mockDelete.mockResolvedValue(undefined);
}

function makeFakeDb() {
  return { collection: mockCollection } as unknown as Firestore;
}

describe('FirestoreToolCatalogRepository', () => {
  let repo: FirestoreToolCatalogRepository;

  beforeEach(() => {
    resetChainMocks();
    repo = new FirestoreToolCatalogRepository(makeFakeDb());
  });

  it('resolves to namespaces/{handle}/toolCatalog/{id} path on upsert', async () => {
    const entry: ToolCatalogEntry = {
      id: 'tealflow-mcp',
      command: 'tealflow-mcp',
      description: 'Tealflow MCP',
    };
    await repo.upsert('appsilon', entry);

    // collection('namespaces').doc('appsilon').collection('toolCatalog').doc('tealflow-mcp')
    const collectionCalls = mockCollection.mock.calls.map((c) => c[0]);
    const docCalls = mockDoc.mock.calls.map((c) => c[0]);
    expect(collectionCalls).toContain('namespaces');
    expect(collectionCalls).toContain('toolCatalog');
    expect(docCalls).toContain('appsilon');
    expect(docCalls).toContain('tealflow-mcp');
  });

  it('strips id from payload on upsert (id lives in the doc path)', async () => {
    const entry: ToolCatalogEntry = {
      id: 'tealflow-mcp',
      command: 'tealflow-mcp',
    };
    await repo.upsert('appsilon', entry);

    expect(mockSet).toHaveBeenCalledTimes(1);
    const persisted = mockSet.mock.calls[0][0] as Record<string, unknown>;
    expect(persisted.id).toBeUndefined();
    expect(persisted.command).toBe('tealflow-mcp');
  });

  it('getById returns null when the doc does not exist', async () => {
    mockGet.mockResolvedValueOnce({ exists: false });
    const result = await repo.getById('appsilon', 'missing');
    expect(result).toBeNull();
  });

  it('getById parses stored data and populates id from the doc path', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      id: 'tealflow-mcp',
      data: () => ({ command: 'tealflow-mcp', description: 'Tealflow MCP' }),
    });
    const result = await repo.getById('appsilon', 'tealflow-mcp');
    expect(result).toEqual({
      id: 'tealflow-mcp',
      command: 'tealflow-mcp',
      description: 'Tealflow MCP',
    });
  });

  it('list maps snapshot docs into parsed entries', async () => {
    mockGet.mockResolvedValueOnce({
      docs: [
        { id: 'a', data: () => ({ command: 'cmd-a' }) },
        { id: 'b', data: () => ({ command: 'cmd-b' }) },
      ],
    });
    const entries = await repo.list('appsilon');
    expect(entries).toEqual([
      { id: 'a', command: 'cmd-a' },
      { id: 'b', command: 'cmd-b' },
    ]);
  });

  it('rejects payload that violates catalog entry schema on upsert', async () => {
    const bogus = { id: 'x', command: '' } as unknown as ToolCatalogEntry;
    await expect(repo.upsert('appsilon', bogus)).rejects.toThrow();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('delete calls through to Firestore for the right doc', async () => {
    await repo.delete('appsilon', 'tealflow-mcp');
    const docCalls = mockDoc.mock.calls.map((c) => c[0]);
    expect(docCalls).toContain('tealflow-mcp');
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });
});
