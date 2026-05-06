import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { FirestoreConnectionRepository } from '../firestore/connection-repository.js';
import {
  ConnectionAlreadyExistsError,
  ConnectionNotFoundError,
  ConnectionNotOAuthError,
  type Connection,
  type CreateConnectionInput,
} from '@mediforce/platform-core';

const {
  mockGet,
  mockSet,
  mockDelete,
  mockDoc,
  mockCollection,
  mockRunTransaction,
  mockTxGet,
  mockTxSet,
} = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockSet: vi.fn(),
  mockDelete: vi.fn(),
  mockDoc: vi.fn(),
  mockCollection: vi.fn(),
  mockRunTransaction: vi.fn(),
  mockTxGet: vi.fn(),
  mockTxSet: vi.fn(),
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
  mockTxSet.mockReturnValue(undefined);
  mockRunTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({ get: mockTxGet, set: mockTxSet }),
  );
}

function makeFakeDb() {
  return {
    collection: mockCollection,
    runTransaction: mockRunTransaction,
  } as unknown as Firestore;
}

const oauthInput: CreateConnectionInput = {
  id: 'github-mediforce',
  name: 'GitHub (Mediforce)',
  auth: { type: 'oauth', providerId: 'github' },
};

const headersInput: CreateConnectionInput = {
  id: 'static-jira',
  name: 'Jira static',
  auth: { type: 'headers', headers: { 'X-Api-Key': '{{SECRET:k}}' } },
};

function snapFor(conn: Connection): { exists: true; id: string; data: () => unknown } {
  const { id: _id, ...body } = conn;
  return { exists: true, id: conn.id, data: () => body };
}

function makeStoredOauth(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'github-mediforce',
    name: 'GitHub (Mediforce)',
    auth: {
      type: 'oauth',
      providerId: 'github',
      accessToken: 'gho_old',
      refreshToken: 'ghr_old',
      expiresAt: 1_800_000_000_000,
      scope: 'repo',
      providerUserId: '12345',
      accountLogin: 'octocat',
      connectedBy: 'user-1',
      connectedAt: 1_700_000_000_000,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('FirestoreConnectionRepository — paths and CRUD', () => {
  let repo: FirestoreConnectionRepository;

  beforeEach(() => {
    resetChainMocks();
    repo = new FirestoreConnectionRepository(makeFakeDb());
  });

  it('resolves to namespaces/{ns}/connections/{id} path on create', async () => {
    mockGet.mockResolvedValueOnce({ exists: false });
    await repo.create('acme', oauthInput);

    const collectionCalls = mockCollection.mock.calls.map((c) => c[0]);
    const docCalls = mockDoc.mock.calls.map((c) => c[0]);
    expect(collectionCalls).toContain('namespaces');
    expect(collectionCalls).toContain('connections');
    expect(docCalls).toContain('acme');
    expect(docCalls).toContain('github-mediforce');
  });

  it('creates an oauth connection and strips id from payload', async () => {
    mockGet.mockResolvedValueOnce({ exists: false });
    const created = await repo.create('acme', oauthInput);

    expect(created.id).toBe('github-mediforce');
    expect(created.createdAt).toBe(created.updatedAt);

    expect(mockSet).toHaveBeenCalledTimes(1);
    const persisted = mockSet.mock.calls[0][0] as Record<string, unknown>;
    expect(persisted.id).toBeUndefined();
    expect(persisted.name).toBe('GitHub (Mediforce)');
    expect((persisted.auth as { type: string }).type).toBe('oauth');
  });

  it('create throws ConnectionAlreadyExistsError on duplicate id', async () => {
    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({}) });
    await expect(repo.create('acme', oauthInput)).rejects.toBeInstanceOf(
      ConnectionAlreadyExistsError,
    );
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('getById returns null for missing doc', async () => {
    mockGet.mockResolvedValueOnce({ exists: false });
    expect(await repo.getById('acme', 'nope')).toBeNull();
  });

  it('getById parses stored doc through ConnectionSchema', async () => {
    const stored = makeStoredOauth();
    mockGet.mockResolvedValueOnce(snapFor(stored));
    const fetched = await repo.getById('acme', 'github-mediforce');
    expect(fetched).toEqual(stored);
  });

  it('list sorts by id', async () => {
    const a = makeStoredOauth({ id: 'github-personal' });
    const b = makeStoredOauth({ id: 'github-mediforce' });
    mockGet.mockResolvedValueOnce({
      docs: [
        { id: a.id, data: () => snapFor(a).data() },
        { id: b.id, data: () => snapFor(b).data() },
      ],
    });
    const list = await repo.list('acme');
    expect(list.map((c) => c.id)).toEqual(['github-mediforce', 'github-personal']);
  });

  it('update returns null when doc missing', async () => {
    mockGet.mockResolvedValueOnce({ exists: false });
    expect(await repo.update('acme', 'nope', { name: 'x' })).toBeNull();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('update merges patch onto current and bumps updatedAt', async () => {
    const stored = makeStoredOauth();
    mockGet.mockResolvedValueOnce(snapFor(stored));
    const updated = await repo.update('acme', stored.id, { name: 'Renamed' });
    expect(updated?.name).toBe('Renamed');
    expect(updated?.createdAt).toBe(stored.createdAt);
    expect(updated?.updatedAt).not.toBe(stored.updatedAt);
    const persisted = mockSet.mock.calls[0][0] as Record<string, unknown>;
    expect(persisted.id).toBeUndefined();
    expect(persisted.name).toBe('Renamed');
  });

  it('delete returns true on hit, false on miss', async () => {
    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({}) });
    expect(await repo.delete('acme', 'gh')).toBe(true);
    expect(mockDelete).toHaveBeenCalledTimes(1);

    resetChainMocks();
    repo = new FirestoreConnectionRepository(makeFakeDb());
    mockGet.mockResolvedValueOnce({ exists: false });
    expect(await repo.delete('acme', 'gh')).toBe(false);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe('FirestoreConnectionRepository — setTokens (transaction)', () => {
  let repo: FirestoreConnectionRepository;

  beforeEach(() => {
    resetChainMocks();
    repo = new FirestoreConnectionRepository(makeFakeDb());
  });

  it('writes new tokens onto an oauth connection inside a transaction', async () => {
    const stored = makeStoredOauth();
    mockTxGet.mockResolvedValueOnce(snapFor(stored));
    const updated = await repo.setTokens('acme', stored.id, {
      accessToken: 'gho_NEW',
      refreshToken: 'ghr_NEW',
      expiresAt: 1_900_000_000_000,
      scope: 'repo read:user',
    });
    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
    expect(mockTxSet).toHaveBeenCalledTimes(1);
    const persisted = mockTxSet.mock.calls[0][1] as Record<string, unknown>;
    const auth = persisted.auth as { accessToken: string; refreshToken: string; expiresAt: number };
    expect(auth.accessToken).toBe('gho_NEW');
    expect(auth.refreshToken).toBe('ghr_NEW');
    expect(auth.expiresAt).toBe(1_900_000_000_000);
    if (updated.auth.type === 'oauth') {
      expect(updated.auth.accessToken).toBe('gho_NEW');
      expect(updated.auth.connectedAt).toBeGreaterThan(0);
    }
  });

  it('preserves existing token fields when patch omits them', async () => {
    const stored = makeStoredOauth();
    mockTxGet.mockResolvedValueOnce(snapFor(stored));
    const updated = await repo.setTokens('acme', stored.id, { accessToken: 'just-access' });
    if (updated.auth.type === 'oauth') {
      expect(updated.auth.accessToken).toBe('just-access');
      expect(updated.auth.refreshToken).toBe('ghr_old');
      expect(updated.auth.expiresAt).toBe(1_800_000_000_000);
      expect(updated.auth.scope).toBe('repo');
    }
  });

  it('throws ConnectionNotFoundError when doc missing', async () => {
    mockTxGet.mockResolvedValueOnce({ exists: false });
    await expect(
      repo.setTokens('acme', 'nope', { accessToken: 'x' }),
    ).rejects.toBeInstanceOf(ConnectionNotFoundError);
    expect(mockTxSet).not.toHaveBeenCalled();
  });

  it('throws ConnectionNotOAuthError for headers-typed connection', async () => {
    const stored: Connection = {
      ...headersInput,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    mockTxGet.mockResolvedValueOnce(snapFor(stored));
    await expect(
      repo.setTokens('acme', stored.id, { accessToken: 'x' }),
    ).rejects.toBeInstanceOf(ConnectionNotOAuthError);
  });
});

describe('FirestoreConnectionRepository — runWithLock (transaction)', () => {
  let repo: FirestoreConnectionRepository;

  beforeEach(() => {
    resetChainMocks();
    repo = new FirestoreConnectionRepository(makeFakeDb());
  });

  it('runs the callback inside a transaction with the current connection', async () => {
    const stored = makeStoredOauth();
    mockTxGet.mockResolvedValueOnce(snapFor(stored));

    const observed: unknown[] = [];
    const result = await repo.runWithLock('acme', stored.id, async (current) => {
      observed.push(current);
      return 'no-write' as const;
    });

    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
    expect(observed[0]).toEqual(stored);
    expect(result).toBe('no-write');
    expect(mockTxSet).not.toHaveBeenCalled();
  });

  it('passes null when the connection does not exist', async () => {
    mockTxGet.mockResolvedValueOnce({ exists: false });
    let received: unknown = 'sentinel';
    await repo.runWithLock('acme', 'missing', async (current) => {
      received = current;
    });
    expect(received).toBeNull();
  });

  it('persists a Connection returned by the callback (refresh path)', async () => {
    const stored = makeStoredOauth();
    mockTxGet.mockResolvedValueOnce(snapFor(stored));

    const refreshed: Connection = {
      ...stored,
      auth: {
        ...stored.auth,
        accessToken: 'gho_REFRESHED',
        expiresAt: 1_950_000_000_000,
      } as Connection['auth'],
    };

    const returned = await repo.runWithLock<Connection>('acme', stored.id, async () => refreshed);
    expect(mockTxSet).toHaveBeenCalledTimes(1);
    const persisted = mockTxSet.mock.calls[0][1] as Record<string, unknown>;
    expect(persisted.id).toBeUndefined();
    const auth = persisted.auth as { accessToken: string };
    expect(auth.accessToken).toBe('gho_REFRESHED');
    expect(returned.auth.type).toBe('oauth');
  });

  it('skips persistence when the callback returns a non-Connection value', async () => {
    const stored = makeStoredOauth();
    mockTxGet.mockResolvedValueOnce(snapFor(stored));
    await repo.runWithLock('acme', stored.id, async () => ({ unrelated: 'thing' }));
    expect(mockTxSet).not.toHaveBeenCalled();
  });
});
