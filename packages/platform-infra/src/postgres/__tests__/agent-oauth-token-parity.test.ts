import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AgentOAuthToken,
  AgentOAuthTokenRepository,
} from '@mediforce/platform-core';
import { InMemoryAgentOAuthTokenRepository } from '@mediforce/platform-core/testing';
import { PostgresAgentOAuthTokenRepository } from '../repositories/agent-oauth-token-repository.js';
import { PostgresNamespaceRepository } from '../repositories/namespace-repository.js';
import * as schema from '../schema/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

function tokenBase(overrides: Partial<AgentOAuthToken> = {}): AgentOAuthToken {
  return {
    provider: 'github',
    accessToken: 'access-1',
    scope: 'repo read:user',
    providerUserId: 'gh-12345',
    accountLogin: 'octocat',
    connectedAt: 1_700_000_000_000,
    connectedBy: 'user-uid-1',
    ...overrides,
  };
}

function contract(
  name: string,
  factory: () => Promise<{
    repo: AgentOAuthTokenRepository;
    registerWorkspace: (handle: string) => Promise<void>;
  }>,
) {
  describe(`${name} — AgentOAuthTokenRepository contract`, () => {
    let repo: AgentOAuthTokenRepository;
    let registerWorkspace: (handle: string) => Promise<void>;

    beforeEach(async () => {
      ({ repo, registerWorkspace } = await factory());
      await registerWorkspace('ws-1');
    });

    it('returns null for get when absent', async () => {
      expect(await repo.get('ws-1', 'agent-a', 'github')).toBeNull();
    });

    it('put + get round-trips minimum fields', async () => {
      await repo.put('ws-1', 'agent-a', 'github', tokenBase());
      const got = await repo.get('ws-1', 'agent-a', 'github');
      expect(got).toEqual(tokenBase());
    });

    it('put + get round-trips all optional fields', async () => {
      const full = tokenBase({
        refreshToken: 'refresh-1',
        expiresAt: 1_700_000_999_999,
      });
      await repo.put('ws-1', 'agent-a', 'google', full);
      expect(await repo.get('ws-1', 'agent-a', 'google')).toEqual(full);
    });

    it('put is insert-or-replace for the same (agent, server) key', async () => {
      await repo.put('ws-1', 'agent-a', 'github', tokenBase({ accessToken: 'old' }));
      await repo.put(
        'ws-1',
        'agent-a',
        'github',
        tokenBase({ accessToken: 'new', refreshToken: 'r' }),
      );
      const got = await repo.get('ws-1', 'agent-a', 'github');
      expect(got?.accessToken).toBe('new');
      expect(got?.refreshToken).toBe('r');
    });

    it('delete returns true when present and false when not', async () => {
      await repo.put('ws-1', 'agent-a', 'github', tokenBase());
      expect(await repo.delete('ws-1', 'agent-a', 'github')).toBe(true);
      expect(await repo.get('ws-1', 'agent-a', 'github')).toBeNull();
      expect(await repo.delete('ws-1', 'agent-a', 'github')).toBe(false);
    });

    it('listByAgent returns only that agent\'s tokens, sorted by serverName', async () => {
      await repo.put('ws-1', 'agent-a', 'zeta', tokenBase());
      await repo.put('ws-1', 'agent-a', 'alpha', tokenBase());
      await repo.put('ws-1', 'agent-a', 'mid', tokenBase());
      // Different agent — must not leak.
      await repo.put('ws-1', 'agent-b', 'alpha', tokenBase());

      const tokens = await repo.listByAgent('ws-1', 'agent-a');
      expect(tokens.map((t) => t.serverName)).toEqual(['alpha', 'mid', 'zeta']);
    });

    it('listByAgent returns empty array when agent has no tokens', async () => {
      expect(await repo.listByAgent('ws-1', 'agent-empty')).toEqual([]);
    });

    it('isolates by namespace', async () => {
      await registerWorkspace('ws-2');
      await repo.put('ws-1', 'agent-a', 'github', tokenBase({ accessToken: 'ws1' }));
      await repo.put('ws-2', 'agent-a', 'github', tokenBase({ accessToken: 'ws2' }));

      expect((await repo.get('ws-1', 'agent-a', 'github'))?.accessToken).toBe('ws1');
      expect((await repo.get('ws-2', 'agent-a', 'github'))?.accessToken).toBe('ws2');
      expect((await repo.listByAgent('ws-1', 'agent-a'))[0].accessToken).toBe('ws1');
      expect((await repo.listByAgent('ws-2', 'agent-a'))[0].accessToken).toBe('ws2');
    });

    it('rejects put with invalid payload (empty accessToken)', async () => {
      await expect(
        repo.put('ws-1', 'agent-a', 'github', tokenBase({ accessToken: '' })),
      ).rejects.toThrow();
    });
  });
}

contract('InMemoryAgentOAuthTokenRepository', async () => ({
  repo: new InMemoryAgentOAuthTokenRepository(),
  registerWorkspace: async () => {},
}));

describe.skipIf(skipPg)('PostgresAgentOAuthTokenRepository (parity)', () => {
  const schemaName = `aotoken_${randomBytes(8).toString('hex')}`;
  let adminClient: ReturnType<typeof postgres>;
  let testClient: ReturnType<typeof postgres>;

  beforeAll(async () => {
    adminClient = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} });
    await adminClient.unsafe(`CREATE SCHEMA "${schemaName}"`);
    testClient = postgres(DATABASE_URL!, {
      max: 4,
      onnotice: () => {},
      connection: { search_path: schemaName },
    });
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
      await testClient.unsafe(sql);
    }
  });

  afterAll(async () => {
    if (testClient) await testClient.end();
    if (adminClient) {
      await adminClient.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
      await adminClient.end();
    }
  });

  contract('PostgresAgentOAuthTokenRepository', async () => {
    const db = drizzle(testClient, { schema });
    await testClient.unsafe(
      `TRUNCATE TABLE "${schemaName}"."agent_oauth_tokens", ` +
        `"${schemaName}"."workspace_members", "${schemaName}"."workspaces" CASCADE`,
    );
    const nsRepo = new PostgresNamespaceRepository(db);
    const repo = new PostgresAgentOAuthTokenRepository(db);
    return {
      repo,
      registerWorkspace: async (handle: string) => {
        if (!(await nsRepo.getNamespace(handle))) {
          await nsRepo.createNamespace({
            handle,
            type: 'organization',
            displayName: handle,
            createdAt: '2026-05-27T00:00:00.000Z',
          });
        }
      },
    };
  });
});
