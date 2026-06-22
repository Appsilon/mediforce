import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InMemoryAgentEventRepository, InMemoryProcessInstanceRepository } from '@mediforce/platform-core';
import type {
  AgentEvent,
  AgentEventRepository,
  ProcessInstance,
  ProcessInstanceRepository,
} from '@mediforce/platform-core';
import { PostgresAgentEventRepository } from '../repositories/agent-event-repository';
import { PostgresProcessInstanceRepository } from '../repositories/process-instance-repository';
import { PostgresNamespaceRepository } from '../repositories/namespace-repository';
import * as schema from '../schema/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

function instanceFor(namespace: string, overrides: Partial<ProcessInstance> = {}): ProcessInstance {
  const now = '2026-05-30T00:00:00.000Z';
  return {
    id: `inst-${randomUUID()}`,
    definitionName: 'supply-chain-review',
    definitionVersion: '1.0.0',
    status: 'running',
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

function eventFor(instanceId: string, sequence: number, overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: `evt-${randomUUID()}`,
    processInstanceId: instanceId,
    stepId: 'intake',
    type: 'status',
    payload: { state: `seq-${sequence}` },
    sequence,
    timestamp: '2026-05-30T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Shared contract for AgentEventRepository (ADR-0001 L2 parity). The Postgres
 * backend MUST match the in-memory double on ordering, the `afterSequence`
 * cursor, the step filter, and namespace scoping.
 *
 * `factory` returns the read repo under test, a `seed(event)` that writes
 * through that backend's write path, and `registerInstance` so the Postgres
 * backend can satisfy the workspaces + process_instances FKs.
 */
function contract(
  name: string,
  factory: () => Promise<{
    repo: AgentEventRepository;
    seed: (event: AgentEvent) => Promise<void>;
    registerInstance: (instance: ProcessInstance) => Promise<void>;
  }>,
) {
  describe(`${name} — AgentEventRepository contract`, () => {
    const namespace = 'ws-events';

    it('listByInstance returns events in sequence order', async () => {
      const { repo, seed, registerInstance } = await factory();
      const inst = instanceFor(namespace);
      await registerInstance(inst);
      await seed(eventFor(inst.id, 2));
      await seed(eventFor(inst.id, 1));
      await seed(eventFor(inst.id, 3));

      const events = await repo.listByInstance(inst.id);
      expect(events.map((e) => e.sequence)).toEqual([1, 2, 3]);
    });

    it('afterSequence returns only the delta', async () => {
      const { repo, seed, registerInstance } = await factory();
      const inst = instanceFor(namespace);
      await registerInstance(inst);
      await seed(eventFor(inst.id, 1));
      await seed(eventFor(inst.id, 2));
      await seed(eventFor(inst.id, 3));

      const events = await repo.listByInstance(inst.id, 1);
      expect(events.map((e) => e.sequence)).toEqual([2, 3]);
    });

    it('listByStep filters by stepId and applies afterSequence', async () => {
      const { repo, seed, registerInstance } = await factory();
      const inst = instanceFor(namespace);
      await registerInstance(inst);
      await seed(eventFor(inst.id, 1, { stepId: 'a' }));
      await seed(eventFor(inst.id, 2, { stepId: 'b' }));
      await seed(eventFor(inst.id, 3, { stepId: 'a' }));

      const all = await repo.listByStep(inst.id, 'a');
      expect(all.map((e) => e.sequence)).toEqual([1, 3]);

      const delta = await repo.listByStep(inst.id, 'a', 1);
      expect(delta.map((e) => e.sequence)).toEqual([3]);
    });

    it('listByInstanceInNamespaces honors the allowed list', async () => {
      const { repo, seed, registerInstance } = await factory();
      const inst = instanceFor(namespace);
      await registerInstance(inst);
      await seed(eventFor(inst.id, 1));

      const allowed = await repo.listByInstanceInNamespaces(inst.id, [namespace]);
      const denied = await repo.listByInstanceInNamespaces(inst.id, ['ws-other']);
      const empty = await repo.listByInstanceInNamespaces(inst.id, []);

      expect(allowed.map((e) => e.sequence)).toEqual([1]);
      expect(denied).toEqual([]);
      expect(empty).toEqual([]);
    });

    it('listByStepInNamespaces honors the allowed list', async () => {
      const { repo, seed, registerInstance } = await factory();
      const inst = instanceFor(namespace);
      await registerInstance(inst);
      await seed(eventFor(inst.id, 1, { stepId: 'a' }));

      const allowed = await repo.listByStepInNamespaces(inst.id, 'a', [namespace]);
      const denied = await repo.listByStepInNamespaces(inst.id, 'a', ['ws-other']);

      expect(allowed.map((e) => e.sequence)).toEqual([1]);
      expect(denied).toEqual([]);
    });

    it('listByInstance scopes to the requested instance', async () => {
      const { repo, seed, registerInstance } = await factory();
      const a = instanceFor(namespace);
      const b = instanceFor(namespace);
      await registerInstance(a);
      await registerInstance(b);
      await seed(eventFor(a.id, 1));
      await seed(eventFor(b.id, 1));

      const events = await repo.listByInstance(a.id);
      expect(events).toHaveLength(1);
      expect(events[0]?.processInstanceId).toBe(a.id);
    });
  });
}

contract('InMemoryAgentEventRepository', async () => {
  const parents: ProcessInstanceRepository = new InMemoryProcessInstanceRepository();
  const repo = new InMemoryAgentEventRepository(parents);
  return {
    repo,
    seed: async (event) => {
      await repo.append(event);
    },
    registerInstance: async (instance) => {
      await parents.create(instance);
    },
  };
});

describe.skipIf(skipPg)('PostgresAgentEventRepository (parity)', () => {
  const schemaName = `aevt_${randomBytes(8).toString('hex')}`;
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

  contract('PostgresAgentEventRepository', async () => {
    const db = drizzle(testClient, { schema });
    await testClient.unsafe(
      `TRUNCATE TABLE ` +
        `"${schemaName}"."agent_events", ` +
        `"${schemaName}"."step_executions", ` +
        `"${schemaName}"."process_instances", ` +
        `"${schemaName}"."workspace_members", "${schemaName}"."workspaces" CASCADE`,
    );
    const instanceRepo = new PostgresProcessInstanceRepository(db);
    const nsRepo = new PostgresNamespaceRepository(db);
    const repo = new PostgresAgentEventRepository(instanceRepo);
    return {
      repo,
      seed: async (event) => {
        await instanceRepo.addAgentEvent(event.processInstanceId, event);
      },
      registerInstance: async (instance) => {
        if (!(await nsRepo.getNamespace(instance.namespace as string))) {
          await nsRepo.createNamespace({
            handle: instance.namespace as string,
            type: 'organization',
            displayName: instance.namespace as string,
            createdAt: '2026-05-30T00:00:00.000Z',
          });
        }
        await instanceRepo.create(instance);
      },
    };
  });
});
