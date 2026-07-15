import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ProviderAlreadyExistsError,
  type CreateOAuthProviderInput,
  type OAuthProviderRepository,
} from '@mediforce/platform-core';
import { InMemoryOAuthProviderRepository } from '@mediforce/platform-core/testing';
import { PostgresOAuthProviderRepository } from '../repositories/oauth-provider-repository';
import { PostgresNamespaceRepository } from '../repositories/namespace-repository';
import * as schema from '../schema/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

function inputBase(
  overrides: Partial<CreateOAuthProviderInput> = {},
): CreateOAuthProviderInput {
  return {
    id: 'github',
    name: 'GitHub',
    clientId: 'client-123',
    clientSecret: 'secret-xyz',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['repo', 'read:user'],
    ...overrides,
  };
}

/**
 * Shared contract for OAuthProviderRepository (ADR-0001 L2 parity).
 * Both the in-memory double and Postgres backend MUST satisfy it.
 *
 * Factory returns `(repo, registerWorkspace)`. Callers register the
 * workspace handle before calls that touch it so the Postgres FK holds;
 * the in-memory variant treats `registerWorkspace` as a no-op.
 */
function contract(
  name: string,
  factory: () => Promise<{
    repo: OAuthProviderRepository;
    registerWorkspace: (handle: string) => Promise<void>;
  }>,
) {
  describe(`${name} — OAuthProviderRepository contract`, () => {
    let repo: OAuthProviderRepository;
    let registerWorkspace: (handle: string) => Promise<void>;

    beforeEach(async () => {
      ({ repo, registerWorkspace } = await factory());
      await registerWorkspace('ws-1');
    });

    it('returns null for get when absent', async () => {
      expect(await repo.get('ws-1', 'missing')).toBeNull();
    });

    it('create + get round-trips minimum fields', async () => {
      const created = await repo.create('ws-1', inputBase());
      expect(created.id).toBe('github');
      expect(created.clientSecret).toBe('secret-xyz');
      expect(created.scopes).toEqual(['repo', 'read:user']);
      expect(created.createdAt).toBeDefined();
      expect(created.updatedAt).toBeDefined();

      const got = await repo.get('ws-1', 'github');
      expect(got).toEqual(created);
    });

    it('create + get round-trips all optional fields', async () => {
      const full = inputBase({
        id: 'custom',
        name: 'Custom MCP',
        revokeUrl: 'https://example.com/revoke',
        userInfoUrl: 'https://example.com/userinfo',
        tokenEndpointAuthMethod: 'none',
        issuer: 'https://example.com',
        registrationEndpoint: 'https://example.com/register',
        resourceUrl: 'https://mcp.example.com/mcp',
        iconUrl: 'https://example.com/icon.png',
      });
      const created = await repo.create('ws-1', full);
      const got = await repo.get('ws-1', 'custom');
      expect(got).toEqual(created);
      expect(got?.revokeUrl).toBe('https://example.com/revoke');
      expect(got?.tokenEndpointAuthMethod).toBe('none');
    });

    it('create without clientSecret persists as undefined (DCR public client)', async () => {
      const { clientSecret: _omit, ...rest } = inputBase();
      const created = await repo.create('ws-1', rest as CreateOAuthProviderInput);
      const got = await repo.get('ws-1', 'github');
      expect(created.clientSecret).toBeUndefined();
      expect(got?.clientSecret).toBeUndefined();
    });

    it('create throws ProviderAlreadyExistsError when id is taken', async () => {
      await repo.create('ws-1', inputBase());
      await expect(repo.create('ws-1', inputBase())).rejects.toBeInstanceOf(
        ProviderAlreadyExistsError,
      );
    });

    it('list returns providers sorted by id', async () => {
      await repo.create('ws-1', inputBase({ id: 'zeta' }));
      await repo.create('ws-1', inputBase({ id: 'alpha' }));
      await repo.create('ws-1', inputBase({ id: 'mid' }));

      const all = await repo.list('ws-1');
      expect(all.map((p) => p.id)).toEqual(['alpha', 'mid', 'zeta']);
    });

    it('list returns empty array for namespace with no providers', async () => {
      expect(await repo.list('ws-1')).toEqual([]);
    });

    it('list isolates by namespace', async () => {
      await registerWorkspace('ws-2');
      await repo.create('ws-1', inputBase({ id: 'a' }));
      await repo.create('ws-2', inputBase({ id: 'b' }));

      expect((await repo.list('ws-1')).map((p) => p.id)).toEqual(['a']);
      expect((await repo.list('ws-2')).map((p) => p.id)).toEqual(['b']);
    });

    it('update returns null when id missing', async () => {
      expect(await repo.update('ws-1', 'missing', { name: 'X' })).toBeNull();
    });

    it('update patches a subset and preserves the rest', async () => {
      const original = await repo.create('ws-1', inputBase({ name: 'Original' }));
      // Sleep so the in-memory clock guarantees a later updatedAt.
      await new Promise((r) => setTimeout(r, 5));
      const updated = await repo.update('ws-1', 'github', { name: 'Updated' });
      expect(updated?.name).toBe('Updated');
      expect(updated?.clientId).toBe(original.clientId);
      expect(updated?.scopes).toEqual(original.scopes);
      // A PATCH that omits clientSecret must preserve the stored secret —
      // the "leave empty to keep current secret" edit flow depends on this.
      expect(updated?.clientSecret).toBe(original.clientSecret);
      expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThan(
        new Date(original.updatedAt).getTime(),
      );
    });

    it('delete returns true when present and false when not', async () => {
      await repo.create('ws-1', inputBase());
      expect(await repo.delete('ws-1', 'github')).toBe(true);
      expect(await repo.get('ws-1', 'github')).toBeNull();
      expect(await repo.delete('ws-1', 'github')).toBe(false);
    });

    it('rejects create with invalid payload (bad id slug)', async () => {
      await expect(
        repo.create('ws-1', inputBase({ id: 'BAD ID with spaces' })),
      ).rejects.toThrow();
    });

    it('rejects create with invalid payload (missing scopes)', async () => {
      await expect(
        repo.create('ws-1', { ...inputBase(), scopes: [] } as unknown as CreateOAuthProviderInput),
      ).rejects.toThrow();
    });
  });
}

contract('InMemoryOAuthProviderRepository', async () => ({
  repo: new InMemoryOAuthProviderRepository(),
  registerWorkspace: async () => {},
}));

describe.skipIf(skipPg)('PostgresOAuthProviderRepository (parity)', () => {
  const schemaName = `oauth_${randomBytes(8).toString('hex')}`;
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

  contract('PostgresOAuthProviderRepository', async () => {
    const db = drizzle(testClient, { schema });
    await testClient.unsafe(
      `TRUNCATE TABLE "${schemaName}"."oauth_providers", ` +
        `"${schemaName}"."workspace_members", "${schemaName}"."workspaces" CASCADE`,
    );
    const nsRepo = new PostgresNamespaceRepository(db);
    const repo = new PostgresOAuthProviderRepository(db);
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

  it('set_updated_at trigger advances updated_at on UPDATE of oauth_providers', async () => {
    await testClient.unsafe(
      `TRUNCATE TABLE "${schemaName}"."oauth_providers", ` +
        `"${schemaName}"."workspace_members", "${schemaName}"."workspaces" CASCADE`,
    );
    const db = drizzle(testClient, { schema });
    const nsRepo = new PostgresNamespaceRepository(db);
    await nsRepo.createNamespace({
      handle: 'trig',
      type: 'organization',
      displayName: 'Trig',
      createdAt: '2026-05-27T00:00:00.000Z',
    });
    const repo = new PostgresOAuthProviderRepository(db);
    const before = await repo.create('trig', inputBase());
    await new Promise((r) => setTimeout(r, 10));
    const after = await repo.update('trig', 'github', { name: 'Renamed' });
    expect(new Date(after!.updatedAt).getTime()).toBeGreaterThan(
      new Date(before.updatedAt).getTime(),
    );
  });
});
