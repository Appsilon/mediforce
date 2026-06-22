import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentDefinitionRepository, CreateAgentDefinitionInput } from '@mediforce/platform-core';
import { InMemoryAgentDefinitionRepository } from '@mediforce/platform-core/testing';
import { PostgresAgentDefinitionRepository } from '../repositories/agent-definition-repository';
import { PostgresNamespaceRepository } from '../repositories/namespace-repository';
import * as schema from '../schema/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

function inputBase(overrides: Partial<CreateAgentDefinitionInput> = {}): CreateAgentDefinitionInput {
  return {
    kind: 'plugin',
    runtimeId: 'claude-code-agent',
    name: 'Reviewer',
    iconName: 'bot',
    description: 'Reviews pull requests',
    foundationModel: 'anthropic/claude-sonnet-4',
    systemPrompt: 'You are a reviewer.',
    inputDescription: 'A PR diff',
    outputDescription: 'Review comments',
    visibility: 'private',
    ...overrides,
  };
}

/**
 * Shared contract for AgentDefinitionRepository (ADR-0001 L2 parity).
 * Both the in-memory double and Postgres backend MUST satisfy it.
 *
 * AgentDefinitions are global-by-id (no workspace argument on the
 * read-side surface) but agents created with a `namespace` field are
 * workspace-scoped under that namespace's workspace handle. Factory
 * returns `(repo, registerWorkspace)`; the in-memory variant treats
 * `registerWorkspace` as a no-op.
 */
function contract(
  name: string,
  factory: () => Promise<{
    repo: AgentDefinitionRepository;
    registerWorkspace: (handle: string) => Promise<void>;
  }>,
) {
  describe(`${name} — AgentDefinitionRepository contract`, () => {
    let repo: AgentDefinitionRepository;
    let registerWorkspace: (handle: string) => Promise<void>;

    beforeEach(async () => {
      ({ repo, registerWorkspace } = await factory());
    });

    it('returns null for getById when absent', async () => {
      expect(await repo.getById('missing')).toBeNull();
    });

    it('create assigns an id and round-trips fields', async () => {
      const created = await repo.create(inputBase());
      expect(created.id).toBeTruthy();
      expect(created.name).toBe('Reviewer');
      expect(created.createdAt).toBeDefined();
      expect(created.updatedAt).toBeDefined();

      const got = await repo.getById(created.id);
      expect(got).toEqual(created);
    });

    it('upsert with caller-specified id is stable across rewrites', async () => {
      const a = await repo.upsert('seed-id', inputBase({ name: 'A' }));
      expect(a.id).toBe('seed-id');
      const b = await repo.upsert('seed-id', inputBase({ name: 'B' }));
      expect(b.id).toBe('seed-id');
      expect(b.name).toBe('B');
      const got = await repo.getById('seed-id');
      expect(got?.name).toBe('B');
    });

    it('upsert round-trips optional mcpServers jsonb', async () => {
      const mcp = {
        github: {
          type: 'stdio' as const,
          catalogId: 'github-mcp',
          allowedTools: ['issues_get'],
        },
      };
      const created = await repo.upsert('with-mcp', inputBase({ mcpServers: mcp }));
      const got = await repo.getById('with-mcp');
      expect(got?.mcpServers).toEqual(mcp);
      expect(created.mcpServers).toEqual(mcp);
    });

    it('listAll returns every agent regardless of visibility', async () => {
      await registerWorkspace('ws-1');
      await repo.upsert('a', inputBase({ visibility: 'public' }));
      await repo.upsert('b', inputBase({ visibility: 'private', namespace: 'ws-1' }));
      const all = await repo.listAll();
      expect(all.map((a) => a.id).sort()).toEqual(['a', 'b']);
    });

    it('listVisibleTo returns public agents + agents in allowed namespaces', async () => {
      await registerWorkspace('ws-1');
      await registerWorkspace('ws-2');
      await repo.upsert('pub', inputBase({ visibility: 'public' }));
      await repo.upsert('priv-1', inputBase({ visibility: 'private', namespace: 'ws-1' }));
      await repo.upsert('priv-2', inputBase({ visibility: 'private', namespace: 'ws-2' }));
      const visible = await repo.listVisibleTo(['ws-1']);
      expect(visible.map((a) => a.id).sort()).toEqual(['priv-1', 'pub']);
    });

    it('listVisibleTo with empty allowed returns only public agents', async () => {
      await registerWorkspace('ws-1');
      await repo.upsert('pub', inputBase({ visibility: 'public' }));
      await repo.upsert('priv', inputBase({ visibility: 'private', namespace: 'ws-1' }));
      const visible = await repo.listVisibleTo([]);
      expect(visible.map((a) => a.id)).toEqual(['pub']);
    });

    it('getByIdVisibleTo enforces visibility/namespace gate', async () => {
      await registerWorkspace('ws-1');
      await registerWorkspace('ws-2');
      await repo.upsert('pub', inputBase({ visibility: 'public' }));
      await repo.upsert('priv', inputBase({ visibility: 'private', namespace: 'ws-1' }));
      expect((await repo.getByIdVisibleTo('pub', []))?.id).toBe('pub');
      expect((await repo.getByIdVisibleTo('priv', ['ws-1']))?.id).toBe('priv');
      expect(await repo.getByIdVisibleTo('priv', ['ws-2'])).toBeNull();
      expect(await repo.getByIdVisibleTo('priv', [])).toBeNull();
      expect(await repo.getByIdVisibleTo('missing', ['ws-1'])).toBeNull();
    });

    it('update patches a subset and preserves the rest', async () => {
      const created = await repo.upsert('u1', inputBase({ name: 'Original' }));
      await new Promise((r) => setTimeout(r, 10));
      const updated = await repo.update('u1', { name: 'Updated' });
      expect(updated.name).toBe('Updated');
      expect(updated.foundationModel).toBe(created.foundationModel);
      // updatedAt must be no earlier than createdAt. The in-memory default
      // clock returns a fixed timestamp; the Postgres trigger uses real time
      // and the surrounding sleep guarantees strict monotonicity there. The
      // dedicated trigger test below asserts the strict bump.
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(created.updatedAt).getTime());
    });

    it('delete removes the row; subsequent getById returns null', async () => {
      await repo.upsert('d1', inputBase());
      await repo.delete('d1');
      expect(await repo.getById('d1')).toBeNull();
    });

    it('delete on a missing id is a no-op', async () => {
      await expect(repo.delete('missing')).resolves.toBeUndefined();
    });

    it('rejects create with invalid payload (empty name)', async () => {
      await expect(repo.create(inputBase({ name: '' }))).rejects.toThrow();
    });

    it('rejects create with invalid payload (empty namespace)', async () => {
      await expect(repo.create(inputBase({ namespace: '' }))).rejects.toThrow();
    });
  });
}

contract('InMemoryAgentDefinitionRepository', async () => ({
  repo: new InMemoryAgentDefinitionRepository(),
  registerWorkspace: async () => {},
}));

describe.skipIf(skipPg)('PostgresAgentDefinitionRepository (parity)', () => {
  const schemaName = `agent_${randomBytes(8).toString('hex')}`;
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

  contract('PostgresAgentDefinitionRepository', async () => {
    const db = drizzle(testClient, { schema });
    await testClient.unsafe(
      `TRUNCATE TABLE "${schemaName}"."agents", ` +
        `"${schemaName}"."workspace_members", "${schemaName}"."workspaces" CASCADE`,
    );
    const nsRepo = new PostgresNamespaceRepository(db);
    const repo = new PostgresAgentDefinitionRepository(db);
    return {
      repo,
      registerWorkspace: async (handle: string) => {
        if (!(await nsRepo.getNamespace(handle))) {
          await nsRepo.createNamespace({
            handle,
            type: 'organization',
            displayName: handle,
            createdAt: '2026-05-27T00:00:00.000Z',
          });
        }
      },
    };
  });

  it('set_updated_at trigger advances updated_at on UPDATE of agents', async () => {
    await testClient.unsafe(
      `TRUNCATE TABLE "${schemaName}"."agents", ` +
        `"${schemaName}"."workspace_members", "${schemaName}"."workspaces" CASCADE`,
    );
    const db = drizzle(testClient, { schema });
    const repo = new PostgresAgentDefinitionRepository(db);
    const before = await repo.upsert('trig', inputBase());
    await new Promise((r) => setTimeout(r, 10));
    const after = await repo.update('trig', { name: 'Renamed' });
    expect(new Date(after.updatedAt).getTime()).toBeGreaterThan(new Date(before.updatedAt).getTime());
  });
});
