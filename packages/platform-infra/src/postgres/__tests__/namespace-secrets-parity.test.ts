import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NamespaceSecretsRepository } from '@mediforce/platform-core';
import { InMemoryNamespaceSecretsRepository } from '@mediforce/platform-core/testing';
import { PostgresNamespaceSecretsRepository } from '../repositories/namespace-secrets-repository.js';
import { PostgresNamespaceRepository } from '../repositories/namespace-repository.js';
import * as schema from '../schema/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

// Force a deterministic encryption key for the duration of this test file.
// `secrets-cipher` reads `process.env.SECRETS_ENCRYPTION_KEY` lazily on every
// encrypt/decrypt call, so setting it before the contracts run is enough.
const TEST_KEY = '0'.repeat(64);

/**
 * Shared contract for NamespaceSecretsRepository (ADR-0001 L2 parity).
 * Factory returns `(repo, registerWorkspace)` — the Postgres variant needs
 * the workspace handle in `workspaces` first to satisfy the FK; the
 * in-memory variant treats it as a no-op.
 */
function contract(
  name: string,
  factory: () => Promise<{
    repo: NamespaceSecretsRepository;
    registerWorkspace: (handle: string) => Promise<void>;
  }>,
) {
  describe(`${name} — NamespaceSecretsRepository contract`, () => {
    let repo: NamespaceSecretsRepository;
    let registerWorkspace: (handle: string) => Promise<void>;

    beforeAll(() => {
      process.env.SECRETS_ENCRYPTION_KEY = TEST_KEY;
    });

    beforeEach(async () => {
      ({ repo, registerWorkspace } = await factory());
      await registerWorkspace('ws-1');
    });

    it('returns empty record when absent', async () => {
      expect(await repo.getSecrets('ws-1')).toEqual({});
      expect(await repo.getSecretKeys('ws-1')).toEqual([]);
    });

    it('setSecrets + getSecrets round-trips plaintext values', async () => {
      await repo.setSecrets('ws-1', { API_KEY: 'sk-abc', DB_PASS: 'hunter2' });
      expect(await repo.getSecrets('ws-1')).toEqual({
        API_KEY: 'sk-abc',
        DB_PASS: 'hunter2',
      });
      expect(new Set(await repo.getSecretKeys('ws-1'))).toEqual(
        new Set(['API_KEY', 'DB_PASS']),
      );
    });

    it('setSecrets replaces the full set (drops removed keys)', async () => {
      await repo.setSecrets('ws-1', { A: '1', B: '2' });
      await repo.setSecrets('ws-1', { C: '3' });
      expect(await repo.getSecrets('ws-1')).toEqual({ C: '3' });
    });

    it('upsertSecret adds a new key without dropping siblings', async () => {
      await repo.setSecrets('ws-1', { A: '1' });
      await repo.upsertSecret('ws-1', 'B', '2');
      expect(await repo.getSecrets('ws-1')).toEqual({ A: '1', B: '2' });
    });

    it('upsertSecret overwrites an existing key', async () => {
      await repo.upsertSecret('ws-1', 'A', 'first');
      await repo.upsertSecret('ws-1', 'A', 'second');
      expect((await repo.getSecrets('ws-1'))['A']).toBe('second');
    });

    it('deleteSecret removes only the named key', async () => {
      await repo.setSecrets('ws-1', { A: '1', B: '2' });
      await repo.deleteSecret('ws-1', 'A');
      expect(await repo.getSecrets('ws-1')).toEqual({ B: '2' });
    });

    it('deleteSecret on missing key is a no-op', async () => {
      await repo.deleteSecret('ws-1', 'missing');
      expect(await repo.getSecrets('ws-1')).toEqual({});
    });

    it('isolates by workspace', async () => {
      await registerWorkspace('ws-2');
      await repo.setSecrets('ws-1', { A: '1' });
      await repo.setSecrets('ws-2', { B: '2' });
      expect(await repo.getSecrets('ws-1')).toEqual({ A: '1' });
      expect(await repo.getSecrets('ws-2')).toEqual({ B: '2' });
    });

    it('rejects setSecrets with invalid payload (empty namespace)', async () => {
      await expect(
        repo.setSecrets('', { A: '1' }),
      ).rejects.toThrow();
    });
  });
}

contract('InMemoryNamespaceSecretsRepository', async () => ({
  repo: new InMemoryNamespaceSecretsRepository(),
  registerWorkspace: async () => {},
}));

describe.skipIf(skipPg)('PostgresNamespaceSecretsRepository (parity)', () => {
  const schemaName = `nssec_${randomBytes(8).toString('hex')}`;
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

  contract('PostgresNamespaceSecretsRepository', async () => {
    const db = drizzle(testClient, { schema });
    await testClient.unsafe(
      `TRUNCATE TABLE "${schemaName}"."namespace_secrets", ` +
        `"${schemaName}"."workspace_members", "${schemaName}"."workspaces" CASCADE`,
    );
    const nsRepo = new PostgresNamespaceRepository(db);
    const repo = new PostgresNamespaceSecretsRepository(db);
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
