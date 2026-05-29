import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  InMemoryAgentRunRepository,
  buildAgentRun,
  buildAgentOutputEnvelope,
} from '@mediforce/platform-core';
import type {
  AgentRun,
  AgentRunRepository,
  ProcessInstance,
  ProcessInstanceRepository,
} from '@mediforce/platform-core';
import { PostgresAgentRunRepository } from '../repositories/agent-run-repository';
import { PostgresNamespaceRepository } from '../repositories/namespace-repository';
import * as schema from '../schema/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

/**
 * Stub ProcessInstanceRepository — only `getById` is invoked from the
 * agent-run parity contract. Returns a minimal-shape instance with the
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

function runFor(
  instanceId: string,
  overrides: Partial<AgentRun> = {},
): AgentRun {
  return buildAgentRun({
    id: randomUUID(),
    processInstanceId: instanceId,
    ...overrides,
  });
}

/**
 * Shared contract for AgentRunRepository (ADR-0001 L2 parity).
 * Both the in-memory double and Postgres backend MUST satisfy it.
 *
 * Factory returns `(repo, registerInstance)`: callers register
 * `(processInstanceId → namespace)` mappings before creating so both
 * backends can resolve the workspace.
 */
function contract(
  name: string,
  factory: () => Promise<{
    repo: AgentRunRepository;
    registerInstance: (id: string, namespace: string) => Promise<void>;
  }>,
) {
  describe(`${name} — AgentRunRepository contract`, () => {
    let repo: AgentRunRepository;
    let registerInstance: (id: string, namespace: string) => Promise<void>;

    beforeEach(async () => {
      ({ repo, registerInstance } = await factory());
    });

    it('create round-trips and preserves envelope fields', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      const run = runFor(instanceId, {
        envelope: buildAgentOutputEnvelope({
          confidence: 0.77,
          model: 'anthropic/claude-sonnet-4',
          duration_ms: 2400,
          tokenUsage: { inputTokens: 100, outputTokens: 200 },
          reasoning_summary: 'analysis done',
          result: { ok: true },
        }),
      });
      const created = await repo.create(run);
      expect(created.id).toBe(run.id);
      expect(created.envelope?.confidence).toBe(0.77);
      expect(created.envelope?.model).toBe('anthropic/claude-sonnet-4');
      expect(created.envelope?.duration_ms).toBe(2400);
      expect(created.envelope?.tokenUsage).toEqual({ inputTokens: 100, outputTokens: 200 });
      expect(created.envelope?.reasoning_summary).toBe('analysis done');
      expect(created.envelope?.result).toEqual({ ok: true });

      const fetched = await repo.getById(run.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.envelope?.confidence).toBe(0.77);
      expect(fetched?.envelope?.result).toEqual({ ok: true });
    });

    it('create supports a null envelope (e.g. running status)', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      const run = runFor(instanceId, {
        status: 'running',
        envelope: null,
        completedAt: null,
      });
      const created = await repo.create(run);
      expect(created.envelope).toBeNull();
      expect(created.completedAt).toBeNull();

      const fetched = await repo.getById(run.id);
      expect(fetched?.envelope).toBeNull();
    });

    it('getById returns null for unknown id', async () => {
      const missing = await repo.getById(randomUUID());
      expect(missing).toBeNull();
    });

    it('getByInstanceId returns matching runs in DESC order by startedAt', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      await repo.create(runFor(instanceId, { startedAt: '2026-01-01T08:00:00.000Z' }));
      await repo.create(runFor(instanceId, { startedAt: '2026-01-01T12:00:00.000Z' }));
      await repo.create(runFor(instanceId, { startedAt: '2026-01-01T10:00:00.000Z' }));

      // Sibling instance — should not leak in.
      const other = randomUUID();
      await registerInstance(other, 'ws-1');
      await repo.create(runFor(other));

      const results = await repo.getByInstanceId(instanceId);
      expect(results).toHaveLength(3);
      expect(results.map((r) => r.startedAt)).toEqual([
        '2026-01-01T12:00:00.000Z',
        '2026-01-01T10:00:00.000Z',
        '2026-01-01T08:00:00.000Z',
      ]);
    });

    it('getByIdInNamespaces honors the allowed workspace list', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      const run = runFor(instanceId);
      await repo.create(run);

      const allowed = await repo.getByIdInNamespaces(run.id, ['ws-1']);
      expect(allowed?.id).toBe(run.id);

      const denied = await repo.getByIdInNamespaces(run.id, ['ws-2']);
      expect(denied).toBeNull();

      const empty = await repo.getByIdInNamespaces(run.id, []);
      expect(empty).toBeNull();
    });

    it('getByInstanceIdInNamespaces honors the allowed workspace list', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      await repo.create(runFor(instanceId));
      await repo.create(runFor(instanceId));

      const allowed = await repo.getByInstanceIdInNamespaces(instanceId, ['ws-1']);
      expect(allowed).toHaveLength(2);

      const denied = await repo.getByInstanceIdInNamespaces(instanceId, ['ws-2']);
      expect(denied).toHaveLength(0);

      const empty = await repo.getByInstanceIdInNamespaces(instanceId, []);
      expect(empty).toHaveLength(0);
    });

    it('getAll returns DESC by startedAt and respects the limit', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      for (const ts of [
        '2026-01-01T08:00:00.000Z',
        '2026-01-01T09:00:00.000Z',
        '2026-01-01T10:00:00.000Z',
        '2026-01-01T11:00:00.000Z',
      ]) {
        await repo.create(runFor(instanceId, { startedAt: ts }));
      }

      const top2 = await repo.getAll(2);
      expect(top2).toHaveLength(2);
      expect(top2[0].startedAt).toBe('2026-01-01T11:00:00.000Z');
      expect(top2[1].startedAt).toBe('2026-01-01T10:00:00.000Z');
    });

    it('rejects create with invalid status', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      await expect(
        repo.create({
          ...runFor(instanceId),
          status: 'bogus',
        } as unknown as AgentRun),
      ).rejects.toThrow();
    });
  });
}

contract('InMemoryAgentRunRepository', async () => {
  const nsByInstance = new Map<string, string>();
  const parents = new StubProcessInstanceRepository(nsByInstance);
  const repo = new InMemoryAgentRunRepository(parents);
  return {
    repo,
    registerInstance: async (id, namespace) => {
      nsByInstance.set(id, namespace);
    },
  };
});

describe.skipIf(skipPg)('PostgresAgentRunRepository (parity)', () => {
  const schemaName = `agent_run_${randomBytes(8).toString('hex')}`;
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

  contract('PostgresAgentRunRepository', async () => {
    const db = drizzle(testClient, { schema });
    await testClient.unsafe(
      `TRUNCATE TABLE "${schemaName}"."agent_runs", ` +
        `"${schemaName}"."process_instances", ` +
        `"${schemaName}"."workspace_members", "${schemaName}"."workspaces" CASCADE`,
    );
    const nsByInstance = new Map<string, string>();
    const parents = new StubProcessInstanceRepository(nsByInstance);
    const repo = new PostgresAgentRunRepository(db, parents);
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
        // Parent process_instances row required by FK from agent_runs.
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
