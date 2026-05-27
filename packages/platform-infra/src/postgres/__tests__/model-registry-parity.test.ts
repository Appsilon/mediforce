import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ModelRegistryEntry,
  ModelRegistryRepository,
  CreateModelRegistryEntryInput,
} from '@mediforce/platform-core';
import { InMemoryModelRegistryRepository } from '@mediforce/platform-core/testing';
import { PostgresModelRegistryRepository } from '../repositories/model-registry-repository.js';
import * as schema from '../schema/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

function entryInput(overrides: Partial<CreateModelRegistryEntryInput> = {}): CreateModelRegistryEntryInput {
  return {
    id: 'anthropic/claude-sonnet-4',
    canonicalSlug: 'anthropic/claude-sonnet-4',
    name: 'Claude Sonnet 4',
    provider: 'anthropic',
    contextLength: 200000,
    maxCompletionTokens: 8192,
    pricing: { input: 3, output: 15 },
    modality: 'text',
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    supportsTools: true,
    supportsVision: true,
    source: 'openrouter',
    requestCount: null,
    lastSyncedAt: '2026-05-27T00:00:00.000Z',
    ...overrides,
  };
}

function strip(entry: ModelRegistryEntry): Omit<ModelRegistryEntry, 'createdAt' | 'updatedAt'> {
  const { createdAt: _c, updatedAt: _u, ...rest } = entry;
  return rest;
}

/**
 * Shared contract for ModelRegistryRepository (ADR-0001 L2 parity).
 * Both the in-memory double and Postgres backend MUST satisfy it.
 *
 * Model registry is deployment-global (no workspace dimension) — a sync
 * job mirrors OpenRouter into it and every workspace reads from it.
 */
function contract(name: string, factory: () => Promise<ModelRegistryRepository>) {
  describe(`${name} — ModelRegistryRepository contract`, () => {
    let repo: ModelRegistryRepository;

    beforeEach(async () => {
      repo = await factory();
    });

    it('returns null for getById when entry is absent', async () => {
      expect(await repo.getById('missing')).toBeNull();
    });

    it('upsert + getById round-trips the entry', async () => {
      const created = await repo.upsert(entryInput());
      const got = await repo.getById('anthropic/claude-sonnet-4');
      expect(got).not.toBeNull();
      expect(strip(got!)).toEqual(strip(created));
      expect(strip(got!)).toMatchObject({
        id: 'anthropic/claude-sonnet-4',
        provider: 'anthropic',
        pricing: { input: 3, output: 15 },
        inputModalities: ['text', 'image'],
        supportsTools: true,
      });
    });

    it('upsert overwrites an existing entry', async () => {
      await repo.upsert(entryInput({ name: 'old' }));
      await repo.upsert(entryInput({ name: 'new' }));
      const got = await repo.getById('anthropic/claude-sonnet-4');
      expect(got?.name).toBe('new');
    });

    it('list returns every entry', async () => {
      await repo.upsert(entryInput({ id: 'a/one' }));
      await repo.upsert(entryInput({ id: 'b/two' }));
      const list = await repo.list();
      expect(list.map((e) => e.id).sort()).toEqual(['a/one', 'b/two']);
    });

    it('update applies partial fields', async () => {
      await repo.upsert(entryInput());
      const updated = await repo.update({
        id: 'anthropic/claude-sonnet-4',
        contextLength: 1000000,
      });
      expect(updated.contextLength).toBe(1000000);
      expect(updated.name).toBe('Claude Sonnet 4');
    });

    it('delete removes the entry and is a no-op on missing id', async () => {
      await repo.upsert(entryInput());
      await repo.delete('anthropic/claude-sonnet-4');
      expect(await repo.getById('anthropic/claude-sonnet-4')).toBeNull();
      await expect(repo.delete('anthropic/claude-sonnet-4')).resolves.toBeUndefined();
    });

    it('bulkUpsert inserts and updates in one call', async () => {
      await repo.upsert(entryInput({ id: 'existing/one', name: 'old' }));
      const synced = await repo.bulkUpsert([
        entryInput({ id: 'existing/one', name: 'new' }),
        entryInput({ id: 'fresh/two' }),
      ]);
      expect(synced).toBe(2);
      expect((await repo.getById('existing/one'))?.name).toBe('new');
      expect(await repo.getById('fresh/two')).not.toBeNull();
    });

    it('updateRankings updates by id and by canonicalSlug', async () => {
      await repo.upsert(entryInput({
        id: 'anthropic/claude-sonnet-4',
        canonicalSlug: 'anthropic/claude-sonnet-4',
      }));
      await repo.upsert(entryInput({
        id: 'openai/gpt-4o',
        canonicalSlug: 'openai/gpt-4o-2024-08',
      }));

      const updated = await repo.updateRankings([
        { id: 'anthropic/claude-sonnet-4', requestCount: 100 },
        { id: 'openai/gpt-4o-2024-08', requestCount: 50 },
        { id: 'does-not-exist', requestCount: 999 },
      ]);
      expect(updated).toBe(2);
      expect((await repo.getById('anthropic/claude-sonnet-4'))?.requestCount).toBe(100);
      expect((await repo.getById('openai/gpt-4o'))?.requestCount).toBe(50);
    });

    it('getMeta starts null then reflects the last updateRankings', async () => {
      expect((await repo.getMeta()).rankingsUpdatedAt).toBeNull();
      await repo.upsert(entryInput());
      await repo.updateRankings([{ id: 'anthropic/claude-sonnet-4', requestCount: 1 }]);
      const meta = await repo.getMeta();
      expect(meta.rankingsUpdatedAt).not.toBeNull();
      expect(() => new Date(meta.rankingsUpdatedAt!).toISOString()).not.toThrow();
    });

    it('rejects upsert with invalid payload (missing pricing)', async () => {
      const bad = { ...entryInput(), pricing: undefined as unknown as { input: number; output: number } };
      await expect(repo.upsert(bad)).rejects.toThrow();
    });

    it('rejects upsert with invalid payload (wrong source enum)', async () => {
      const bad = { ...entryInput(), source: 'invalid' as 'openrouter' };
      await expect(repo.upsert(bad)).rejects.toThrow();
    });
  });
}

contract(
  'InMemoryModelRegistryRepository',
  async () => new InMemoryModelRegistryRepository(),
);

describe.skipIf(skipPg)('PostgresModelRegistryRepository (parity)', () => {
  const schemaName = `mr_${randomBytes(8).toString('hex')}`;
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

  contract('PostgresModelRegistryRepository', async () => {
    const db = drizzle(testClient, { schema });
    await testClient.unsafe(
      `TRUNCATE TABLE "${schemaName}"."model_registry_entries"`,
    );
    await testClient.unsafe(
      `TRUNCATE TABLE "${schemaName}"."model_registry_meta"`,
    );
    return new PostgresModelRegistryRepository(db);
  });

  it('set_updated_at trigger advances updated_at on UPDATE', async () => {
    await testClient.unsafe(`TRUNCATE TABLE "${schemaName}"."model_registry_entries"`);
    const db = drizzle(testClient, { schema });
    const repo = new PostgresModelRegistryRepository(db);
    await repo.upsert(entryInput({ id: 'trig/one', name: 'a' }));
    const [before] = await testClient<{ updated_at: string }[]>`
      SELECT updated_at::text FROM model_registry_entries WHERE id = 'trig/one'
    `;
    await new Promise((r) => setTimeout(r, 10));
    await repo.update({ id: 'trig/one', name: 'b' });
    const [after] = await testClient<{ updated_at: string }[]>`
      SELECT updated_at::text FROM model_registry_entries WHERE id = 'trig/one'
    `;
    expect(new Date(after.updated_at).getTime())
      .toBeGreaterThan(new Date(before.updated_at).getTime());
  });
});
