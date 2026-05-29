import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  InMemoryHumanTaskRepository,
  buildHumanTask,
} from '@mediforce/platform-core';
import type {
  HumanTask,
  HumanTaskRepository,
  ProcessInstance,
  ProcessInstanceRepository,
} from '@mediforce/platform-core';
import { PostgresHumanTaskRepository } from '../repositories/human-task-repository.js';
import { PostgresNamespaceRepository } from '../repositories/namespace-repository.js';
import * as schema from '../schema/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

/**
 * Stub ProcessInstanceRepository — only `getById` is invoked from the
 * human-task parity contract. Returns a minimal-shape instance with the
 * namespace mapping registered in `nsByInstance`.
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

function taskFor(
  instanceId: string,
  overrides: Partial<HumanTask> = {},
): HumanTask {
  return buildHumanTask({
    id: randomUUID(),
    processInstanceId: instanceId,
    ...overrides,
  });
}

/**
 * Shared contract for HumanTaskRepository (ADR-0001 L2 parity).
 * Both the in-memory double and Postgres backend MUST satisfy it.
 *
 * Factory returns `(repo, registerInstance)`: callers register
 * `(processInstanceId → namespace)` mappings before creating so both
 * backends can resolve the workspace.
 */
function contract(
  name: string,
  factory: () => Promise<{
    repo: HumanTaskRepository;
    registerInstance: (id: string, namespace: string) => Promise<void>;
  }>,
) {
  describe(`${name} — HumanTaskRepository contract`, () => {
    let repo: HumanTaskRepository;
    let registerInstance: (id: string, namespace: string) => Promise<void>;

    beforeEach(async () => {
      ({ repo, registerInstance } = await factory());
    });

    it('create round-trips and preserves all task fields', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      const task = taskFor(instanceId, {
        assignedRole: 'reviewer',
        creationReason: 'agent_review_l3',
        deadline: '2026-06-30T17:00:00.000Z',
        ui: { component: 'review-form' },
        params: [{ name: 'note', type: 'string', required: false }],
        options: [{ id: 'opt1', label: 'A' }],
        verdicts: [
          { key: 'approve', label: 'Approve', intent: 'success', requiresComment: false },
        ],
        selection: 2,
      });
      const created = await repo.create(task);
      expect(created.id).toBe(task.id);
      expect(created.assignedRole).toBe('reviewer');
      expect(created.creationReason).toBe('agent_review_l3');
      expect(created.deadline).toBe('2026-06-30T17:00:00.000Z');
      expect(created.ui).toEqual({ component: 'review-form' });
      expect(created.params).toEqual([{ name: 'note', type: 'string', required: false }]);
      expect(created.options).toEqual([{ id: 'opt1', label: 'A' }]);
      expect(created.verdicts).toEqual([
        { key: 'approve', label: 'Approve', intent: 'success', requiresComment: false },
      ]);
      expect(created.selection).toBe(2);

      const fetched = await repo.getById(task.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.assignedRole).toBe('reviewer');
      expect(fetched?.verdicts).toHaveLength(1);
    });

    it('getById returns null for unknown id', async () => {
      const missing = await repo.getById(randomUUID());
      expect(missing).toBeNull();
    });

    it('getByRoleAll returns matching tasks across all statuses', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      await repo.create(taskFor(instanceId, { assignedRole: 'reviewer', status: 'pending' }));
      await repo.create(taskFor(instanceId, { assignedRole: 'reviewer', status: 'completed' }));
      await repo.create(taskFor(instanceId, { assignedRole: 'reviewer', status: 'cancelled' }));
      await repo.create(taskFor(instanceId, { assignedRole: 'approver', status: 'pending' }));

      const reviewerRows = await repo.getByRoleAll('reviewer');
      expect(reviewerRows).toHaveLength(3);
      expect(reviewerRows.every((r) => r.assignedRole === 'reviewer')).toBe(true);

      const approverRows = await repo.getByRoleAll('approver');
      expect(approverRows).toHaveLength(1);
    });

    it('getByRoleInNamespaces honors the allowed workspace list', async () => {
      const inst1 = randomUUID();
      const inst2 = randomUUID();
      await registerInstance(inst1, 'ws-1');
      await registerInstance(inst2, 'ws-2');
      await repo.create(taskFor(inst1, { assignedRole: 'reviewer' }));
      await repo.create(taskFor(inst2, { assignedRole: 'reviewer' }));

      const onlyWs1 = await repo.getByRoleInNamespaces('reviewer', ['ws-1']);
      expect(onlyWs1).toHaveLength(1);
      expect(onlyWs1[0].processInstanceId).toBe(inst1);

      const both = await repo.getByRoleInNamespaces('reviewer', ['ws-1', 'ws-2']);
      expect(both).toHaveLength(2);

      const empty = await repo.getByRoleInNamespaces('reviewer', []);
      expect(empty).toHaveLength(0);
    });

    it('getByInstanceId returns tasks for a single instance only', async () => {
      const inst1 = randomUUID();
      const inst2 = randomUUID();
      await registerInstance(inst1, 'ws-1');
      await registerInstance(inst2, 'ws-1');
      await repo.create(taskFor(inst1));
      await repo.create(taskFor(inst1));
      await repo.create(taskFor(inst2));

      const rows = await repo.getByInstanceId(inst1);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.processInstanceId === inst1)).toBe(true);
    });

    it('getByIdInNamespaces honors the allowed workspace list', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      const task = taskFor(instanceId);
      await repo.create(task);

      const allowed = await repo.getByIdInNamespaces(task.id, ['ws-1']);
      expect(allowed?.id).toBe(task.id);

      const denied = await repo.getByIdInNamespaces(task.id, ['ws-2']);
      expect(denied).toBeNull();

      const empty = await repo.getByIdInNamespaces(task.id, []);
      expect(empty).toBeNull();
    });

    it('getByInstanceIdInNamespaces honors the allowed workspace list', async () => {
      const inst1 = randomUUID();
      const inst2 = randomUUID();
      await registerInstance(inst1, 'ws-1');
      await registerInstance(inst2, 'ws-2');
      await repo.create(taskFor(inst1));
      await repo.create(taskFor(inst2));

      const onlyWs1 = await repo.getByInstanceIdInNamespaces(inst1, ['ws-1']);
      expect(onlyWs1).toHaveLength(1);

      const denied = await repo.getByInstanceIdInNamespaces(inst1, ['ws-2']);
      expect(denied).toHaveLength(0);

      const empty = await repo.getByInstanceIdInNamespaces(inst1, []);
      expect(empty).toHaveLength(0);
    });

    it('claim sets assignedUserId + status=claimed', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      const task = await repo.create(taskFor(instanceId, { status: 'pending' }));
      expect(task.assignedUserId).toBeNull();

      const claimed = await repo.claim(task.id, 'user-1');
      expect(claimed.assignedUserId).toBe('user-1');
      expect(claimed.status).toBe('claimed');

      const fetched = await repo.getById(task.id);
      expect(fetched?.status).toBe('claimed');
      expect(fetched?.assignedUserId).toBe('user-1');
    });

    it('complete sets status=completed + writes completionData + completedAt', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      const task = await repo.create(taskFor(instanceId, { status: 'claimed' }));

      const completed = await repo.complete(task.id, { decision: 'approve', note: 'ok' });
      expect(completed.status).toBe('completed');
      expect(completed.completionData).toEqual({ decision: 'approve', note: 'ok' });
      expect(completed.completedAt).not.toBeNull();
    });

    it('cancel sets status=cancelled', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      const task = await repo.create(taskFor(instanceId, { status: 'pending' }));

      const cancelled = await repo.cancel(task.id);
      expect(cancelled.status).toBe('cancelled');
    });

    it('setDeletedByInstanceIds tombstones tasks and reverses on false', async () => {
      const inst1 = randomUUID();
      const inst2 = randomUUID();
      await registerInstance(inst1, 'ws-1');
      await registerInstance(inst2, 'ws-1');
      const t1 = await repo.create(taskFor(inst1, { assignedRole: 'reviewer' }));
      const t2 = await repo.create(taskFor(inst1, { assignedRole: 'reviewer' }));
      const t3 = await repo.create(taskFor(inst2, { assignedRole: 'reviewer' }));

      await repo.setDeletedByInstanceIds([inst1], true);

      // Tombstones excluded from role queue (partial-index semantics).
      const activeRows = await repo.getByRoleAll('reviewer');
      expect(activeRows.map((r) => r.id).sort()).toEqual([t3.id].sort());

      // getById still finds tombstoned rows and exposes deleted=true.
      const tombstone = await repo.getById(t1.id);
      expect(tombstone?.deleted).toBe(true);

      // Reversal clears the tombstone.
      await repo.setDeletedByInstanceIds([inst1], false);
      const restored = await repo.getByRoleAll('reviewer');
      expect(restored.map((r) => r.id).sort()).toEqual(
        [t1.id, t2.id, t3.id].sort(),
      );
    });

    it('setDeletedByInstanceIds no-ops on empty list', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      await repo.create(taskFor(instanceId, { assignedRole: 'reviewer' }));

      await repo.setDeletedByInstanceIds([], true);
      const rows = await repo.getByRoleAll('reviewer');
      expect(rows).toHaveLength(1);
    });

    it('workspace isolation prevents cross-tenant reads via getByRoleInNamespaces', async () => {
      const inst1 = randomUUID();
      const inst2 = randomUUID();
      await registerInstance(inst1, 'ws-alpha');
      await registerInstance(inst2, 'ws-beta');
      await repo.create(taskFor(inst1, { assignedRole: 'reviewer' }));
      await repo.create(taskFor(inst2, { assignedRole: 'reviewer' }));

      const alphaView = await repo.getByRoleInNamespaces('reviewer', ['ws-alpha']);
      expect(alphaView).toHaveLength(1);
      expect(alphaView[0].processInstanceId).toBe(inst1);

      const betaView = await repo.getByRoleInNamespaces('reviewer', ['ws-beta']);
      expect(betaView).toHaveLength(1);
      expect(betaView[0].processInstanceId).toBe(inst2);
    });

    it('rejects create with invalid status', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      await expect(
        repo.create({
          ...taskFor(instanceId),
          status: 'bogus',
        } as unknown as HumanTask),
      ).rejects.toThrow();
    });
  });
}

contract('InMemoryHumanTaskRepository', async () => {
  const nsByInstance = new Map<string, string>();
  const parents = new StubProcessInstanceRepository(nsByInstance);
  const repo = new InMemoryHumanTaskRepository(parents);
  return {
    repo,
    registerInstance: async (id, namespace) => {
      nsByInstance.set(id, namespace);
    },
  };
});

describe.skipIf(skipPg)('PostgresHumanTaskRepository (parity)', () => {
  const schemaName = `human_task_${randomBytes(8).toString('hex')}`;
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

  contract('PostgresHumanTaskRepository', async () => {
    const db = drizzle(testClient, { schema });
    await testClient.unsafe(
      `TRUNCATE TABLE "${schemaName}"."human_tasks", ` +
        `"${schemaName}"."process_instances", ` +
        `"${schemaName}"."workspace_members", "${schemaName}"."workspaces" CASCADE`,
    );
    const nsByInstance = new Map<string, string>();
    const parents = new StubProcessInstanceRepository(nsByInstance);
    const repo = new PostgresHumanTaskRepository(db, parents);
    const nsRepo = new PostgresNamespaceRepository(db);
    return {
      repo,
      registerInstance: async (id, namespace) => {
        nsByInstance.set(id, namespace);
        if (!(await nsRepo.getNamespace(namespace))) {
          await nsRepo.createNamespace({
            handle: namespace,
            type: 'organization',
            displayName: namespace,
            createdAt: '2026-05-27T00:00:00.000Z',
          });
        }
        // Parent process_instances row required by FK from human_tasks.
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
