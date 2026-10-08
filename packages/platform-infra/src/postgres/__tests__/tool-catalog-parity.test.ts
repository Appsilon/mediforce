import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  StdioToolCatalogEntry,
  ToolCatalogEntry,
  ToolCatalogRepository,
} from '@mediforce/platform-core';
import { InMemoryToolCatalogRepository } from '@mediforce/platform-core/testing';
import { PostgresToolCatalogRepository } from '../repositories/tool-catalog-repository';
import * as schema from '../schema/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

/**
 * Shared contract for ToolCatalogRepository (ADR-0001 L2 parity).
 * Both the in-memory double and Postgres backend MUST satisfy it.
 */
function contract(name: string, factory: () => Promise<ToolCatalogRepository>) {
  describe(`${name} — ToolCatalogRepository contract`, () => {
    let repo: ToolCatalogRepository;

    beforeEach(async () => {
      repo = await factory();
    });

    const entry = (overrides: Partial<StdioToolCatalogEntry> = {}): StdioToolCatalogEntry => ({
      id: 'tealflow-mcp',
      type: 'stdio',
      command: 'tealflow-mcp',
      ...overrides,
    });

    it('returns null for getById when entry is absent', async () => {
      expect(await repo.getById('appsilon', 'missing')).toBeNull();
    });

    it('upsert then getById round-trips the entry', async () => {
      await repo.upsert('appsilon', entry({ description: 'Tealflow MCP' }));
      const got = await repo.getById('appsilon', 'tealflow-mcp');
      expect(got).toEqual({
        id: 'tealflow-mcp',
        type: 'stdio',
        command: 'tealflow-mcp',
        description: 'Tealflow MCP',
      });
    });

    it('upsert overwrites an existing entry', async () => {
      await repo.upsert('appsilon', entry({ command: 'old' }));
      await repo.upsert('appsilon', entry({ command: 'new' }));
      const got = await repo.getById('appsilon', 'tealflow-mcp');
      expect(got).toMatchObject({ command: 'new' });
    });

    it('list returns every entry in the workspace and nothing from siblings', async () => {
      await repo.upsert('appsilon', entry({ id: 'a', command: 'cmd-a' }));
      await repo.upsert('appsilon', entry({ id: 'b', command: 'cmd-b' }));
      await repo.upsert('other-ws', entry({ id: 'a', command: 'other-a' }));

      const list = await repo.list('appsilon');
      expect(list).toHaveLength(2);
      expect(list.map((e) => e.id).sort()).toEqual(['a', 'b']);

      const otherList = await repo.list('other-ws');
      expect(otherList).toEqual([{ id: 'a', type: 'stdio', command: 'other-a' }]);
    });

    it('delete removes the entry and is a no-op on missing id', async () => {
      await repo.upsert('appsilon', entry());
      await repo.delete('appsilon', 'tealflow-mcp');
      expect(await repo.getById('appsilon', 'tealflow-mcp')).toBeNull();
      await expect(repo.delete('appsilon', 'tealflow-mcp')).resolves.toBeUndefined();
    });

    it('rejects payload that violates schema on upsert', async () => {
      await expect(
        repo.upsert('appsilon', { id: 'x', type: 'stdio', command: '' } as unknown as ToolCatalogEntry),
      ).rejects.toThrow();
    });

    it('preserves args and env on round trip', async () => {
      const full: ToolCatalogEntry = {
        id: 'full',
        type: 'stdio',
        command: 'foo',
        args: ['--bar', '--baz'],
        env: { TOKEN: '{{SECRET:token}}' },
        description: 'with extras',
      };
      await repo.upsert('appsilon', full);
      expect(await repo.getById('appsilon', 'full')).toEqual(full);
    });

    it('round-trips an http entry with oauth auth', async () => {
      const http: ToolCatalogEntry = {
        id: 'github',
        type: 'http',
        url: 'https://api.githubcopilot.com/mcp/',
        auth: {
          type: 'oauth',
          provider: 'github',
          headerName: 'Authorization',
          headerValueTemplate: 'Bearer {token}',
        },
        description: 'GitHub MCP',
      };
      await repo.upsert('appsilon', http);
      expect(await repo.getById('appsilon', 'github')).toEqual(http);
    });

    it('upsert can switch an entry from stdio to http without leaking stdio fields', async () => {
      await repo.upsert('appsilon', entry({ id: 'swap', args: ['-y'] }));
      await repo.upsert('appsilon', { id: 'swap', type: 'http', url: 'https://example.com/mcp' });
      expect(await repo.getById('appsilon', 'swap')).toEqual({
        id: 'swap',
        type: 'http',
        url: 'https://example.com/mcp',
      });
    });
  });
}

contract('InMemoryToolCatalogRepository', async () => new InMemoryToolCatalogRepository());

describe.skipIf(skipPg)('PostgresToolCatalogRepository (parity)', () => {
  const schemaName = `tc_${randomBytes(8).toString('hex')}`;
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

  contract('PostgresToolCatalogRepository', async () => {
    const db = drizzle(testClient, { schema });
    await testClient.unsafe(`TRUNCATE TABLE "${schemaName}"."tool_catalog_entries"`);
    return new PostgresToolCatalogRepository(db);
  });

  // Postgres-specific: assert the set_updated_at trigger fires on UPDATE.
  // The contract above can't verify this (no `updated_at` is exposed
  // through the repo interface). Without this guard, a follow-up PR that
  // drops the trigger from its migration goes unnoticed.
  it('set_updated_at trigger advances updated_at on UPDATE', async () => {
    await testClient.unsafe(`TRUNCATE TABLE "${schemaName}"."tool_catalog_entries"`);
    const db = drizzle(testClient, { schema });
    const repo = new PostgresToolCatalogRepository(db);
    await repo.upsert('appsilon', { id: 'trig', type: 'stdio', command: 'a' });
    const [before] = await testClient<{ updated_at: string }[]>`
      SELECT updated_at::text FROM tool_catalog_entries
      WHERE workspace = 'appsilon' AND id = 'trig'
    `;
    await new Promise((r) => setTimeout(r, 10));
    await repo.upsert('appsilon', { id: 'trig', type: 'stdio', command: 'b' });
    const [after] = await testClient<{ updated_at: string }[]>`
      SELECT updated_at::text FROM tool_catalog_entries
      WHERE workspace = 'appsilon' AND id = 'trig'
    `;
    expect(new Date(after.updated_at).getTime())
      .toBeGreaterThan(new Date(before.updated_at).getTime());
  });
});
