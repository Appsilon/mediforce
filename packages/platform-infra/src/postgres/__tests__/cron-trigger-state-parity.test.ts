import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CronTriggerState, CronTriggerStateRepository } from '@mediforce/platform-core';
import { InMemoryCronTriggerStateRepository } from '@mediforce/platform-core/testing';
import { PostgresCronTriggerStateRepository } from '../repositories/cron-trigger-state-repository';
import * as schema from '../schema/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

function stateBase(overrides: Partial<CronTriggerState> = {}): CronTriggerState {
  return {
    definitionName: 'nightly-cleanup',
    triggerName: 'nightly',
    lastTriggeredAt: '2026-05-27T01:00:00.000Z',
    ...overrides,
  };
}

/**
 * Shared contract for CronTriggerStateRepository (ADR-0001 L2 parity).
 * Both the in-memory double and Postgres backend MUST satisfy it.
 *
 * Cron-trigger-state is global (no workspace dimension) — the heartbeat
 * runs as system actor and reads across every workspace's definitions.
 */
function contract(name: string, factory: () => Promise<CronTriggerStateRepository>) {
  describe(`${name} — CronTriggerStateRepository contract`, () => {
    let repo: CronTriggerStateRepository;

    beforeEach(async () => {
      repo = await factory();
    });

    it('returns null for get when absent', async () => {
      expect(await repo.get('missing', 'trigger')).toBeNull();
    });

    it('set + get round-trips the state', async () => {
      await repo.set(stateBase());
      const got = await repo.get('nightly-cleanup', 'nightly');
      expect(got).toEqual(stateBase());
    });

    it('set overwrites an existing row', async () => {
      await repo.set(stateBase({ lastTriggeredAt: '2026-05-27T01:00:00.000Z' }));
      await repo.set(stateBase({ lastTriggeredAt: '2026-05-27T02:00:00.000Z' }));
      const got = await repo.get('nightly-cleanup', 'nightly');
      expect(got?.lastTriggeredAt).toBe('2026-05-27T02:00:00.000Z');
    });

    it('isolates by (definitionName, triggerName)', async () => {
      await repo.set(stateBase({ definitionName: 'a', triggerName: 't' }));
      await repo.set(stateBase({ definitionName: 'b', triggerName: 't' }));
      await repo.set(stateBase({ definitionName: 'a', triggerName: 'u' }));

      expect((await repo.get('a', 't'))?.definitionName).toBe('a');
      expect((await repo.get('b', 't'))?.definitionName).toBe('b');
      expect((await repo.get('a', 'u'))?.triggerName).toBe('u');
      expect(await repo.get('a', 'missing')).toBeNull();
    });

    it('rejects set with invalid payload (empty definitionName)', async () => {
      await expect(repo.set(stateBase({ definitionName: '' }))).rejects.toThrow();
    });

    it('rejects set with invalid payload (non-ISO lastTriggeredAt)', async () => {
      await expect(repo.set(stateBase({ lastTriggeredAt: 'not-a-date' }))).rejects.toThrow();
    });
  });
}

contract('InMemoryCronTriggerStateRepository', async () => new InMemoryCronTriggerStateRepository());

describe.skipIf(skipPg)('PostgresCronTriggerStateRepository (parity)', () => {
  const schemaName = `cron_${randomBytes(8).toString('hex')}`;
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
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
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

  contract('PostgresCronTriggerStateRepository', async () => {
    const db = drizzle(testClient, { schema });
    await testClient.unsafe(`TRUNCATE TABLE "${schemaName}"."cron_trigger_state"`);
    return new PostgresCronTriggerStateRepository(db);
  });
});
