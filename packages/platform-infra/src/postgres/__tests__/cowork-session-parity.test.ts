import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InMemoryCoworkSessionRepository } from '@mediforce/platform-core';
import type {
  ConversationTurn,
  CoworkSession,
  CoworkSessionRepository,
  ProcessInstance,
  ProcessInstanceRepository,
} from '@mediforce/platform-core';
import { PostgresCoworkSessionRepository } from '../repositories/cowork-session-repository';
import { PostgresNamespaceRepository } from '../repositories/namespace-repository';
import * as schema from '../schema/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

/**
 * Stub ProcessInstanceRepository — only `getById` is invoked from the
 * cowork-session parity contract. Returns a minimal-shape instance with
 * the namespace mapping registered in `nsByInstance`.
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

  // Unused by the parity contract — throw if hit.
  async create(): Promise<ProcessInstance> {
    throw new Error('stub');
  }
  async getByIdInNamespaces(): Promise<ProcessInstance | null> {
    throw new Error('stub');
  }
  async listAll(): Promise<ProcessInstance[]> {
    throw new Error('stub');
  }
  async listInNamespaces(): Promise<ProcessInstance[]> {
    throw new Error('stub');
  }
  async listDefinitionNames(): Promise<never> {
    throw new Error('stub');
  }
  async getByStatusAll(): Promise<ProcessInstance[]> {
    throw new Error('stub');
  }
  async getByStatusInNamespaces(): Promise<ProcessInstance[]> {
    throw new Error('stub');
  }
  async update(): Promise<void> {
    throw new Error('stub');
  }
  async getByDefinition(): Promise<ProcessInstance[]> {
    throw new Error('stub');
  }
  async getLastCompletedByDefinitionName(): Promise<ProcessInstance | null> {
    throw new Error('stub');
  }
  async addStepExecution(): Promise<never> {
    throw new Error('stub');
  }
  async getStepExecutions(): Promise<never[]> {
    throw new Error('stub');
  }
  async getLatestStepExecution(): Promise<null> {
    throw new Error('stub');
  }
  async updateStepExecution(): Promise<void> {
    throw new Error('stub');
  }
  async getIdsByDefinitionName(): Promise<string[]> {
    throw new Error('stub');
  }
  async setDeletedByDefinitionName(): Promise<void> {
    throw new Error('stub');
  }
  async summarizeRunsByWorkflow(): Promise<never> {
    throw new Error('stub');
  }
}

function sessionFor(instanceId: string, overrides: Partial<CoworkSession> = {}): CoworkSession {
  const now = '2026-05-27T00:00:00.000Z';
  return {
    id: `sess-${randomUUID()}`,
    processInstanceId: instanceId,
    stepId: 'step-design',
    assignedRole: 'designer',
    assignedUserId: null,
    status: 'active',
    agent: 'chat',
    model: 'claude-sonnet-4',
    systemPrompt: 'Help build the artifact',
    outputSchema: { type: 'object' },
    voiceConfig: null,
    artifact: null,
    validationResult: null,
    presentation: null,
    mcpServers: null,
    turns: [],
    createdAt: now,
    updatedAt: now,
    finalizedAt: null,
    ...overrides,
  };
}

function humanTurnFor(id: string, content: string): ConversationTurn {
  return {
    id,
    role: 'human',
    content,
    timestamp: '2026-05-27T00:00:01.000Z',
    artifactDelta: null,
  };
}

function toolTurnFor(id: string, status: 'running' | 'success' | 'error'): ConversationTurn {
  return {
    id,
    role: 'tool',
    content: `tool call ${id}`,
    timestamp: '2026-05-27T00:00:02.000Z',
    artifactDelta: null,
    toolName: 'srv__do_thing',
    toolArgs: { x: 1 },
    toolStatus: status,
    serverName: 'srv',
    ...(status !== 'running' ? { toolResult: 'ok' } : {}),
  };
}

/**
 * Shared contract for CoworkSessionRepository (ADR-0001 L2 parity).
 * Both the in-memory double and Postgres backend MUST satisfy it.
 */
function contract(
  name: string,
  factory: () => Promise<{
    repo: CoworkSessionRepository;
    registerInstance: (id: string, namespace: string) => Promise<void>;
  }>,
) {
  describe(`${name} — CoworkSessionRepository contract`, () => {
    let repo: CoworkSessionRepository;
    let registerInstance: (id: string, namespace: string) => Promise<void>;

    beforeEach(async () => {
      ({ repo, registerInstance } = await factory());
    });

    it('create round-trips and preserves all session fields', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      const session = sessionFor(instanceId, {
        systemPrompt: 'because reasons',
        outputSchema: { type: 'object', required: ['name'] },
      });
      const created = await repo.create(session);
      expect(created.id).toBe(session.id);
      expect(created.systemPrompt).toBe('because reasons');
      expect(created.outputSchema).toEqual({ type: 'object', required: ['name'] });
      expect(created.turns).toEqual([]);

      const fetched = await repo.getById(session.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.assignedRole).toBe('designer');
      expect(fetched?.agent).toBe('chat');
    });

    it('getById returns null for unknown id', async () => {
      expect(await repo.getById(`sess-missing-${randomUUID()}`)).toBeNull();
    });

    it('addTurn appends in order; turns survive round-trip', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      const session = await repo.create(sessionFor(instanceId));

      await repo.addTurn(session.id, humanTurnFor('t-1', 'hello'));
      await repo.addTurn(session.id, humanTurnFor('t-2', 'world'));
      await repo.addTurn(session.id, toolTurnFor('t-3', 'running'));

      const fetched = await repo.getById(session.id);
      expect(fetched!.turns).toHaveLength(3);
      expect(fetched!.turns.map((t) => t.id)).toEqual(['t-1', 't-2', 't-3']);
      expect(fetched!.turns[0].content).toBe('hello');
      expect(fetched!.turns[2].role).toBe('tool');
    });

    it('updateTurn transitions a tool turn from running to success', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      const session = await repo.create(sessionFor(instanceId));
      await repo.addTurn(session.id, toolTurnFor('t-tool', 'running'));

      const updated = await repo.updateTurn(session.id, 't-tool', {
        toolStatus: 'success',
        toolResult: 'done',
      } as Partial<ConversationTurn>);

      const tool = updated.turns.find((t) => t.id === 't-tool');
      expect(tool?.role).toBe('tool');
      if (tool?.role === 'tool') {
        expect(tool.toolStatus).toBe('success');
        expect(tool.toolResult).toBe('done');
      }
    });

    it('updateTurn throws on unknown turn id', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      const session = await repo.create(sessionFor(instanceId));
      await expect(repo.updateTurn(session.id, 'no-such-turn', { content: 'x' })).rejects.toThrow();
    });

    it('findMostRecentActive returns null when no active session', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      expect(await repo.findMostRecentActive(instanceId)).toBeNull();
    });

    it('findMostRecentActive picks newest active session for an instance', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      await repo.create(
        sessionFor(instanceId, { createdAt: '2026-05-27T00:00:00.000Z', updatedAt: '2026-05-27T00:00:00.000Z' }),
      );
      const newer = await repo.create(
        sessionFor(instanceId, { createdAt: '2026-05-27T00:01:00.000Z', updatedAt: '2026-05-27T00:01:00.000Z' }),
      );
      // A finalized one — must be ignored.
      const finalized = await repo.create(
        sessionFor(instanceId, { createdAt: '2026-05-27T00:02:00.000Z', updatedAt: '2026-05-27T00:02:00.000Z' }),
      );
      await repo.finalize(finalized.id, { result: 'done' });

      const active = await repo.findMostRecentActive(instanceId);
      expect(active?.id).toBe(newer.id);
    });

    it('finalize sets status + artifact + finalizedAt', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      const session = await repo.create(sessionFor(instanceId));

      const finalized = await repo.finalize(session.id, { final: 'artifact' });
      expect(finalized.status).toBe('finalized');
      expect(finalized.artifact).toEqual({ final: 'artifact' });
      expect(finalized.finalizedAt).not.toBeNull();
    });

    it('abandon sets status=abandoned', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      const session = await repo.create(sessionFor(instanceId));
      const abandoned = await repo.abandon(session.id);
      expect(abandoned.status).toBe('abandoned');
    });

    it('updateArtifact replaces artifact without changing status', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      const session = await repo.create(sessionFor(instanceId));
      const updated = await repo.updateArtifact(session.id, { draft: 1 });
      expect(updated.artifact).toEqual({ draft: 1 });
      expect(updated.status).toBe('active');
    });

    it('getByIdInNamespaces honors the allowed workspace list', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      const session = await repo.create(sessionFor(instanceId));

      const allowed = await repo.getByIdInNamespaces(session.id, ['ws-1']);
      expect(allowed?.id).toBe(session.id);

      const denied = await repo.getByIdInNamespaces(session.id, ['ws-2']);
      expect(denied).toBeNull();

      const empty = await repo.getByIdInNamespaces(session.id, []);
      expect(empty).toBeNull();
    });

    it('findMostRecentActiveInNamespaces honors the allowed workspace list', async () => {
      const inst1 = randomUUID();
      const inst2 = randomUUID();
      await registerInstance(inst1, 'ws-alpha');
      await registerInstance(inst2, 'ws-beta');
      await repo.create(sessionFor(inst1));
      await repo.create(sessionFor(inst2));

      const alpha = await repo.findMostRecentActiveInNamespaces(inst1, ['ws-alpha']);
      expect(alpha?.processInstanceId).toBe(inst1);

      const denied = await repo.findMostRecentActiveInNamespaces(inst1, ['ws-beta']);
      expect(denied).toBeNull();

      const empty = await repo.findMostRecentActiveInNamespaces(inst1, []);
      expect(empty).toBeNull();
    });

    it('getByInstanceId returns sessions for a single instance only', async () => {
      const inst1 = randomUUID();
      const inst2 = randomUUID();
      await registerInstance(inst1, 'ws-1');
      await registerInstance(inst2, 'ws-1');
      await repo.create(sessionFor(inst1));
      await repo.create(sessionFor(inst1));
      await repo.create(sessionFor(inst2));

      const rows = await repo.getByInstanceId(inst1);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.processInstanceId === inst1)).toBe(true);
    });

    it('listAll returns every session with turns rehydrated', async () => {
      const inst1 = randomUUID();
      const inst2 = randomUUID();
      await registerInstance(inst1, 'ws-alpha');
      await registerInstance(inst2, 'ws-beta');
      const older = await repo.create(sessionFor(inst1, { createdAt: '2026-05-27T00:00:00.000Z' }));
      const newer = await repo.create(sessionFor(inst2, { createdAt: '2026-05-27T00:05:00.000Z' }));
      await repo.addTurn(newer.id, humanTurnFor('t-1', 'hi'));

      const all = await repo.listAll();
      const ids = all.map((s) => s.id);
      expect(ids).toContain(older.id);
      expect(ids).toContain(newer.id);
      // createdAt DESC — newest first on both backends.
      expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
      expect(all.find((s) => s.id === newer.id)?.turns).toHaveLength(1);
    });

    it('listInNamespaces filters by workspace; empty allowed => []', async () => {
      const inst1 = randomUUID();
      const inst2 = randomUUID();
      await registerInstance(inst1, 'ws-alpha');
      await registerInstance(inst2, 'ws-beta');
      const alpha = await repo.create(sessionFor(inst1));
      const beta = await repo.create(sessionFor(inst2));

      const onlyAlpha = await repo.listInNamespaces(['ws-alpha']);
      const ids = onlyAlpha.map((s) => s.id);
      expect(ids).toContain(alpha.id);
      expect(ids).not.toContain(beta.id);

      expect(await repo.listInNamespaces([])).toEqual([]);
    });

    it('listByRoleAll filters by assignedRole', async () => {
      const inst1 = randomUUID();
      const inst2 = randomUUID();
      await registerInstance(inst1, 'ws-1');
      await registerInstance(inst2, 'ws-1');
      const designer = await repo.create(sessionFor(inst1, { assignedRole: 'designer' }));
      const reviewer = await repo.create(sessionFor(inst2, { assignedRole: 'reviewer' }));

      const designers = await repo.listByRoleAll('designer');
      const ids = designers.map((s) => s.id);
      expect(ids).toContain(designer.id);
      expect(ids).not.toContain(reviewer.id);
    });

    it('listByRoleInNamespaces intersects role + workspace; empty => []', async () => {
      const inst1 = randomUUID();
      const inst2 = randomUUID();
      const inst3 = randomUUID();
      await registerInstance(inst1, 'ws-alpha');
      await registerInstance(inst2, 'ws-beta');
      await registerInstance(inst3, 'ws-alpha');
      const match = await repo.create(sessionFor(inst1, { assignedRole: 'designer' }));
      const wrongNs = await repo.create(sessionFor(inst2, { assignedRole: 'designer' }));
      const wrongRole = await repo.create(sessionFor(inst3, { assignedRole: 'reviewer' }));

      const scoped = await repo.listByRoleInNamespaces('designer', ['ws-alpha']);
      const ids = scoped.map((s) => s.id);
      expect(ids).toContain(match.id);
      expect(ids).not.toContain(wrongNs.id);
      expect(ids).not.toContain(wrongRole.id);

      expect(await repo.listByRoleInNamespaces('designer', [])).toEqual([]);
    });

    it('rejects create with invalid status', async () => {
      const instanceId = randomUUID();
      await registerInstance(instanceId, 'ws-1');
      await expect(
        repo.create({
          ...sessionFor(instanceId),
          status: 'bogus',
        } as unknown as CoworkSession),
      ).rejects.toThrow();
    });
  });
}

contract('InMemoryCoworkSessionRepository', async () => {
  const nsByInstance = new Map<string, string>();
  const parents = new StubProcessInstanceRepository(nsByInstance);
  const repo = new InMemoryCoworkSessionRepository(parents);
  return {
    repo,
    registerInstance: async (id, namespace) => {
      nsByInstance.set(id, namespace);
    },
  };
});

describe.skipIf(skipPg)('PostgresCoworkSessionRepository (parity)', () => {
  const schemaName = `cowork_${randomBytes(8).toString('hex')}`;
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

  contract('PostgresCoworkSessionRepository', async () => {
    const db = drizzle(testClient, { schema });
    await testClient.unsafe(
      `TRUNCATE TABLE "${schemaName}"."cowork_turns", ` +
        `"${schemaName}"."cowork_sessions", ` +
        `"${schemaName}"."process_instances", ` +
        `"${schemaName}"."workspace_members", "${schemaName}"."workspaces" CASCADE`,
    );
    const nsByInstance = new Map<string, string>();
    const parents = new StubProcessInstanceRepository(nsByInstance);
    const repo = new PostgresCoworkSessionRepository(db, parents);
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
        // Parent process_instances row required by FK from cowork_sessions.
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

  it('cowork_turns unique (session_id, idx) constraint blocks duplicates', async () => {
    const db = drizzle(testClient, { schema });
    const nsByInstance = new Map<string, string>();
    const parents = new StubProcessInstanceRepository(nsByInstance);
    const repo = new PostgresCoworkSessionRepository(db, parents);
    const nsRepo = new PostgresNamespaceRepository(db);

    const ns = `ws-unique-${randomBytes(4).toString('hex')}`;
    if (!(await nsRepo.getNamespace(ns))) {
      await nsRepo.createNamespace({
        handle: ns,
        type: 'organization',
        displayName: ns,
        createdAt: '2026-05-27T00:00:00.000Z',
      });
    }
    const instanceId = randomUUID();
    nsByInstance.set(instanceId, ns);
    // Parent process_instances row required by FK from cowork_sessions.
    await testClient.unsafe(
      `INSERT INTO "${schemaName}"."process_instances" ` +
        `(id, workspace, definition_name, definition_version, status, ` +
        `variables, trigger_type, trigger_payload) ` +
        `VALUES ($1, $2, 'stub-def', '1.0.0', 'completed', '{}'::jsonb, 'manual', '{}'::jsonb) ` +
        `ON CONFLICT (id) DO NOTHING`,
      [instanceId, ns],
    );
    const session = await repo.create(sessionFor(instanceId));

    // Directly insert two turns at the same idx to verify the constraint.
    await testClient.unsafe(
      `INSERT INTO "${schemaName}"."cowork_turns" ` +
        `(id, session_id, idx, role, content, timestamp) ` +
        `VALUES ('dup-1', $1, 0, 'human', 'a', now())`,
      [session.id],
    );
    await expect(
      testClient.unsafe(
        `INSERT INTO "${schemaName}"."cowork_turns" ` +
          `(id, session_id, idx, role, content, timestamp) ` +
          `VALUES ('dup-2', $1, 0, 'human', 'b', now())`,
        [session.id],
      ),
    ).rejects.toThrow();
  });
});
