import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { FirestoreAgentOAuthTokenRepository } from '../firestore/agent-oauth-token-repository.js';
import type { AgentOAuthToken } from '@mediforce/platform-core';

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

const tokenFixture: AgentOAuthToken = {
  provider: 'github',
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: 1_700_000_000_000,
  scope: 'repo',
  providerUserId: '12345',
  accountLogin: '@octocat',
  connectedAt: 1_699_000_000_000,
  connectedBy: 'firebase-uid',
};

describe('FirestoreAgentOAuthTokenRepository', () => {
  let repo: FirestoreAgentOAuthTokenRepository;

  beforeEach(() => {
    resetChainMocks();
    repo = new FirestoreAgentOAuthTokenRepository(makeFakeDb());
  });

  it('resolves to namespaces/{ns}/agentOAuthTokens/{agentId__serverName} on put', async () => {
    await repo.put('acme', 'agent-1', 'github', tokenFixture);

    const collectionCalls = mockCollection.mock.calls.map((c) => c[0]);
    const docCalls = mockDoc.mock.calls.map((c) => c[0]);
    expect(collectionCalls).toContain('namespaces');
    expect(collectionCalls).toContain('agentOAuthTokens');
    expect(docCalls).toContain('acme');
    expect(docCalls).toContain('agent-1__github');
  });

  it('put persists token fields plus top-level agentId + serverName for indexing', async () => {
    await repo.put('acme', 'agent-1', 'github', tokenFixture);

    expect(mockSet).toHaveBeenCalledTimes(1);
    const persisted = mockSet.mock.calls[0][0] as Record<string, unknown>;
    expect(persisted.agentId).toBe('agent-1');
    expect(persisted.serverName).toBe('github');
    expect(persisted.accessToken).toBe('access-1');
    expect(persisted.refreshToken).toBe('refresh-1');
    expect(persisted.providerUserId).toBe('12345');
    expect(persisted.accountLogin).toBe('@octocat');
  });

  it('get returns null when no doc exists', async () => {
    mockGet.mockResolvedValueOnce({ exists: false });
    const result = await repo.get('acme', 'agent-1', 'github');
    expect(result).toBeNull();
  });

  it('get parses stored data and strips indexing fields', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      id: 'agent-1__github',
      data: () => ({ ...tokenFixture, agentId: 'agent-1', serverName: 'github' }),
    });

    const result = await repo.get('acme', 'agent-1', 'github');
    expect(result).toEqual(tokenFixture);
    // Narrow to AgentOAuthToken shape — strict schema rejects unknown keys.
    expect((result as unknown as { agentId?: unknown }).agentId).toBeUndefined();
    expect((result as unknown as { serverName?: unknown }).serverName).toBeUndefined();
  });

  it('put → get round-trip overwrites on subsequent put (refresh flow)', async () => {
    await repo.put('acme', 'agent-1', 'github', tokenFixture);
    await repo.put('acme', 'agent-1', 'github', { ...tokenFixture, accessToken: 'access-2' });

    expect(mockSet).toHaveBeenCalledTimes(2);
    const secondPersisted = mockSet.mock.calls[1][0] as Record<string, unknown>;
    expect(secondPersisted.accessToken).toBe('access-2');
  });

  it('delete returns false when the doc does not exist', async () => {
    mockGet.mockResolvedValueOnce({ exists: false });
    const result = await repo.delete('acme', 'agent-1', 'github');
    expect(result).toBe(false);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('delete returns true and removes the doc when it exists', async () => {
    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({}) });
    const result = await repo.delete('acme', 'agent-1', 'github');
    expect(result).toBe(true);
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it('listByAgent runs a where(agentId == ..) query and sorts by serverName', async () => {
    mockGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'agent-1__google',
          data: () => ({ ...tokenFixture, provider: 'google', agentId: 'agent-1', serverName: 'google' }),
        },
        {
          id: 'agent-1__github',
          data: () => ({ ...tokenFixture, agentId: 'agent-1', serverName: 'github' }),
        },
      ],
    });

    const results = await repo.listByAgent('acme', 'agent-1');

    // Must filter by agentId at the query level.
    expect(mockWhere).toHaveBeenCalledWith('agentId', '==', 'agent-1');
    expect(results).toHaveLength(2);
    expect(results.map((t) => t.serverName)).toEqual(['github', 'google']);
    // serverName decoration lives on the returned object.
    expect(results[0].serverName).toBe('github');
    expect(results[0].accessToken).toBe('access-1');
    expect(results[1].serverName).toBe('google');
    expect(results[1].provider).toBe('google');
  });

  it('listByAgent returns empty array when no tokens match', async () => {
    mockGet.mockResolvedValueOnce({ docs: [] });
    const results = await repo.listByAgent('acme', 'agent-2');
    expect(results).toEqual([]);
  });
});
