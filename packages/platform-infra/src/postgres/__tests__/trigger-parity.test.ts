import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CronTriggerResource,
  ManualTriggerResource,
  TriggerRepository,
  WebhookTriggerResource,
} from '@mediforce/platform-core';
import { InMemoryTriggerRepository } from '@mediforce/platform-core/testing';
import { PostgresTriggerRepository } from '../repositories/trigger-repository';
import { PostgresNamespaceRepository } from '../repositories/namespace-repository';
import * as schema from '../schema/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

const T0 = '2026-07-17T00:00:00.000Z';
const T1 = '2026-07-17T01:00:00.000Z';

function cron(overrides: Partial<CronTriggerResource> = {}): CronTriggerResource {
  return {
    type: 'cron',
    namespace: 'acme',
    workflowName: 'nightly-cleanup',
    name: 'nightly',
    enabled: true,
    config: { schedule: '0 1 * * *' },
    lastTriggeredAt: null,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function webhook(overrides: Partial<WebhookTriggerResource> = {}): WebhookTriggerResource {
  return {
    type: 'webhook',
    namespace: 'acme',
    workflowName: 'intake',
    name: 'inbound',
    enabled: true,
    config: { method: 'POST', path: '/inbound' },
    lastTriggeredAt: null,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function manual(overrides: Partial<ManualTriggerResource> = {}): ManualTriggerResource {
  return {
    type: 'manual',
    namespace: 'acme',
    workflowName: 'report',
    name: 'run-now',
    enabled: true,
    config: {},
    lastTriggeredAt: null,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

/**
 * Shared contract for {@link TriggerRepository} (ADR-0011 L2 parity).
 * Both the in-memory double and the Postgres backend MUST satisfy it.
 */
function contract(name: string, factory: () => Promise<TriggerRepository>) {
  describe(`${name} — TriggerRepository contract`, () => {
    let repo: TriggerRepository;

    beforeEach(async () => {
      repo = await factory();
    });

    it('create + listByWorkflow round-trips each type', async () => {
      await repo.create(cron());
      await repo.create(webhook());
      await repo.create(manual());
      expect(await repo.listByWorkflow('acme', 'nightly-cleanup')).toEqual([cron()]);
      expect(await repo.listByWorkflow('acme', 'intake')).toEqual([webhook()]);
      expect(await repo.listByWorkflow('acme', 'report')).toEqual([manual()]);
    });

    it('listByWorkflow is empty for an unknown workflow', async () => {
      expect(await repo.listByWorkflow('acme', 'nope')).toEqual([]);
    });

    it('rejects a duplicate primary key on create', async () => {
      await repo.create(cron());
      await expect(repo.create(cron({ config: { schedule: '@daily' } }))).rejects.toThrow();
    });

    it('listEnabledByType returns only enabled rows of that type', async () => {
      await repo.create(cron({ name: 'a' }));
      await repo.create(cron({ name: 'b', enabled: false }));
      await repo.create(webhook());
      const enabledCron = await repo.listEnabledByType('cron');
      expect(enabledCron.map((t) => t.name)).toEqual(['a']);
      expect(await repo.listEnabledByType('manual')).toEqual([]);
    });

    it('update patches enabled + config and bumps updatedAt', async () => {
      await repo.create(cron());
      const updated = await repo.update('acme', 'nightly-cleanup', 'nightly', {
        enabled: false,
        config: { schedule: '@hourly' },
        updatedAt: T1,
      });
      expect(updated).toEqual(
        cron({ enabled: false, config: { schedule: '@hourly' }, updatedAt: T1 }),
      );
      const [reread] = await repo.listByWorkflow('acme', 'nightly-cleanup');
      expect(reread).toEqual(updated);
    });

    it('update throws for a missing trigger', async () => {
      await expect(
        repo.update('acme', 'nightly-cleanup', 'ghost', { updatedAt: T1 }),
      ).rejects.toThrow();
    });

    it('recordTriggered advances the cron cursor', async () => {
      await repo.create(cron());
      await repo.recordTriggered('acme', 'nightly-cleanup', 'nightly', T1);
      const [row] = await repo.listByWorkflow('acme', 'nightly-cleanup');
      expect(row).toEqual(cron({ lastTriggeredAt: T1 }));
    });

    it('recordTriggered is a no-op for non-cron rows', async () => {
      await repo.create(webhook());
      await repo.recordTriggered('acme', 'intake', 'inbound', T1);
      const [row] = await repo.listByWorkflow('acme', 'intake');
      expect(row).toEqual(webhook());
    });

    it('enforces webhook-path uniqueness within a workflow', async () => {
      await repo.create(webhook({ name: 'first', config: { method: 'POST', path: '/hook' } }));
      await expect(
        repo.create(webhook({ name: 'second', config: { method: 'GET', path: '/hook' } })),
      ).rejects.toThrow();
    });

    it('allows the same webhook path in a different workflow', async () => {
      await repo.create(
        webhook({ workflowName: 'a', name: 'x', config: { method: 'POST', path: '/hook' } }),
      );
      await expect(
        repo.create(
          webhook({ workflowName: 'b', name: 'y', config: { method: 'POST', path: '/hook' } }),
        ),
      ).resolves.toBeDefined();
    });

    it('delete removes a single trigger', async () => {
      await repo.create(cron());
      await repo.delete('acme', 'nightly-cleanup', 'nightly');
      expect(await repo.listByWorkflow('acme', 'nightly-cleanup')).toEqual([]);
    });

    it('deleteByWorkflow removes every trigger of that workflow only', async () => {
      await repo.create(cron({ name: 'a' }));
      await repo.create(cron({ name: 'b' }));
      await repo.create(webhook());
      await repo.deleteByWorkflow('acme', 'nightly-cleanup');
      expect(await repo.listByWorkflow('acme', 'nightly-cleanup')).toEqual([]);
      expect(await repo.listByWorkflow('acme', 'intake')).toEqual([webhook()]);
    });

    it('rejects create with an invalid payload (empty name)', async () => {
      await expect(repo.create(cron({ name: '' }))).rejects.toThrow();
    });
  });
}

contract('InMemoryTriggerRepository', async () => new InMemoryTriggerRepository());

describe.skipIf(skipPg)('PostgresTriggerRepository (parity)', () => {
  const schemaName = `trg_${randomBytes(8).toString('hex')}`;
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

  contract('PostgresTriggerRepository', async () => {
    const db = drizzle(testClient, { schema });
    await testClient.unsafe(
      `TRUNCATE TABLE "${schemaName}"."triggers", "${schemaName}"."workspaces" CASCADE`,
    );
    // Seed the workspace every trigger row references (triggers.namespace FK).
    await db
      .insert(schema.workspaces)
      .values({ handle: 'acme', type: 'organization', displayName: 'acme' });
    return new PostgresTriggerRepository(db);
  });

  it('deleting the workspace cascades away its triggers', async () => {
    const db = drizzle(testClient, { schema });
    await testClient.unsafe(
      `TRUNCATE TABLE "${schemaName}"."triggers", "${schemaName}"."workspaces" CASCADE`,
    );
    await db
      .insert(schema.workspaces)
      .values({ handle: 'acme', type: 'organization', displayName: 'acme' });
    const triggers = new PostgresTriggerRepository(db);
    await triggers.create(cron());

    await new PostgresNamespaceRepository(db).deleteNamespaceCascade('acme');

    expect(await triggers.listEnabledByType('cron')).toEqual([]);
  });
});
