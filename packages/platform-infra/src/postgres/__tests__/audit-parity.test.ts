import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  InMemoryAuditRepository,
} from '@mediforce/platform-core';
import type {
  AuditEvent,
  AuditRepository,
  ProcessInstance,
  ProcessInstanceRepository,
} from '@mediforce/platform-core';
import { PostgresAuditRepository } from '../repositories/audit-repository.js';
import { PostgresNamespaceRepository } from '../repositories/namespace-repository.js';
import * as schema from '../schema/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

/**
 * Stub ProcessInstanceRepository — the only call paths used by the audit
 * parity contract go through `getById`. Returns a minimal-shape instance
 * with the namespace mapping registered in `nsByInstance`.
 */
class StubProcessInstanceRepository implements ProcessInstanceRepository {
  constructor(private readonly nsByInstance: Map<string, string>) {}

  async getNamespaceById(instanceId: string): Promise<string | null> {
    return this.nsByInstance.get(instanceId) ?? null;
  }

  async getById(instanceId: string): Promise<ProcessInstance | null> {
    const namespace = this.nsByInstance.get(instanceId);
    if (namespace === undefined) return null;
    return {
      id: instanceId,
      definitionName: 'stub-def',
      definitionVersion: '1.0.0',
      status: 'completed',
      namespace,
      input: {},
      output: {},
      createdAt: '2026-05-27T00:00:00.000Z',
      updatedAt: '2026-05-27T00:00:00.000Z',
    } as unknown as ProcessInstance;
  }

  // Methods unused by the parity contract — throw if accidentally hit.
  async create(): Promise<ProcessInstance> { throw new Error('stub'); }
  async getByIdInNamespaces(): Promise<ProcessInstance | null> { throw new Error('stub'); }
  async listAll(): Promise<ProcessInstance[]> { throw new Error('stub'); }
  async listInNamespaces(): Promise<ProcessInstance[]> { throw new Error('stub'); }
  async getByStatusAll(): Promise<ProcessInstance[]> { throw new Error('stub'); }
  async getByStatusInNamespaces(): Promise<ProcessInstance[]> { throw new Error('stub'); }
  async update(): Promise<void> { throw new Error('stub'); }
  async getByDefinition(): Promise<ProcessInstance[]> { throw new Error('stub'); }
  async getLastCompletedByDefinitionName(): Promise<ProcessInstance | null> { throw new Error('stub'); }
  async addStepExecution(): Promise<never> { throw new Error('stub'); }
  async getStepExecutions(): Promise<never[]> { throw new Error('stub'); }
  async getLatestStepExecution(): Promise<null> { throw new Error('stub'); }
  async updateStepExecution(): Promise<void> { throw new Error('stub'); }
  async getIdsByDefinitionName(): Promise<string[]> { throw new Error('stub'); }
  async setDeletedByDefinitionName(): Promise<void> { throw new Error('stub'); }
}

function eventBase(
  overrides: Partial<Omit<AuditEvent, 'serverTimestamp'>> = {},
): Omit<AuditEvent, 'serverTimestamp'> {
  return {
    actorId: 'user-1',
    actorType: 'user',
    actorRole: 'reviewer',
    action: 'review.submitted',
    description: 'desc',
    timestamp: '2026-05-27T12:00:00.000Z',
    inputSnapshot: { in: 'a' },
    outputSnapshot: { out: 'b' },
    basis: 'protocol-v1',
    entityType: 'case',
    entityId: 'case-1',
    processInstanceId: 'unset',
    ...overrides,
  };
}

/**
 * Shared contract for AuditRepository (ADR-0001 L2 parity).
 * Both the in-memory double and Postgres backend MUST satisfy it.
 *
 * Factory returns `(repo, registerInstance)`: callers register
 * `(processInstanceId → namespace)` mappings before appending so both
 * backends can resolve the workspace.
 */
function contract(
  name: string,
  factory: () => Promise<{
    repo: AuditRepository;
    registerInstance: (id: string, namespace: string) => Promise<void>;
  }>,
) {
  describe(`${name} — AuditRepository contract`, () => {
    let repo: AuditRepository;
    let registerInstance: (id: string, namespace: string) => Promise<void>;

    beforeEach(async () => {
      ({ repo, registerInstance } = await factory());
    });

    it('append round-trips and populates serverTimestamp', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      const result = await repo.append(eventBase({ processInstanceId: instanceId }));
      expect(result.serverTimestamp).toBeDefined();
      expect(typeof result.serverTimestamp).toBe('string');
      expect(result.entityId).toBe('case-1');
      expect(result.inputSnapshot).toEqual({ in: 'a' });
    });

    it('getByEntity returns matching events in DESC order by timestamp', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      await repo.append(eventBase({
        processInstanceId: instanceId,
        entityType: 'case',
        entityId: 'case-1',
        timestamp: '2026-01-01T08:00:00.000Z',
      }));
      await repo.append(eventBase({
        processInstanceId: instanceId,
        entityType: 'case',
        entityId: 'case-1',
        timestamp: '2026-01-01T12:00:00.000Z',
      }));
      await repo.append(eventBase({
        processInstanceId: instanceId,
        entityType: 'case',
        entityId: 'case-1',
        timestamp: '2026-01-01T10:00:00.000Z',
      }));
      // Sibling entity should not leak in.
      await repo.append(eventBase({
        processInstanceId: instanceId,
        entityType: 'case',
        entityId: 'case-2',
      }));

      const results = await repo.getByEntity('case', 'case-1');
      expect(results).toHaveLength(3);
      expect(results.map((e) => e.timestamp)).toEqual([
        '2026-01-01T12:00:00.000Z',
        '2026-01-01T10:00:00.000Z',
        '2026-01-01T08:00:00.000Z',
      ]);
    });

    it('getByProcess returns matching events in ASC order by timestamp', async () => {
      const instanceId = randomUUID();
      const otherId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      await registerInstance(otherId, 'ws-1');
      await repo.append(eventBase({
        processInstanceId: instanceId,
        timestamp: '2026-01-01T12:00:00.000Z',
      }));
      await repo.append(eventBase({
        processInstanceId: instanceId,
        timestamp: '2026-01-01T08:00:00.000Z',
      }));
      await repo.append(eventBase({
        processInstanceId: otherId,
        timestamp: '2026-01-01T09:00:00.000Z',
      }));

      const results = await repo.getByProcess(instanceId);
      expect(results).toHaveLength(2);
      expect(results.map((e) => e.timestamp)).toEqual([
        '2026-01-01T08:00:00.000Z',
        '2026-01-01T12:00:00.000Z',
      ]);
    });

    it('getByProcessInNamespaces returns nothing when workspace not in allowed', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      await repo.append(eventBase({ processInstanceId: instanceId }));

      const allowed = await repo.getByProcessInNamespaces(instanceId, ['ws-1']);
      expect(allowed).toHaveLength(1);

      const denied = await repo.getByProcessInNamespaces(instanceId, ['ws-2']);
      expect(denied).toHaveLength(0);

      const empty = await repo.getByProcessInNamespaces(instanceId, []);
      expect(empty).toHaveLength(0);
    });

    it('getByActor respects the limit option and DESC order', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      for (const ts of [
        '2026-01-01T08:00:00.000Z',
        '2026-01-01T09:00:00.000Z',
        '2026-01-01T10:00:00.000Z',
        '2026-01-01T11:00:00.000Z',
      ]) {
        await repo.append(eventBase({
          processInstanceId: instanceId,
          actorId: 'user-A',
          timestamp: ts,
        }));
      }
      // Different actor — should be excluded.
      await repo.append(eventBase({
        processInstanceId: instanceId,
        actorId: 'user-B',
      }));

      const limited = await repo.getByActor('user-A', { limit: 2 });
      expect(limited).toHaveLength(2);
      expect(limited[0].timestamp).toBe('2026-01-01T11:00:00.000Z');
      expect(limited[1].timestamp).toBe('2026-01-01T10:00:00.000Z');
    });

    it('rejects append with invalid payload (bad actorType)', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      await expect(
        repo.append({
          ...eventBase({ processInstanceId: instanceId }),
          actorType: 'bogus',
        } as unknown as Omit<AuditEvent, 'serverTimestamp'>),
      ).rejects.toThrow();
    });
  });
}

contract('InMemoryAuditRepository', async () => {
  const nsByInstance = new Map<string, string>();
  const parents = new StubProcessInstanceRepository(nsByInstance);
  const repo = new InMemoryAuditRepository(parents);
  return {
    repo,
    registerInstance: async (id, namespace) => {
      nsByInstance.set(id, namespace);
    },
  };
});

describe.skipIf(skipPg)('PostgresAuditRepository (parity)', () => {
  const schemaName = `audit_${randomBytes(8).toString('hex')}`;
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

  contract('PostgresAuditRepository', async () => {
    const db = drizzle(testClient, { schema });
    await testClient.unsafe(
      `TRUNCATE TABLE "${schemaName}"."audit_events", ` +
        `"${schemaName}"."process_instances", ` +
        `"${schemaName}"."workspace_members", "${schemaName}"."workspaces" CASCADE`,
    );
    const nsByInstance = new Map<string, string>();
    const parents = new StubProcessInstanceRepository(nsByInstance);
    const repo = new PostgresAuditRepository(db, parents);
    const nsRepo = new PostgresNamespaceRepository(db);
    return {
      repo,
      registerInstance: async (id, namespace) => {
        nsByInstance.set(id, namespace);
        // workspace row must exist for the FK to hold on append.
        if (!(await nsRepo.getNamespace(namespace))) {
          await nsRepo.createNamespace({
            handle: namespace,
            type: 'organization',
            displayName: namespace,
            createdAt: '2026-05-27T00:00:00.000Z',
          });
        }
        // Parent process_instances row required by FK from audit_events.
        await testClient.unsafe(
          `INSERT INTO "${schemaName}"."process_instances" ` +
            `(id, workspace, definition_name, definition_version, status, ` +
            `variables, trigger_type, trigger_payload) ` +
            `VALUES ($1, $2, 'stub-def', '1.0.0', 'completed', '{}'::jsonb, 'manual', '{}'::jsonb) ` +
            `ON CONFLICT (id) DO NOTHING`,
          [id, namespace],
        );
      },
    };
  });
});
