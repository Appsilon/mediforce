import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  InMemoryHandoffRepository,
  handoffTypeRegistry,
} from '@mediforce/platform-core';
import type {
  HandoffEntity,
  HandoffRepository,
  ProcessInstance,
  ProcessInstanceRepository,
} from '@mediforce/platform-core';
import { PostgresHandoffRepository } from '../repositories/handoff-repository';
import { PostgresNamespaceRepository } from '../repositories/namespace-repository';
import * as schema from '../schema/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

const TEST_HANDOFF_TYPE = 'test_handoff';

/**
 * Stub ProcessInstanceRepository — only `getById` is invoked from the
 * handoff parity contract. Returns a minimal-shape instance with the
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
      status: 'running',
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
  async listDefinitionNames(): Promise<never> { throw new Error('stub'); }
  async summarizeRunsByWorkflow(): Promise<never> { throw new Error('stub'); }
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

function handoffFor(
  instanceId: string,
  overrides: Partial<HandoffEntity> = {},
): HandoffEntity {
  const now = '2026-05-27T00:00:00.000Z';
  return {
    id: randomUUID(),
    type: TEST_HANDOFF_TYPE,
    processInstanceId: instanceId,
    stepId: 'step-review',
    agentRunId: 'run-001',
    assignedRole: 'reviewer',
    assignedUserId: null,
    status: 'created',
    agentWork: { detail: 'work' },
    agentReasoning: 'reasoned about it',
    agentQuestion: 'please review',
    payload: { item: 'x' },
    resolution: null,
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    ...overrides,
  };
}

/**
 * Shared contract for HandoffRepository (ADR-0001 L2 parity).
 * Both the in-memory double and Postgres backend MUST satisfy it.
 */
function contract(
  name: string,
  factory: () => Promise<{
    repo: HandoffRepository;
    registerInstance: (id: string, namespace: string) => Promise<void>;
  }>,
) {
  describe(`${name} — HandoffRepository contract`, () => {
    let repo: HandoffRepository;
    let registerInstance: (id: string, namespace: string) => Promise<void>;

    beforeEach(async () => {
      ({ repo, registerInstance } = await factory());
    });

    it('create round-trips and preserves all entity fields', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      const entity = handoffFor(instanceId, {
        type: TEST_HANDOFF_TYPE,
        agentWork: { foo: 'bar' },
        agentReasoning: 'because reasons',
        agentQuestion: 'is this ok?',
        payload: { ticket: 'T-1' },
      });
      const created = await repo.create(entity);
      expect(created.id).toBe(entity.id);
      expect(created.type).toBe(TEST_HANDOFF_TYPE);
      expect(created.agentWork).toEqual({ foo: 'bar' });
      expect(created.agentReasoning).toBe('because reasons');
      expect(created.agentQuestion).toBe('is this ok?');
      expect(created.payload).toEqual({ ticket: 'T-1' });

      const fetched = await repo.getById(entity.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.payload).toEqual({ ticket: 'T-1' });
      expect(fetched?.resolution).toBeNull();
    });

    it('getById returns null for unknown id', async () => {
      const missing = await repo.getById(randomUUID());
      expect(missing).toBeNull();
    });

    it('getByRoleAll returns created+acknowledged tasks; excludes resolved', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      await repo.create(handoffFor(instanceId, { assignedRole: 'reviewer', status: 'created' }));
      const ackEntity = await repo.create(
        handoffFor(instanceId, { assignedRole: 'reviewer', status: 'created', assignedUserId: 'user-1' }),
      );
      await repo.acknowledge(ackEntity.id, 'user-1');
      const resolveEntity = await repo.create(
        handoffFor(instanceId, { assignedRole: 'reviewer', status: 'created', assignedUserId: 'user-1' }),
      );
      await repo.resolve(resolveEntity.id, 'user-1', { decision: 'done' });
      await repo.create(handoffFor(instanceId, { assignedRole: 'approver' }));

      const reviewerRows = await repo.getByRoleAll('reviewer');
      expect(reviewerRows).toHaveLength(2);
      expect(reviewerRows.every((r) => r.assignedRole === 'reviewer')).toBe(true);
      expect(reviewerRows.every((r) => r.status !== 'resolved')).toBe(true);

      const approverRows = await repo.getByRoleAll('approver');
      expect(approverRows).toHaveLength(1);
    });

    it('getByRoleInNamespaces honors the allowed workspace list', async () => {
      const inst1 = randomUUID();
      const inst2 = randomUUID();
      await registerInstance(inst1, 'ws-1');
      await registerInstance(inst2, 'ws-2');
      await repo.create(handoffFor(inst1, { assignedRole: 'reviewer' }));
      await repo.create(handoffFor(inst2, { assignedRole: 'reviewer' }));

      const onlyWs1 = await repo.getByRoleInNamespaces('reviewer', ['ws-1']);
      expect(onlyWs1).toHaveLength(1);
      expect(onlyWs1[0].processInstanceId).toBe(inst1);

      const both = await repo.getByRoleInNamespaces('reviewer', ['ws-1', 'ws-2']);
      expect(both).toHaveLength(2);

      const empty = await repo.getByRoleInNamespaces('reviewer', []);
      expect(empty).toHaveLength(0);
    });

    it('getByInstanceId returns handoffs for a single instance only', async () => {
      const inst1 = randomUUID();
      const inst2 = randomUUID();
      await registerInstance(inst1, 'ws-1');
      await registerInstance(inst2, 'ws-1');
      await repo.create(handoffFor(inst1));
      await repo.create(handoffFor(inst1));
      await repo.create(handoffFor(inst2));

      const rows = await repo.getByInstanceId(inst1);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.processInstanceId === inst1)).toBe(true);
    });

    it('getByIdInNamespaces honors the allowed workspace list', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      const entity = await repo.create(handoffFor(instanceId));

      const allowed = await repo.getByIdInNamespaces(entity.id, ['ws-1']);
      expect(allowed?.id).toBe(entity.id);

      const denied = await repo.getByIdInNamespaces(entity.id, ['ws-2']);
      expect(denied).toBeNull();

      const empty = await repo.getByIdInNamespaces(entity.id, []);
      expect(empty).toBeNull();
    });

    it('getByInstanceIdInNamespaces honors the allowed workspace list', async () => {
      const inst1 = randomUUID();
      const inst2 = randomUUID();
      await registerInstance(inst1, 'ws-1');
      await registerInstance(inst2, 'ws-2');
      await repo.create(handoffFor(inst1));
      await repo.create(handoffFor(inst2));

      const onlyWs1 = await repo.getByInstanceIdInNamespaces(inst1, ['ws-1']);
      expect(onlyWs1).toHaveLength(1);

      const denied = await repo.getByInstanceIdInNamespaces(inst1, ['ws-2']);
      expect(denied).toHaveLength(0);

      const empty = await repo.getByInstanceIdInNamespaces(inst1, []);
      expect(empty).toHaveLength(0);
    });

    it('claim sets assignedUserId + status=acknowledged', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      const entity = await repo.create(handoffFor(instanceId, { status: 'created' }));
      expect(entity.assignedUserId).toBeNull();

      const claimed = await repo.claim(entity.id, 'user-1');
      expect(claimed.assignedUserId).toBe('user-1');
      expect(claimed.status).toBe('acknowledged');

      const fetched = await repo.getById(entity.id);
      expect(fetched?.status).toBe('acknowledged');
      expect(fetched?.assignedUserId).toBe('user-1');
    });

    it('acknowledge requires the assigned user', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      const entity = await repo.create(
        handoffFor(instanceId, { assignedUserId: 'user-1', status: 'created' }),
      );

      await expect(
        repo.acknowledge(entity.id, 'someone-else'),
      ).rejects.toThrow();

      const ack = await repo.acknowledge(entity.id, 'user-1');
      expect(ack.status).toBe('acknowledged');
    });

    it('resolve sets status=resolved + writes resolution + resolvedAt', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      const entity = await repo.create(
        handoffFor(instanceId, { assignedUserId: 'user-1', status: 'acknowledged' }),
      );

      const resolved = await repo.resolve(entity.id, 'user-1', {
        decision: 'approve',
        note: 'looks good',
      });
      expect(resolved.status).toBe('resolved');
      expect(resolved.resolution).toEqual({ decision: 'approve', note: 'looks good' });
      expect(resolved.resolvedAt).not.toBeNull();
    });

    it('resolve rejects when caller is not the assigned user', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      const entity = await repo.create(
        handoffFor(instanceId, { assignedUserId: 'user-1', status: 'acknowledged' }),
      );

      await expect(
        repo.resolve(entity.id, 'intruder', { decision: 'approve', note: '' }),
      ).rejects.toThrow();
    });

    it('workspace isolation prevents cross-tenant reads via getByRoleInNamespaces', async () => {
      const inst1 = randomUUID();
      const inst2 = randomUUID();
      await registerInstance(inst1, 'ws-alpha');
      await registerInstance(inst2, 'ws-beta');
      await repo.create(handoffFor(inst1, { assignedRole: 'reviewer' }));
      await repo.create(handoffFor(inst2, { assignedRole: 'reviewer' }));

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
          ...handoffFor(instanceId),
          status: 'bogus',
        } as unknown as HandoffEntity),
      ).rejects.toThrow();
    });
  });
}

// Register handoff type once for the whole suite — both backends need the
// resolution schema available during resolve().
beforeAll(() => {
  if (!handoffTypeRegistry.isRegistered(TEST_HANDOFF_TYPE)) {
    // Minimal Zod-shaped duck (parse-only) — keeps zod out of platform-infra's
    // deps. The registry only calls `.parse(...)` on these.
    const passthrough = { parse: (v: unknown) => v };
    handoffTypeRegistry.register({
      type: TEST_HANDOFF_TYPE,
      payloadSchema: passthrough as never,
      resolutionSchema: passthrough as never,
    });
  }
});

afterAll(() => {
  handoffTypeRegistry.reset();
});

contract('InMemoryHandoffRepository', async () => {
  const nsByInstance = new Map<string, string>();
  const parents = new StubProcessInstanceRepository(nsByInstance);
  const repo = new InMemoryHandoffRepository(parents);
  return {
    repo,
    registerInstance: async (id, namespace) => {
      nsByInstance.set(id, namespace);
    },
  };
});

describe.skipIf(skipPg)('PostgresHandoffRepository (parity)', () => {
  const schemaName = `handoff_${randomBytes(8).toString('hex')}`;
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

  contract('PostgresHandoffRepository', async () => {
    const db = drizzle(testClient, { schema });
    await testClient.unsafe(
      `TRUNCATE TABLE "${schemaName}"."handoff_entities", ` +
        `"${schemaName}"."process_instances", ` +
        `"${schemaName}"."workspace_members", "${schemaName}"."workspaces" CASCADE`,
    );
    const nsByInstance = new Map<string, string>();
    const parents = new StubProcessInstanceRepository(nsByInstance);
    const repo = new PostgresHandoffRepository(db, parents);
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
        // Parent process_instances row required by FK from handoff_entities.
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
