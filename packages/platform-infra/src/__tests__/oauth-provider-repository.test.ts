import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { FirestoreOAuthProviderRepository } from '../firestore/oauth-provider-repository.js';
import {
  ProviderAlreadyExistsError,
  type CreateOAuthProviderInput,
  type OAuthProviderConfig,
} from '@mediforce/platform-core';

// Chainable Firestore mock — every call returns `chain` so
// `db.collection().doc().collection().doc().get()` and friends compose.
// Terminal calls (get/set/delete/where) are controllable spies.
const {
  mockGet, mockSet, mockDelete, mockWhere, mockDoc, mockCollection,
} = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockSet: vi.fn(),
  mockDelete: vi.fn(),
  mockWhere: vi.fn(),
  mockDoc: vi.fn(),
  mockCollection: vi.fn(),
}));

function buildChain() {
  return {
    doc: mockDoc,
    collection: mockCollection,
    where: mockWhere,
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
  mockWhere.mockReturnValue(chain);
  mockSet.mockResolvedValue(undefined);
  mockDelete.mockResolvedValue(undefined);
}

function makeFakeDb() {
  return { collection: mockCollection } as unknown as Firestore;
}

const providerInput: CreateOAuthProviderInput = {
  id: 'github',
  name: 'GitHub',
  clientId: 'Iv1.xxx',
  clientSecret: 'yyy',
  authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  userInfoUrl: 'https://api.github.com/user',
  scopes: ['repo'],
};

function storedProviderFor(
  input: CreateOAuthProviderInput,
  overrides: Partial<Pick<OAuthProviderConfig, 'createdAt' | 'updatedAt'>> = {},
): Omit<OAuthProviderConfig, 'id'> {
  const createdAt = overrides.createdAt ?? '2026-01-01T00:00:00.000Z';
  const updatedAt = overrides.updatedAt ?? createdAt;
  const { id: _id, ...rest } = input;
  return { ...rest, createdAt, updatedAt };
}

describe('FirestoreOAuthProviderRepository', () => {
  let repo: FirestoreOAuthProviderRepository;

  beforeEach(() => {
    resetChainMocks();
    repo = new FirestoreOAuthProviderRepository(makeFakeDb());
  });

  it('resolves to namespaces/{ns}/oauthProviders/{id} path on create', async () => {
    mockGet.mockResolvedValueOnce({ exists: false });
    await repo.create('acme', providerInput);

    const collectionCalls = mockCollection.mock.calls.map((c) => c[0]);
    const docCalls = mockDoc.mock.calls.map((c) => c[0]);
    expect(collectionCalls).toContain('namespaces');
    expect(collectionCalls).toContain('oauthProviders');
    expect(docCalls).toContain('acme');
    expect(docCalls).toContain('github');
  });

  it('creates a provider, stamping createdAt == updatedAt, and strips id from payload', async () => {
    mockGet.mockResolvedValueOnce({ exists: false });
    const created = await repo.create('acme', providerInput);

    expect(created.id).toBe('github');
    expect(created.createdAt).toBe(created.updatedAt);

    expect(mockSet).toHaveBeenCalledTimes(1);
    const persisted = mockSet.mock.calls[0][0] as Record<string, unknown>;
    expect(persisted.id).toBeUndefined();
    expect(persisted.clientId).toBe('Iv1.xxx');
    expect(persisted.clientSecret).toBe('yyy');
    expect(typeof persisted.createdAt).toBe('string');
    expect(typeof persisted.updatedAt).toBe('string');
  });

  it('throws ProviderAlreadyExistsError when the doc already exists', async () => {
    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({}) });
    await expect(repo.create('acme', providerInput)).rejects.toBeInstanceOf(
      ProviderAlreadyExistsError,
    );
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('get returns null when the doc does not exist', async () => {
    mockGet.mockResolvedValueOnce({ exists: false });
    const result = await repo.get('acme', 'ghost');
    expect(result).toBeNull();
  });

  it('get parses stored data and populates id from the doc path', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      id: 'github',
      data: () => storedProviderFor(providerInput),
    });
    const result = await repo.get('acme', 'github');
    expect(result?.id).toBe('github');
    expect(result?.clientSecret).toBe('yyy');
  });

  it('list maps snapshot docs into parsed entries sorted by id', async () => {
    mockGet.mockResolvedValueOnce({
      docs: [
        { id: 'zoom', data: () => storedProviderFor({ ...providerInput, id: 'zoom' }) },
        { id: 'github', data: () => storedProviderFor({ ...providerInput, id: 'github' }) },
      ],
    });
    const entries = await repo.list('acme');
    expect(entries.map((e) => e.id)).toEqual(['github', 'zoom']);
  });

  it('list returns empty array when no docs', async () => {
    mockGet.mockResolvedValueOnce({ docs: [] });
    const entries = await repo.list('empty');
    expect(entries).toEqual([]);
  });

  it('update returns null when the provider does not exist', async () => {
    mockGet.mockResolvedValueOnce({ exists: false });
    const result = await repo.update('acme', 'ghost', { name: 'x' });
    expect(result).toBeNull();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('update patches only supplied fields and advances updatedAt', async () => {
    const existing = storedProviderFor(providerInput, {
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    mockGet.mockResolvedValueOnce({
      exists: true,
      id: 'github',
      data: () => existing,
    });

    const patched = await repo.update('acme', 'github', { name: 'Renamed' });

    expect(patched?.name).toBe('Renamed');
    expect(patched?.clientSecret).toBe('yyy');
    expect(patched && patched.updatedAt > existing.updatedAt).toBe(true);
    expect(patched?.createdAt).toBe(existing.createdAt);

    expect(mockSet).toHaveBeenCalledTimes(1);
    const persisted = mockSet.mock.calls[0][0] as Record<string, unknown>;
    expect(persisted.id).toBeUndefined();
    expect(persisted.name).toBe('Renamed');
  });

  it('delete returns false when the doc does not exist and skips the delete call', async () => {
    mockGet.mockResolvedValueOnce({ exists: false });
    const result = await repo.delete('acme', 'ghost');
    expect(result).toBe(false);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('delete returns true and calls through to Firestore when the doc exists', async () => {
    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({}) });
    const result = await repo.delete('acme', 'github');
    expect(result).toBe(true);
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });
});
