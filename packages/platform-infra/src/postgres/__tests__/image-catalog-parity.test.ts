import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ImageCatalogEntry,
  ImageCatalogRepository,
} from '@mediforce/platform-core';
import { InMemoryImageCatalogRepository } from '@mediforce/platform-core/testing';
import { PostgresImageCatalogRepository } from '../repositories/image-catalog-repository';
import * as schema from '../schema/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

/**
 * Shared contract for ImageCatalogRepository (ADR-0001 L2 parity).
 * Both the in-memory double and the Postgres backend MUST satisfy it.
 */
function contract(name: string, factory: () => Promise<ImageCatalogRepository>) {
  describe(`${name} — ImageCatalogRepository contract`, () => {
    let repo: ImageCatalogRepository;

    beforeEach(async () => {
      repo = await factory();
    });

    const entry = (overrides: Partial<ImageCatalogEntry> = {}): ImageCatalogEntry => ({
      id: 'tealflow-1a2b3c4d',
      name: 'TealFlow agent',
      intent: 'R-based interactive exploration of ADaM datasets',
      source: {
        kind: 'built',
        repo: 'git@github.com:Appsilon/tealflow.git',
        dockerfile: 'container/Dockerfile',
      },
      ...overrides,
    });

    it('returns null for getById when entry is absent', async () => {
      expect(await repo.getById('appsilon', 'missing')).toBeNull();
    });

    it('upsert then getById round-trips the entry', async () => {
      await repo.upsert('appsilon', entry());
      expect(await repo.getById('appsilon', 'tealflow-1a2b3c4d')).toEqual(entry());
    });

    it('round-trips a referenced source and a declared source reference', async () => {
      const referenced: ImageCatalogEntry = {
        id: 'mediforce-golden-image-9f8e7d6c',
        name: 'Golden image',
        intent: 'The deployment agent-capable base image',
        source: { kind: 'referenced', reference: 'mediforce-golden-image' },
        declaredSource: {
          repo: 'Appsilon/mediforce',
          commit: 'abc1234',
          dockerfile: 'packages/agent-runtime/container/Dockerfile.base',
        },
      };
      await repo.upsert('appsilon', referenced);
      expect(await repo.getById('appsilon', referenced.id)).toEqual(referenced);
    });

    it('upsert overwrites an existing entry', async () => {
      await repo.upsert('appsilon', entry({ intent: 'old' }));
      await repo.upsert('appsilon', entry({ intent: 'new' }));
      expect((await repo.getById('appsilon', 'tealflow-1a2b3c4d'))?.intent).toBe('new');
    });

    it('list returns every entry in the workspace and nothing from siblings', async () => {
      await repo.upsert('appsilon', entry({ id: 'a' }));
      await repo.upsert('appsilon', entry({ id: 'b' }));
      await repo.upsert('other-ws', entry({ id: 'a', intent: 'other' }));

      const list = await repo.list('appsilon');
      expect(list.map((e) => e.id).sort()).toEqual(['a', 'b']);
      expect((await repo.list('other-ws')).map((e) => e.intent)).toEqual(['other']);
    });

    it('delete removes the entry and is a no-op on missing id', async () => {
      await repo.upsert('appsilon', entry());
      await repo.delete('appsilon', 'tealflow-1a2b3c4d');
      expect(await repo.getById('appsilon', 'tealflow-1a2b3c4d')).toBeNull();
      await expect(repo.delete('appsilon', 'tealflow-1a2b3c4d')).resolves.toBeUndefined();
    });

    it('rejects an entry whose intent is empty', async () => {
      await expect(
        repo.upsert('appsilon', entry({ intent: '' })),
      ).rejects.toThrow();
    });

    it('rejects a source that is neither built nor referenced', async () => {
      await expect(
        repo.upsert('appsilon', {
          ...entry(),
          source: { kind: 'guessed', repo: 'x' },
        } as unknown as ImageCatalogEntry),
      ).rejects.toThrow();
    });
  });
}

contract('InMemoryImageCatalogRepository', async () => new InMemoryImageCatalogRepository());

describe.skipIf(skipPg)('PostgresImageCatalogRepository (parity)', () => {
  const schemaName = `ic_${randomBytes(8).toString('hex')}`;
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
      await testClient.unsafe(readFileSync(join(MIGRATIONS_DIR, file), 'utf-8'));
    }
    // `image_catalog_entries.workspace` references `workspaces.handle`, so the
    // two handles the contract writes to have to exist before it runs.
    await testClient.unsafe(`
      INSERT INTO workspaces (handle, type, display_name)
      VALUES ('appsilon', 'organization', 'Appsilon'),
             ('other-ws', 'organization', 'Other')
      ON CONFLICT DO NOTHING
    `);
  });

  afterAll(async () => {
    if (testClient) await testClient.end();
    if (adminClient) {
      await adminClient.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
      await adminClient.end();
    }
  });

  contract('PostgresImageCatalogRepository', async () => {
    const db = drizzle(testClient, { schema });
    await testClient.unsafe(`TRUNCATE TABLE "${schemaName}"."image_catalog_entries"`);
    return new PostgresImageCatalogRepository(db);
  });

  // The contract cannot see `updated_at` — it is not on the entry — so without
  // this a follow-up migration that drops the trigger goes unnoticed.
  it('set_updated_at trigger advances updated_at on UPDATE', async () => {
    await testClient.unsafe(`TRUNCATE TABLE "${schemaName}"."image_catalog_entries"`);
    const repo = new PostgresImageCatalogRepository(drizzle(testClient, { schema }));
    const base: ImageCatalogEntry = {
      id: 'trig',
      name: 'Trigger probe',
      intent: 'first',
      source: { kind: 'referenced', reference: 'probe' },
    };
    await repo.upsert('appsilon', base);
    const [before] = await testClient<{ updated_at: string }[]>`
      SELECT updated_at::text FROM image_catalog_entries
      WHERE workspace = 'appsilon' AND id = 'trig'
    `;
    await new Promise((r) => setTimeout(r, 10));
    await repo.upsert('appsilon', { ...base, intent: 'second' });
    const [after] = await testClient<{ updated_at: string }[]>`
      SELECT updated_at::text FROM image_catalog_entries
      WHERE workspace = 'appsilon' AND id = 'trig'
    `;
    expect(new Date(after.updated_at).getTime()).toBeGreaterThan(
      new Date(before.updated_at).getTime(),
    );
  });
});
