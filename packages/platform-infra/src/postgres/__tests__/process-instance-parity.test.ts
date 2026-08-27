import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InMemoryProcessInstanceRepository, getWorkflowStatus } from '@mediforce/platform-core';
import type {
  AgentEvent,
  ProcessInstance,
  ProcessInstanceRepository,
  StepExecution,
  WorkflowDisplayStatus,
} from '@mediforce/platform-core';

const ALL_DISPLAY_STATUSES: readonly WorkflowDisplayStatus[] = [
  'in_progress',
  'waiting_for_human',
  'error',
  'cancelled',
  'completed',
];
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

    // ADR-0012: `triggerPayload` is the validated declared input and
    // `triggerContext` the transport metadata. They live in separate columns and
    // must round-trip independently — a dropped mapping in `toInstance`/`create`
    // would silently strip `${triggerContext.*}` from every run.
    it('round-trips triggerContext alongside triggerPayload', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-1');
      const instance = instanceFor('ws-1', {
        triggerType: 'webhook',
        triggerPayload: { summary: { nested: true } },
        triggerContext: {
          headers: { 'x-trace': 'abc' },
          query: {},
          method: 'POST',
          path: '/intake',
        },
      });
      await repo.create(instance);

      const fetched = await repo.getById(instance.id);
      expect(fetched?.triggerPayload).toEqual({ summary: { nested: true } });
      expect(fetched?.triggerContext).toEqual({
        headers: { 'x-trace': 'abc' },
        query: {},
        method: 'POST',
        path: '/intake',
      });
    });

    it('leaves triggerContext undefined for a firing with no transport', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-1');
      const instance = instanceFor('ws-1', { triggerType: 'manual' });
      await repo.create(instance);

      const fetched = await repo.getById(instance.id);
      expect(fetched?.triggerContext).toBeUndefined();
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

    it('getDefinitionPins projects the pin for many runs in one read', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-1');
      await registerWorkspace('ws-2');
      const mine = await repo.create(
        instanceFor('ws-1', { definitionName: 'vendor-review', definitionVersion: '3' }),
      );
      const other = await repo.create(instanceFor('ws-2'));

      const pins = await repo.getDefinitionPinsAll([mine.id, other.id, 'inst-missing']);

      // The missing id is simply absent — the gate decides what that means.
      expect(pins.map((pin) => pin.id).sort()).toEqual([mine.id, other.id].sort());
      const pinned = pins.find((pin) => pin.id === mine.id);
      expect(pinned).toMatchObject({
        namespace: 'ws-1',
        definitionName: 'vendor-review',
        definitionVersion: '3',
        createdAt: mine.createdAt,
      });
    });

    it('getDefinitionPinsInNamespaces drops runs outside the allowed set', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-1');
      await registerWorkspace('ws-2');
      const mine = await repo.create(instanceFor('ws-1'));
      const other = await repo.create(instanceFor('ws-2'));

      const allowed = await repo.getDefinitionPinsInNamespaces([mine.id, other.id], ['ws-1']);
      expect(allowed.map((pin) => pin.id)).toEqual([mine.id]);

      const none = await repo.getDefinitionPinsInNamespaces([mine.id, other.id], []);
      expect(none).toEqual([]);
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

    it('getIdsByDefinitionName / setDeletedByDefinitionName stay inside one workspace', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-mine');
      await registerWorkspace('ws-theirs');
      const mine = await repo.create(
        instanceFor('ws-mine', { definitionName: 'shared-name' }),
      );
      const theirs = await repo.create(
        instanceFor('ws-theirs', { definitionName: 'shared-name' }),
      );

      expect(await repo.getIdsByDefinitionName('ws-mine', 'shared-name')).toEqual([mine.id]);

      await repo.setDeletedByDefinitionName('ws-mine', 'shared-name', true);

      // Workflow names are unique per workspace, not globally — the cascade
      // behind a workflow delete must not tombstone a namesake elsewhere.
      expect((await repo.getById(mine.id))?.deleted).toBe(true);
      expect((await repo.getById(theirs.id))?.deleted).toBe(false);
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

    it('listPage returns newest-first pages with a working cursor', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-1');
      const created = [];
      for (let i = 0; i < 3; i++) {
        created.push(
          await repo.create(
            instanceFor('ws-1', { createdAt: `2026-01-0${i + 1}T00:00:00.000Z` }),
          ),
        );
      }

      const page1 = await repo.listPage({ namespace: 'ws-1', limit: 2 });
      expect(page1.items.map((r) => r.id)).toEqual([created[2].id, created[1].id]);
      expect(page1.nextCursor).toBeDefined();

      const page2 = await repo.listPage({
        namespace: 'ws-1',
        limit: 2,
        cursor: page1.nextCursor,
      });
      expect(page2.items.map((r) => r.id)).toEqual([created[0].id]);
      expect(page2.nextCursor).toBeUndefined();
    });

    it('listPage excludes archived by default, includes with archived: true', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-1');
      const active = await repo.create(instanceFor('ws-1', { archived: false }));
      const archived = await repo.create(instanceFor('ws-1', { archived: true }));

      const withoutArchived = await repo.listPage({ namespace: 'ws-1', limit: 20 });
      expect(withoutArchived.items.map((r) => r.id)).toEqual([active.id]);

      const withArchived = await repo.listPage({ namespace: 'ws-1', limit: 20, archived: true });
      expect(withArchived.items.map((r) => r.id).sort()).toEqual(
        [active.id, archived.id].sort(),
      );
    });

    // Exhaustive parity check: for every real (status, pauseReason, error)
    // combination getWorkflowStatus branches on, the SQL `displayStatus`
    // filter/aggregation (hand-ported in process-instance-repository.ts's
    // displayStatusConditions) must bucket it identically to the JS
    // function. This is the test that actually catches drift between the
    // two — everything else here just exercises pagination mechanics.
    const DISPLAY_STATUS_FIXTURES: Array<{
      label: string;
      overrides: Partial<ProcessInstance>;
    }> = [
      { label: 'completed', overrides: { status: 'completed' } },
      { label: 'running', overrides: { status: 'running' } },
      { label: 'created', overrides: { status: 'created' } },
      {
        label: 'paused/waiting_for_timer',
        overrides: { status: 'paused', pauseReason: 'waiting_for_timer' },
      },
      {
        label: 'paused/waiting_for_human',
        overrides: { status: 'paused', pauseReason: 'waiting_for_human' },
      },
      {
        label: 'paused/awaiting_agent_approval',
        overrides: { status: 'paused', pauseReason: 'awaiting_agent_approval' },
      },
      {
        label: 'paused/cowork_in_progress',
        overrides: { status: 'paused', pauseReason: 'cowork_in_progress' },
      },
      {
        label: 'paused/agent_escalated',
        overrides: { status: 'paused', pauseReason: 'agent_escalated' },
      },
      {
        label: 'paused/agent_paused',
        overrides: { status: 'paused', pauseReason: 'agent_paused' },
      },
      {
        label: 'paused/missing_env',
        overrides: { status: 'paused', pauseReason: 'missing_env' },
      },
      {
        label: 'paused/step_failure',
        overrides: { status: 'paused', pauseReason: 'step_failure' },
      },
      {
        label: 'paused/routing_error',
        overrides: { status: 'paused', pauseReason: 'routing_error' },
      },
      {
        label: 'paused/max_iterations_exceeded',
        overrides: { status: 'paused', pauseReason: 'max_iterations_exceeded' },
      },
      { label: 'paused/null-reason', overrides: { status: 'paused', pauseReason: null } },
      {
        label: 'paused/unrecognized-reason',
        overrides: { status: 'paused', pauseReason: 'some_future_reason' },
      },
      {
        label: 'failed/cancelled',
        overrides: { status: 'failed', error: 'Cancelled by user' },
      },
      { label: 'failed/other-error', overrides: { status: 'failed', error: 'Boom' } },
      { label: 'failed/null-error', overrides: { status: 'failed', error: null } },
    ];

    it.each(DISPLAY_STATUS_FIXTURES)(
      'listPage displayStatus filter matches getWorkflowStatus for $label',
      async ({ overrides }) => {
        const { repo, registerWorkspace } = await factory();
        await registerWorkspace('ws-1');
        const instance = await repo.create(instanceFor('ws-1', overrides));
        const expectedBucket = getWorkflowStatus(instance).displayStatus;

        const matching = await repo.listPage({
          namespace: 'ws-1',
          limit: 20,
          displayStatus: expectedBucket,
        });
        expect(matching.items.map((r) => r.id)).toContain(instance.id);

        for (const bucket of ALL_DISPLAY_STATUSES) {
          if (bucket === expectedBucket) continue;
          const nonMatching = await repo.listPage({
            namespace: 'ws-1',
            limit: 20,
            displayStatus: bucket,
          });
          expect(nonMatching.items.map((r) => r.id)).not.toContain(instance.id);
        }
      },
    );

    it('countByDisplayStatus tallies each bucket to match getWorkflowStatus, in one grouped query', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-1');
      const expected: Record<string, number> = {
        in_progress: 0,
        waiting_for_human: 0,
        error: 0,
        cancelled: 0,
        completed: 0,
      };
      for (const { overrides } of DISPLAY_STATUS_FIXTURES) {
        const instance = await repo.create(instanceFor('ws-1', overrides));
        expected[getWorkflowStatus(instance).displayStatus]++;
      }

      const counts = await repo.countByDisplayStatus({ namespace: 'ws-1' });
      expect(counts).toEqual(expected);
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
