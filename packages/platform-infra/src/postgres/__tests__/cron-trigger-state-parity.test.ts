import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CronTriggerState,
  CronTriggerStateRepository,
} from '@mediforce/platform-core';
import { InMemoryCronTriggerStateRepository } from '@mediforce/platform-core/testing';
import { PostgresCronTriggerStateRepository } from '../repositories/cron-trigger-state-repository';
import * as schema from '../schema/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

function stateBase(overrides: Partial<CronTriggerState> = {}): CronTriggerState {
  return {
    namespace: 'acme',
    definitionName: 'nightly-cleanup',
    triggerName: 'nightly',
    schedule: '0 1 * * *',
    enabled: true,
    lastTriggeredAt: null,
    ...overrides,
  };
}

/**
 * Shared contract for CronTriggerStateRepository (ADR-0010 L2 parity).
 * Both the in-memory double and Postgres backend MUST satisfy it.
 *
 * Cron Triggers are keyed by (namespace, definitionName, triggerName). The
 * heartbeat's `listAllEnabled` reads across every namespace in one system pass.
 */
function contract(name: string, factory: () => Promise<CronTriggerStateRepository>) {
  describe(`${name} — CronTriggerStateRepository contract`, () => {
    let repo: CronTriggerStateRepository;

    beforeEach(async () => {
      repo = await factory();
    });

    it('returns null for get when absent', async () => {
      expect(await repo.get('acme', 'missing', 'trigger')).toBeNull();
    });

    it('create + get round-trips the row', async () => {
      await repo.create(stateBase());
      const got = await repo.get('acme', 'nightly-cleanup', 'nightly');
      expect(got).toEqual(stateBase());
    });

    it('update patches schedule and enabled without touching the cursor', async () => {
      await repo.create(stateBase({ lastTriggeredAt: '2026-05-27T01:00:00.000Z' }));
      await repo.update('acme', 'nightly-cleanup', 'nightly', {
        schedule: '0 5 * * *',
        enabled: false,
      });
      const got = await repo.get('acme', 'nightly-cleanup', 'nightly');
      expect(got?.schedule).toBe('0 5 * * *');
      expect(got?.enabled).toBe(false);
      expect(got?.lastTriggeredAt).toBe('2026-05-27T01:00:00.000Z');
    });

    it('recordTriggered advances only the fire cursor', async () => {
      await repo.create(stateBase());
      await repo.recordTriggered('acme', 'nightly-cleanup', 'nightly', '2026-05-27T02:00:00.000Z');
      const got = await repo.get('acme', 'nightly-cleanup', 'nightly');
      expect(got?.lastTriggeredAt).toBe('2026-05-27T02:00:00.000Z');
      expect(got?.schedule).toBe('0 1 * * *');
    });

    it('listByDefinition returns rows for one workflow only', async () => {
      await repo.create(stateBase({ triggerName: 'nightly' }));
      await repo.create(stateBase({ triggerName: 'hourly', schedule: '0 * * * *' }));
      await repo.create(stateBase({ definitionName: 'other', triggerName: 'nightly' }));
      const rows = await repo.listByDefinition('acme', 'nightly-cleanup');
      expect(rows.map((r) => r.triggerName).sort()).toEqual(['hourly', 'nightly']);
    });

    it('listAllEnabled returns enabled rows across every namespace', async () => {
      await repo.create(stateBase({ namespace: 'acme', enabled: true }));
      await repo.create(stateBase({ namespace: 'beta', enabled: true }));
      await repo.create(stateBase({ namespace: 'gamma', enabled: false }));
      const rows = await repo.listAllEnabled();
      expect(rows.map((r) => r.namespace).sort()).toEqual(['acme', 'beta']);
    });

    it('delete removes one row', async () => {
      await repo.create(stateBase());
      await repo.delete('acme', 'nightly-cleanup', 'nightly');
      expect(await repo.get('acme', 'nightly-cleanup', 'nightly')).toBeNull();
    });

    it('deleteByDefinition cascades every trigger of a workflow', async () => {
      await repo.create(stateBase({ triggerName: 'nightly' }));
      await repo.create(stateBase({ triggerName: 'hourly', schedule: '0 * * * *' }));
      await repo.deleteByDefinition('acme', 'nightly-cleanup');
      expect(await repo.listByDefinition('acme', 'nightly-cleanup')).toEqual([]);
    });

    it('isolates by (namespace, definitionName, triggerName)', async () => {
      await repo.create(stateBase({ namespace: 'acme', definitionName: 'a', triggerName: 't' }));
      await repo.create(stateBase({ namespace: 'beta', definitionName: 'a', triggerName: 't' }));
      await repo.create(stateBase({ namespace: 'acme', definitionName: 'a', triggerName: 'u' }));

      expect((await repo.get('acme', 'a', 't'))?.namespace).toBe('acme');
      expect((await repo.get('beta', 'a', 't'))?.namespace).toBe('beta');
      expect((await repo.get('acme', 'a', 'u'))?.triggerName).toBe('u');
      expect(await repo.get('acme', 'a', 'missing')).toBeNull();
    });

    it('rejects create with invalid payload (empty namespace)', async () => {
      await expect(repo.create(stateBase({ namespace: '' }))).rejects.toThrow();
    });

    it('rejects create with invalid payload (empty schedule)', async () => {
      await expect(repo.create(stateBase({ schedule: '' }))).rejects.toThrow();
    });
  });
}

contract(
  'InMemoryCronTriggerStateRepository',
  async () => new InMemoryCronTriggerStateRepository(),
);

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

  contract('PostgresCronTriggerStateRepository', async () => {
    const db = drizzle(testClient, { schema });
    await testClient.unsafe(`TRUNCATE TABLE "${schemaName}"."cron_trigger_state"`);
    return new PostgresCronTriggerStateRepository(db);
  });
});
