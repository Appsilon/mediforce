import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PlatformSettingsRepository } from '@mediforce/platform-core';
import { InMemoryPlatformSettingsRepository } from '@mediforce/platform-core/testing';
import { PostgresPlatformSettingsRepository } from '../platform-settings-repository';
import * as schema from '../../schema/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

/**
 * Shared contract for PlatformSettingsRepository (ALERT-03 L2 parity).
 * Both the in-memory double and Postgres backend MUST satisfy it.
 */
function contract(name: string, factory: () => Promise<PlatformSettingsRepository>) {
  describe(`${name} — PlatformSettingsRepository contract`, () => {
    let repo: PlatformSettingsRepository;

    beforeEach(async () => {
      repo = await factory();
    });

    it('get returns null for unknown key', async () => {
      expect(await repo.get('nonexistent.key')).toBeNull();
    });

    it('set then get returns the stored value', async () => {
      await repo.set('alert.webhook.url', 'https://hooks.slack.com/xxx');
      expect(await repo.get('alert.webhook.url')).toBe('https://hooks.slack.com/xxx');
    });

    it('set same key twice overwrites the value', async () => {
      await repo.set('alert.webhook.url', 'first');
      await repo.set('alert.webhook.url', 'second');
      expect(await repo.get('alert.webhook.url')).toBe('second');
    });

    it('getByPrefix returns all keys starting with the prefix', async () => {
      await repo.set('alert.webhook.url', 'https://hooks.slack.com/xxx');
      await repo.set('alert.webhook.type', 'slack');
      await repo.set('other.setting', 'irrelevant');

      const results = await repo.getByPrefix('alert.webhook.');
      expect(results).toHaveLength(2);
      const keys = results.map((r) => r.key).sort();
      expect(keys).toEqual(['alert.webhook.type', 'alert.webhook.url']);
      const urlEntry = results.find((r) => r.key === 'alert.webhook.url');
      expect(urlEntry?.value).toBe('https://hooks.slack.com/xxx');
    });

    it('getByPrefix returns empty array for unknown prefix', async () => {
      await repo.set('other.key', 'value');
      const results = await repo.getByPrefix('unknown.prefix.');
      expect(results).toEqual([]);
    });
  });
}

contract(
  'InMemoryPlatformSettingsRepository',
  async () => new InMemoryPlatformSettingsRepository(),
);

describe.skipIf(skipPg)('PostgresPlatformSettingsRepository (parity)', () => {
  const schemaName = `ps_${randomBytes(8).toString('hex')}`;
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

  contract('PostgresPlatformSettingsRepository', async () => {
    const db = drizzle(testClient, { schema });
    await testClient.unsafe(
      `TRUNCATE TABLE "${schemaName}"."platform_settings"`,
    );
    return new PostgresPlatformSettingsRepository(db);
  });
});
