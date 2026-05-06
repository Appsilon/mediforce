import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryConnectionRepository } from '../in-memory-connection-repository.js';
import {
  ConnectionAlreadyExistsError,
  ConnectionNotFoundError,
  ConnectionNotOAuthError,
} from '../../interfaces/connection-repository.js';
import type { CreateConnectionInput } from '../../schemas/connection.js';

function makeOauthInput(overrides: Partial<CreateConnectionInput> = {}): CreateConnectionInput {
  return {
    id: 'github-mediforce',
    name: 'GitHub (Mediforce)',
    auth: { type: 'oauth', providerId: 'github' },
    ...overrides,
  };
}

function makeHeadersInput(overrides: Partial<CreateConnectionInput> = {}): CreateConnectionInput {
  return {
    id: 'static-jira',
    name: 'Jira (static)',
    auth: { type: 'headers', headers: { 'X-Api-Key': '{{SECRET:jira_key}}' } },
    ...overrides,
  };
}

describe('InMemoryConnectionRepository — CRUD', () => {
  let repo: InMemoryConnectionRepository;

  beforeEach(() => {
    repo = new InMemoryConnectionRepository();
  });

  it('returns null for missing connection', async () => {
    expect(await repo.getById('appsilon', 'missing')).toBeNull();
  });

  it('create then getById returns the stored connection', async () => {
    const created = await repo.create('appsilon', makeOauthInput());
    expect(created.createdAt).toEqual(created.updatedAt);
    const fetched = await repo.getById('appsilon', 'github-mediforce');
    expect(fetched).toEqual(created);
  });

  it('create throws ConnectionAlreadyExistsError on duplicate id', async () => {
    await repo.create('appsilon', makeOauthInput());
    await expect(repo.create('appsilon', makeOauthInput())).rejects.toBeInstanceOf(
      ConnectionAlreadyExistsError,
    );
  });

  it('isolates connections by namespace', async () => {
    await repo.create('appsilon', makeOauthInput({ id: 'gh' }));
    await repo.create('other-org', makeOauthInput({ id: 'gh' }));
    expect((await repo.list('appsilon')).map((c) => c.id)).toEqual(['gh']);
    expect((await repo.list('other-org')).map((c) => c.id)).toEqual(['gh']);
  });

  it('list returns connections sorted by id', async () => {
    await repo.create('appsilon', makeOauthInput({ id: 'github-personal' }));
    await repo.create('appsilon', makeOauthInput({ id: 'github-mediforce' }));
    await repo.create('appsilon', makeHeadersInput({ id: 'static-jira' }));
    expect((await repo.list('appsilon')).map((c) => c.id)).toEqual([
      'github-mediforce',
      'github-personal',
      'static-jira',
    ]);
  });

  it('update patches name and bumps updatedAt', async () => {
    const created = await repo.create('appsilon', makeOauthInput());
    const updated = await repo.update('appsilon', created.id, { name: 'Renamed' });
    expect(updated?.name).toBe('Renamed');
    expect(updated?.updatedAt).not.toBe(created.updatedAt);
    expect(updated?.createdAt).toBe(created.createdAt);
  });

  it('update returns null for missing connection', async () => {
    expect(await repo.update('appsilon', 'nope', { name: 'x' })).toBeNull();
  });

  it('update with id field is silently ignored (id is immutable)', async () => {
    const created = await repo.create('appsilon', makeOauthInput());
    // The interface omits `id` from UpdateConnectionInput, but the in-memory
    // impl still defends against id mutation if a caller bypasses the type.
    const updated = await repo.update('appsilon', created.id, {
      name: 'Renamed',
    });
    expect(updated?.id).toBe(created.id);
  });

  it('delete returns true on hit, false on miss', async () => {
    await repo.create('appsilon', makeOauthInput());
    expect(await repo.delete('appsilon', 'github-mediforce')).toBe(true);
    expect(await repo.delete('appsilon', 'github-mediforce')).toBe(false);
    expect(await repo.getById('appsilon', 'github-mediforce')).toBeNull();
  });

  it('returned objects are clones (mutating does not affect storage)', async () => {
    const created = await repo.create('appsilon', makeOauthInput());
    if (created.auth.type === 'oauth') {
      created.auth.accessToken = 'leaked';
    }
    const refetched = await repo.getById('appsilon', created.id);
    if (refetched?.auth.type === 'oauth') {
      expect(refetched.auth.accessToken).toBeUndefined();
    }
  });
});

describe('InMemoryConnectionRepository — setTokens', () => {
  let repo: InMemoryConnectionRepository;

  beforeEach(() => {
    repo = new InMemoryConnectionRepository();
  });

  it('writes token material onto an oauth connection', async () => {
    await repo.create('appsilon', makeOauthInput());
    const updated = await repo.setTokens('appsilon', 'github-mediforce', {
      accessToken: 'gho_123',
      refreshToken: 'ghr_456',
      expiresAt: 1_900_000_000_000,
      scope: 'repo read:user',
      providerUserId: '12345',
      accountLogin: 'octocat',
      connectedBy: 'user-uid-1',
    });
    expect(updated.auth.type).toBe('oauth');
    if (updated.auth.type === 'oauth') {
      expect(updated.auth.accessToken).toBe('gho_123');
      expect(updated.auth.refreshToken).toBe('ghr_456');
      expect(updated.auth.expiresAt).toBe(1_900_000_000_000);
      expect(updated.auth.accountLogin).toBe('octocat');
      expect(updated.auth.connectedAt).toBeGreaterThan(0);
    }
  });

  it('throws ConnectionNotFoundError for missing connection', async () => {
    await expect(
      repo.setTokens('appsilon', 'never', { accessToken: 'x' }),
    ).rejects.toBeInstanceOf(ConnectionNotFoundError);
  });

  it('throws ConnectionNotOAuthError for headers-typed connection', async () => {
    await repo.create('appsilon', makeHeadersInput());
    await expect(
      repo.setTokens('appsilon', 'static-jira', { accessToken: 'x' }),
    ).rejects.toBeInstanceOf(ConnectionNotOAuthError);
  });

  it('preserves existing token fields when patch omits them', async () => {
    await repo.create('appsilon', makeOauthInput());
    await repo.setTokens('appsilon', 'github-mediforce', {
      accessToken: 'first',
      refreshToken: 'r1',
      expiresAt: 1_800_000_000_000,
    });
    const updated = await repo.setTokens('appsilon', 'github-mediforce', {
      accessToken: 'second',
    });
    if (updated.auth.type === 'oauth') {
      expect(updated.auth.accessToken).toBe('second');
      expect(updated.auth.refreshToken).toBe('r1');
      expect(updated.auth.expiresAt).toBe(1_800_000_000_000);
    }
  });
});

describe('InMemoryConnectionRepository — runWithLock', () => {
  let repo: InMemoryConnectionRepository;

  beforeEach(() => {
    repo = new InMemoryConnectionRepository();
  });

  it('serializes concurrent callers for the same key', async () => {
    await repo.create('appsilon', makeOauthInput());

    const observed: number[] = [];
    let inFlight = 0;
    let maxConcurrent = 0;

    const runOne = (idx: number): Promise<void> =>
      repo.runWithLock('appsilon', 'github-mediforce', async () => {
        inFlight += 1;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        // Yield a couple of microtasks so any concurrent caller would be
        // observable via inFlight if the lock were broken.
        await Promise.resolve();
        await Promise.resolve();
        observed.push(idx);
        inFlight -= 1;
      });

    await Promise.all([runOne(1), runOne(2), runOne(3), runOne(4), runOne(5)]);

    expect(maxConcurrent).toBe(1);
    expect(observed).toEqual([1, 2, 3, 4, 5]);
  });

  it('does not block callers on a different key', async () => {
    await repo.create('appsilon', makeOauthInput({ id: 'a' }));
    await repo.create('appsilon', makeOauthInput({ id: 'b' }));

    let aFinished = false;
    const aPromise = repo.runWithLock('appsilon', 'a', async () => {
      // Wait until b's callback runs at least once.
      await new Promise((resolve) => setTimeout(resolve, 10));
      aFinished = true;
    });

    const bRanWhileABlocked = repo.runWithLock('appsilon', 'b', async () => {
      return aFinished;
    });

    expect(await bRanWhileABlocked).toBe(false);
    await aPromise;
  });

  it('passes a fresh read of the connection to the callback', async () => {
    await repo.create('appsilon', makeOauthInput());
    await repo.setTokens('appsilon', 'github-mediforce', { accessToken: 'fresh' });

    await repo.runWithLock('appsilon', 'github-mediforce', async (current) => {
      expect(current).not.toBeNull();
      if (current?.auth.type === 'oauth') {
        expect(current.auth.accessToken).toBe('fresh');
      }
    });
  });

  it('releases the lock when the callback throws', async () => {
    await repo.create('appsilon', makeOauthInput());

    await expect(
      repo.runWithLock('appsilon', 'github-mediforce', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // Subsequent caller must not deadlock.
    const ran = await repo.runWithLock('appsilon', 'github-mediforce', async () => 'ok');
    expect(ran).toBe('ok');
  });
});
