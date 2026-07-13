import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InMemoryProcessInstanceRepository } from '@mediforce/platform-core';
import type {
  AgentEvent,
  ProcessInstance,
  ProcessInstanceRepository,
  StepExecution,
} from '@mediforce/platform-core';
import { PostgresProcessInstanceRepository } from '../repositories/process-instance-repository';
import { PostgresNamespaceRepository } from '../repositories/namespace-repository';
import * as schema from '../schema/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

function instanceFor(
  namespace: string,
  overrides: Partial<ProcessInstance> = {},
): ProcessInstance {
  const now = '2026-05-27T00:00:00.000Z';
  return {
    id: `inst-${randomUUID()}`,
    definitionName: 'supply-chain-review',
    definitionVersion: '1.0.0',
    status: 'created',
    currentStepId: null,
    variables: {},
    triggerType: 'manual',
    triggerPayload: {},
    createdAt: now,
    updatedAt: now,
    createdBy: 'user-1',
    pauseReason: null,
    error: null,
    assignedRoles: [],
    deleted: false,
    archived: false,
    dryRun: false,
    namespace,
    ...overrides,
  };
}

function stepExecutionFor(
  instanceId: string,
  overrides: Partial<StepExecution> = {},
): StepExecution {
  return {
    id: `exec-${randomUUID()}`,
    instanceId,
    stepId: 'intake',
    status: 'completed',
    input: { document: 'report.pdf' },
    output: { summary: 'Processed' },
    verdict: null,
    executedBy: 'agent-1',
    startedAt: '2026-05-27T00:01:00.000Z',
    completedAt: '2026-05-27T00:02:00.000Z',
    iterationNumber: 1,
    gateResult: null,
    error: null,
    ...overrides,
  };
}

/**
 * Shared contract for ProcessInstanceRepository (ADR-0001 L2 parity).
 * Both the in-memory double and Postgres backend MUST satisfy it.
 *
 * Factory returns `(repo, registerWorkspace)`: callers register
 * `namespace` handles before creating instances so the Postgres backend
 * can satisfy the workspaces FK. The in-memory double ignores
 * registration entirely.
 */
function contract(
  name: string,
  factory: () => Promise<{
    repo: ProcessInstanceRepository;
    registerWorkspace: (namespace: string) => Promise<void>;
  }>,
) {
  describe(`${name} — ProcessInstanceRepository contract`, () => {
    it('create round-trips and preserves namespace + variables', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-1');
      const instance = instanceFor('ws-1', {
        variables: { caseId: 'case-99', priority: 'high' },
        triggerType: 'webhook',
        triggerPayload: { source: 'github' },
      });
      const created = await repo.create(instance);
      expect(created.id).toBe(instance.id);
      expect(created.namespace).toBe('ws-1');
      expect(created.variables).toEqual({ caseId: 'case-99', priority: 'high' });
      expect(created.triggerType).toBe('webhook');

      const fetched = await repo.getById(instance.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.namespace).toBe('ws-1');
      expect(fetched?.variables).toEqual({ caseId: 'case-99', priority: 'high' });
    });

    it('getById returns null for unknown id', async () => {
      const { repo } = await factory();
      expect(await repo.getById(`inst-missing-${randomUUID()}`)).toBeNull();
    });

    it('update applies patch and refreshes updatedAt', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-1');
      const created = await repo.create(instanceFor('ws-1'));

      await repo.update(created.id, {
        status: 'running',
        currentStepId: 'intake',
        variables: { foo: 'bar' },
      });
      const updated = await repo.getById(created.id);
      expect(updated?.status).toBe('running');
      expect(updated?.currentStepId).toBe('intake');
      expect(updated?.variables).toEqual({ foo: 'bar' });
    });

    it('listAll filters tombstoned rows + applies status + limit', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-1');
      const a = await repo.create(instanceFor('ws-1', { status: 'running' }));
      await repo.create(instanceFor('ws-1', { status: 'completed' }));
      const tombstoned = await repo.create(
        instanceFor('ws-1', { status: 'running' }),
      );
      await repo.update(tombstoned.id, { deleted: true });

      const running = await repo.listAll({ status: 'running', limit: 50 });
      const ids = running.map((r) => r.id);
      expect(ids).toContain(a.id);
      expect(ids).not.toContain(tombstoned.id);
    });

    it('listInNamespaces honors workspace filter', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-alpha');
      await registerWorkspace('ws-beta');
      const alpha = await repo.create(instanceFor('ws-alpha'));
      const beta = await repo.create(instanceFor('ws-beta'));

      const onlyAlpha = await repo.listInNamespaces(['ws-alpha'], {});
      const ids = onlyAlpha.map((r) => r.id);
      expect(ids).toContain(alpha.id);
      expect(ids).not.toContain(beta.id);

      const denied = await repo.listInNamespaces([], {});
      expect(denied).toEqual([]);
    });

    it('listAll applies options.namespace filter', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-alpha');
      await registerWorkspace('ws-beta');
      const alpha = await repo.create(instanceFor('ws-alpha'));
      const beta = await repo.create(instanceFor('ws-beta'));

      const onlyAlpha = await repo.listAll({ namespace: 'ws-alpha', limit: 50 });
      const ids = onlyAlpha.map((r) => r.id);
      expect(ids).toContain(alpha.id);
      expect(ids).not.toContain(beta.id);
    });

    it('listInNamespaces applies options.namespace within the allowed set', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-alpha');
      await registerWorkspace('ws-beta');
      const alpha = await repo.create(instanceFor('ws-alpha'));
      const beta = await repo.create(instanceFor('ws-beta'));

      // Caller is a member of both, but page-scopes to alpha.
      const scoped = await repo.listInNamespaces(
        ['ws-alpha', 'ws-beta'],
        { namespace: 'ws-alpha', limit: 50 },
      );
      const ids = scoped.map((r) => r.id);
      expect(ids).toContain(alpha.id);
      expect(ids).not.toContain(beta.id);
    });

    it('getByIdInNamespaces honors the allowed list', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-1');
      const created = await repo.create(instanceFor('ws-1'));

      const allowed = await repo.getByIdInNamespaces(created.id, ['ws-1']);
      expect(allowed?.id).toBe(created.id);

      const denied = await repo.getByIdInNamespaces(created.id, ['ws-other']);
      expect(denied).toBeNull();

      const empty = await repo.getByIdInNamespaces(created.id, []);
      expect(empty).toBeNull();
    });

    it('getByStatusAll / InNamespaces filter correctly', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-1');
      await registerWorkspace('ws-2');
      const r1 = await repo.create(instanceFor('ws-1', { status: 'running' }));
      const r2 = await repo.create(instanceFor('ws-2', { status: 'running' }));
      await repo.create(instanceFor('ws-1', { status: 'completed' }));

      const allRunning = await repo.getByStatusAll('running');
      const ids = allRunning.map((r) => r.id);
      expect(ids).toContain(r1.id);
      expect(ids).toContain(r2.id);

      const scoped = await repo.getByStatusInNamespaces('running', ['ws-1']);
      const scopedIds = scoped.map((r) => r.id);
      expect(scopedIds).toContain(r1.id);
      expect(scopedIds).not.toContain(r2.id);
    });

    it('getLastCompletedByDefinitionName picks newest completed run', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-1');
      const older = await repo.create(
        instanceFor('ws-1', {
          status: 'completed',
          updatedAt: '2026-05-26T00:00:00.000Z',
        }),
      );
      const newer = await repo.create(
        instanceFor('ws-1', {
          status: 'completed',
          updatedAt: '2026-05-27T00:00:00.000Z',
        }),
      );
      // Tombstoned newest — must be skipped.
      const tombstoned = await repo.create(
        instanceFor('ws-1', {
          status: 'completed',
          updatedAt: '2026-05-28T00:00:00.000Z',
        }),
      );
      await repo.update(tombstoned.id, { deleted: true });

      const last = await repo.getLastCompletedByDefinitionName(
        'supply-chain-review',
      );
      expect(last?.id).toBe(newer.id);
      // older + tombstoned must not bubble up
      expect(last?.id).not.toBe(older.id);
      expect(last?.id).not.toBe(tombstoned.id);
    });

    it('addStepExecution + getStepExecutions ordered by startedAt asc', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-1');
      const inst = await repo.create(instanceFor('ws-1'));

      await repo.addStepExecution(
        inst.id,
        stepExecutionFor(inst.id, {
          stepId: 'b',
          startedAt: '2026-05-27T00:02:00.000Z',
        }),
      );
      await repo.addStepExecution(
        inst.id,
        stepExecutionFor(inst.id, {
          stepId: 'a',
          startedAt: '2026-05-27T00:01:00.000Z',
        }),
      );
      const execs = await repo.getStepExecutions(inst.id);
      expect(execs).toHaveLength(2);
      expect(execs[0].stepId).toBe('a');
      expect(execs[1].stepId).toBe('b');
    });

    it('updateStepExecution patches in place', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-1');
      const inst = await repo.create(instanceFor('ws-1'));
      const exec = await repo.addStepExecution(
        inst.id,
        stepExecutionFor(inst.id, { status: 'running', output: null }),
      );

      await repo.updateStepExecution(inst.id, exec.id, {
        status: 'completed',
        output: { summary: 'done' },
      });
      const fetched = (await repo.getStepExecutions(inst.id))[0];
      expect(fetched.status).toBe('completed');
      expect(fetched.output).toEqual({ summary: 'done' });
    });

    it('getLatestStepExecution returns the most recent for a step', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-1');
      const inst = await repo.create(instanceFor('ws-1'));

      await repo.addStepExecution(
        inst.id,
        stepExecutionFor(inst.id, {
          stepId: 'intake',
          startedAt: '2026-05-27T00:01:00.000Z',
        }),
      );
      const later = await repo.addStepExecution(
        inst.id,
        stepExecutionFor(inst.id, {
          stepId: 'intake',
          startedAt: '2026-05-27T00:03:00.000Z',
        }),
      );

      const latest = await repo.getLatestStepExecution(inst.id, 'intake');
      expect(latest?.id).toBe(later.id);
    });

    it('getByDefinition filters by name + version', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-1');
      const a = await repo.create(
        instanceFor('ws-1', { definitionName: 'd1', definitionVersion: '1.0.0' }),
      );
      await repo.create(
        instanceFor('ws-1', { definitionName: 'd1', definitionVersion: '2.0.0' }),
      );
      await repo.create(
        instanceFor('ws-1', { definitionName: 'd2', definitionVersion: '1.0.0' }),
      );

      const rows = await repo.getByDefinition('d1', '1.0.0');
      expect(rows.map((r) => r.id)).toEqual([a.id]);
    });

    it('summarizeRunsByWorkflow counts active + scopes total/latest', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-sum');
      await repo.create(
        instanceFor('ws-sum', {
          status: 'running',
          createdAt: '2026-05-27T00:01:00.000Z',
        }),
      );
      await repo.create(
        instanceFor('ws-sum', {
          status: 'created',
          createdAt: '2026-05-27T00:02:00.000Z',
        }),
      );
      const completed = await repo.create(
        instanceFor('ws-sum', {
          status: 'completed',
          createdAt: '2026-05-27T00:03:00.000Z',
        }),
      );
      // Tombstoned + archived runs must be excluded from every count.
      const deleted = await repo.create(
        instanceFor('ws-sum', { status: 'running' }),
      );
      await repo.update(deleted.id, { deleted: true });
      const archived = await repo.create(
        instanceFor('ws-sum', { status: 'running' }),
      );
      await repo.update(archived.id, { archived: true });

      const open = await repo.summarizeRunsByWorkflow(
        'ws-sum',
        'supply-chain-review',
        false,
      );
      expect(open.active).toBe(2);
      expect(open.total).toBe(2);
      expect(open.latest.map((r) => r.id)).not.toContain(completed.id);

      const all = await repo.summarizeRunsByWorkflow(
        'ws-sum',
        'supply-chain-review',
        true,
      );
      expect(all.active).toBe(2);
      expect(all.total).toBe(3);
      // latest ordered createdAt desc, capped at 3 — newest is the completed run.
      expect(all.latest[0].id).toBe(completed.id);
      expect(all.latest.length).toBeLessThanOrEqual(3);
    });

    it('rejects create with invalid status', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-1');
      await expect(
        repo.create({
          ...instanceFor('ws-1'),
          status: 'bogus' as unknown as ProcessInstance['status'],
        }),
      ).rejects.toThrow();
    });
  });
}

contract('InMemoryProcessInstanceRepository', async () => {
  const repo = new InMemoryProcessInstanceRepository();
  return {
    repo,
    registerWorkspace: async () => {
      // in-memory has no FK constraint
    },
  };
});

describe.skipIf(skipPg)('PostgresProcessInstanceRepository (parity)', () => {
  const schemaName = `pinst_${randomBytes(8).toString('hex')}`;
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
      const sqlText = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
      await testClient.unsafe(sqlText);
    }
  });

  afterAll(async () => {
    if (testClient) await testClient.end();
    if (adminClient) {
      await adminClient.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
      await adminClient.end();
    }
  });

  contract('PostgresProcessInstanceRepository', async () => {
    const db = drizzle(testClient, { schema });
    await testClient.unsafe(
      `TRUNCATE TABLE ` +
        `"${schemaName}"."agent_events", ` +
        `"${schemaName}"."step_executions", ` +
        `"${schemaName}"."process_instances", ` +
        `"${schemaName}"."workspace_members", "${schemaName}"."workspaces" CASCADE`,
    );
    const repo = new PostgresProcessInstanceRepository(db);
    const nsRepo = new PostgresNamespaceRepository(db);
    return {
      repo,
      registerWorkspace: async (namespace) => {
        if (!(await nsRepo.getNamespace(namespace))) {
          await nsRepo.createNamespace({
            handle: namespace,
            type: 'organization',
            displayName: namespace,
            createdAt: '2026-05-27T00:00:00.000Z',
          });
        }
      },
    };
  });

  it('addAgentEvent + getAgentEvents ordered by sequence asc', async () => {
    const db = drizzle(testClient, { schema });
    const repo = new PostgresProcessInstanceRepository(db);
    const nsRepo = new PostgresNamespaceRepository(db);
    const ns = `ws-events-${randomBytes(4).toString('hex')}`;
    await nsRepo.createNamespace({
      handle: ns,
      type: 'organization',
      displayName: ns,
      createdAt: '2026-05-27T00:00:00.000Z',
    });
    const inst = await repo.create(instanceFor(ns));

    const events: AgentEvent[] = [
      {
        id: `evt-${randomUUID()}`,
        processInstanceId: inst.id,
        stepId: 'intake',
        type: 'status',
        payload: { state: 'started' },
        sequence: 2,
        timestamp: '2026-05-27T00:00:02.000Z',
      },
      {
        id: `evt-${randomUUID()}`,
        processInstanceId: inst.id,
        stepId: 'intake',
        type: 'status',
        payload: { state: 'completed' },
        sequence: 1,
        timestamp: '2026-05-27T00:00:01.000Z',
      },
      {
        id: `evt-${randomUUID()}`,
        processInstanceId: inst.id,
        stepId: 'other',
        type: 'annotation',
        payload: { note: 'x' },
        sequence: 0,
        timestamp: '2026-05-27T00:00:00.000Z',
      },
    ];
    for (const e of events) await repo.addAgentEvent(inst.id, e);

    const intakeOnly = await repo.getAgentEvents(inst.id, 'intake');
    expect(intakeOnly.map((e) => e.sequence)).toEqual([1, 2]);

    const all = await repo.getAgentEvents(inst.id);
    expect(all).toHaveLength(3);
    expect(all.map((e) => e.sequence)).toEqual([0, 1, 2]);
  });

  it('agent_events FK cascades when parent instance is deleted', async () => {
    const db = drizzle(testClient, { schema });
    const repo = new PostgresProcessInstanceRepository(db);
    const nsRepo = new PostgresNamespaceRepository(db);
    const ns = `ws-cascade-${randomBytes(4).toString('hex')}`;
    await nsRepo.createNamespace({
      handle: ns,
      type: 'organization',
      displayName: ns,
      createdAt: '2026-05-27T00:00:00.000Z',
    });
    const inst = await repo.create(instanceFor(ns));
    await repo.addAgentEvent(inst.id, {
      id: `evt-${randomUUID()}`,
      processInstanceId: inst.id,
      stepId: 'intake',
      type: 'status',
      payload: {},
      sequence: 0,
      timestamp: '2026-05-27T00:00:00.000Z',
    });
    await repo.addStepExecution(inst.id, stepExecutionFor(inst.id));

    // Hard delete the parent — both subtables must cascade.
    await testClient.unsafe(
      `DELETE FROM "${schemaName}"."process_instances" WHERE id = $1`,
      [inst.id],
    );
    const events = await repo.getAgentEvents(inst.id);
    const execs = await repo.getStepExecutions(inst.id);
    expect(events).toEqual([]);
    expect(execs).toEqual([]);
  });
});
