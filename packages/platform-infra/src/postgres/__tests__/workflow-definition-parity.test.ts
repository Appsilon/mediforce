import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InMemoryProcessRepository } from '@mediforce/platform-core';
import type {
  ProcessRepository,
  WorkflowDefinition,
} from '@mediforce/platform-core';
import { PostgresProcessRepository } from '../repositories/process-repository';
import { PostgresNamespaceRepository } from '../repositories/namespace-repository';
import * as schema from '../schema/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

function definitionFor(
  namespace: string,
  overrides: Partial<WorkflowDefinition> = {},
): WorkflowDefinition {
  return {
    namespace,
    name: 'supply-chain-review',
    version: 1,
    visibility: 'private',
    title: 'Supply chain review',
    description: 'Review supplier compliance',
    steps: [
      {
        id: 'intake',
        name: 'Intake',
        type: 'creation',
        executor: 'human',
      },
    ],
    transitions: [],
    triggers: [{ type: 'manual', name: 'manual' }],
    createdAt: '2026-05-27T00:00:00.000Z',
    ...overrides,
  } as WorkflowDefinition;
}

function contract(
  name: string,
  factory: () => Promise<{
    repo: ProcessRepository;
    registerWorkspace: (namespace: string) => Promise<void>;
  }>,
) {
  describe(`${name} — ProcessRepository contract`, () => {
    it('save + getWorkflowDefinition round-trips', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-1');
      const def = definitionFor('ws-1', {
        title: 'My WD',
        metadata: { owner: 'team-x' },
      });
      await repo.saveWorkflowDefinition(def);

      const fetched = await repo.getWorkflowDefinition('ws-1', def.name, 1);
      expect(fetched).not.toBeNull();
      expect(fetched?.namespace).toBe('ws-1');
      expect(fetched?.name).toBe(def.name);
      expect(fetched?.version).toBe(1);
      expect(fetched?.title).toBe('My WD');
      expect(fetched?.metadata).toEqual({ owner: 'team-x' });
    });

    it('getWorkflowDefinition returns null for unknown triple', async () => {
      const { repo } = await factory();
      expect(await repo.getWorkflowDefinition('ws-x', 'missing', 1)).toBeNull();
    });

    it('listAllWorkflowDefinitions groups versions per (ns, name)', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-1');
      await repo.saveWorkflowDefinition(definitionFor('ws-1', { version: 1 }));
      await repo.saveWorkflowDefinition(definitionFor('ws-1', { version: 2 }));
      await repo.saveWorkflowDefinition(
        definitionFor('ws-1', { name: 'other-wf', version: 1 }),
      );

      const result = await repo.listAllWorkflowDefinitions(false);
      const supply = result.definitions.find((d) => d.name === 'supply-chain-review');
      expect(supply).toBeDefined();
      expect(supply?.versions.map((v) => v.version).sort()).toEqual([1, 2]);
      expect(supply?.latestVersion).toBe(2);
    });

    it('listAllWorkflowDefinitions(false) hides archived versions', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-1');
      await repo.saveWorkflowDefinition(definitionFor('ws-1', { version: 1 }));
      await repo.saveWorkflowDefinition(definitionFor('ws-1', { version: 2 }));
      await repo.setVersionArchived('ws-1', 'supply-chain-review', 2, true);

      const result = await repo.listAllWorkflowDefinitions(false);
      const supply = result.definitions.find((d) => d.name === 'supply-chain-review');
      expect(supply?.versions.map((v) => v.version)).toEqual([1]);

      const withArchived = await repo.listAllWorkflowDefinitions(true);
      const supplyAll = withArchived.definitions.find(
        (d) => d.name === 'supply-chain-review',
      );
      expect(supplyAll?.versions.map((v) => v.version).sort()).toEqual([1, 2]);
    });

    it('listWorkflowDefinitionsVisibleTo honours visibility + allowed', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-public');
      await registerWorkspace('ws-private');
      await registerWorkspace('ws-allowed');
      await repo.saveWorkflowDefinition(
        definitionFor('ws-public', { name: 'public-wf', visibility: 'public' }),
      );
      await repo.saveWorkflowDefinition(
        definitionFor('ws-private', { name: 'private-wf', visibility: 'private' }),
      );
      await repo.saveWorkflowDefinition(
        definitionFor('ws-allowed', { name: 'allowed-wf', visibility: 'private' }),
      );

      const result = await repo.listWorkflowDefinitionsVisibleTo(
        ['ws-allowed'],
        false,
      );
      const names = result.definitions.map((d) => d.name);
      expect(names).toContain('public-wf');
      expect(names).toContain('allowed-wf');
      expect(names).not.toContain('private-wf');
    });

    it('getLatestWorkflowVersion returns 0 when no versions exist', async () => {
      const { repo } = await factory();
      expect(await repo.getLatestWorkflowVersion('ws-x', 'none')).toBe(0);
    });

    it('getLatestWorkflowVersion picks max version', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-1');
      await repo.saveWorkflowDefinition(definitionFor('ws-1', { version: 1 }));
      await repo.saveWorkflowDefinition(definitionFor('ws-1', { version: 3 }));
      await repo.saveWorkflowDefinition(definitionFor('ws-1', { version: 2 }));
      expect(
        await repo.getLatestWorkflowVersion('ws-1', 'supply-chain-review'),
      ).toBe(3);
    });

    it('listWorkflowVersions returns versions ascending, [] for unknown', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-1');
      expect(await repo.listWorkflowVersions('ws-1', 'none')).toEqual([]);
      await repo.saveWorkflowDefinition(definitionFor('ws-1', { version: 3 }));
      await repo.saveWorkflowDefinition(definitionFor('ws-1', { version: 1 }));
      await repo.saveWorkflowDefinition(definitionFor('ws-1', { version: 2 }));

      const versions = await repo.listWorkflowVersions('ws-1', 'supply-chain-review');
      expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
    });

    it('listWorkflowVersions includes archived versions', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-1');
      await repo.saveWorkflowDefinition(definitionFor('ws-1', { version: 1 }));
      await repo.saveWorkflowDefinition(definitionFor('ws-1', { version: 2 }));
      await repo.setVersionArchived('ws-1', 'supply-chain-review', 2, true);

      const versions = await repo.listWorkflowVersions('ws-1', 'supply-chain-review');
      expect(versions.map((v) => v.version)).toEqual([1, 2]);
      expect(versions.find((v) => v.version === 2)?.archived).toBe(true);
    });

    it('get/setDefaultWorkflowVersion round-trips', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-1');
      expect(
        await repo.getDefaultWorkflowVersion('ws-1', 'supply-chain-review'),
      ).toBeNull();
      await repo.setDefaultWorkflowVersion('ws-1', 'supply-chain-review', 2);
      expect(
        await repo.getDefaultWorkflowVersion('ws-1', 'supply-chain-review'),
      ).toBe(2);
      // Upsert path
      await repo.setDefaultWorkflowVersion('ws-1', 'supply-chain-review', 4);
      expect(
        await repo.getDefaultWorkflowVersion('ws-1', 'supply-chain-review'),
      ).toBe(4);
    });

    it('setProcessArchived flips all versions; listAll(false) hides them', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-1');
      await repo.saveWorkflowDefinition(definitionFor('ws-1', { version: 1 }));
      await repo.saveWorkflowDefinition(definitionFor('ws-1', { version: 2 }));
      await repo.setProcessArchived('supply-chain-review', 'ws-1', true);

      const result = await repo.listAllWorkflowDefinitions(false);
      const found = result.definitions.find((d) => d.name === 'supply-chain-review');
      expect(found).toBeUndefined();

      await repo.setProcessArchived('supply-chain-review', 'ws-1', false);
      const restored = await repo.listAllWorkflowDefinitions(false);
      const back = restored.definitions.find((d) => d.name === 'supply-chain-review');
      expect(back?.versions).toHaveLength(2);
    });

    it('setVersionArchived throws on unknown version', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-1');
      await expect(
        repo.setVersionArchived('ws-1', 'missing', 1, true),
      ).rejects.toThrow();
    });

    it('setWorkflowVisibility flips all versions; throws when none exist', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-1');
      await repo.saveWorkflowDefinition(definitionFor('ws-1', { version: 1 }));
      await repo.saveWorkflowDefinition(definitionFor('ws-1', { version: 2 }));
      await repo.setWorkflowVisibility('supply-chain-review', 'ws-1', 'public');
      const v1 = await repo.getWorkflowDefinition('ws-1', 'supply-chain-review', 1);
      const v2 = await repo.getWorkflowDefinition('ws-1', 'supply-chain-review', 2);
      expect(v1?.visibility).toBe('public');
      expect(v2?.visibility).toBe('public');

      await expect(
        repo.setWorkflowVisibility('missing', 'ws-1', 'public'),
      ).rejects.toThrow();
    });

    it('transferWorkflowNamespace moves all versions; throws when source has none', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-1');
      await registerWorkspace('ws-2');
      await repo.saveWorkflowDefinition(definitionFor('ws-1', { version: 1 }));
      await repo.saveWorkflowDefinition(definitionFor('ws-1', { version: 2 }));

      await repo.transferWorkflowNamespace('ws-1', 'supply-chain-review', 'ws-2');
      expect(await repo.getWorkflowDefinition('ws-1', 'supply-chain-review', 1)).toBeNull();
      expect(
        (await repo.getWorkflowDefinition('ws-2', 'supply-chain-review', 2))?.namespace,
      ).toBe('ws-2');

      // Non-existent source workflow must reject, not silently no-op.
      await expect(
        repo.transferWorkflowNamespace('ws-1', 'missing', 'ws-2'),
      ).rejects.toThrow();
    });

    it('setWorkflowDeleted + isWorkflowNameDeleted reflect tombstone', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-1');
      await repo.saveWorkflowDefinition(definitionFor('ws-1', { version: 1 }));
      expect(await repo.isWorkflowNameDeleted('ws-1', 'supply-chain-review')).toBe(
        false,
      );
      await repo.setWorkflowDeleted('ws-1', 'supply-chain-review', true);
      expect(await repo.isWorkflowNameDeleted('ws-1', 'supply-chain-review')).toBe(
        true,
      );
      await repo.setWorkflowDeleted('ws-1', 'supply-chain-review', false);
      expect(await repo.isWorkflowNameDeleted('ws-1', 'supply-chain-review')).toBe(
        false,
      );
    });

    it('unique (workspace, name, version) — duplicate save throws', async () => {
      const { repo, registerWorkspace } = await factory();
      await registerWorkspace('ws-1');
      await repo.saveWorkflowDefinition(definitionFor('ws-1', { version: 1 }));
      await expect(
        repo.saveWorkflowDefinition(definitionFor('ws-1', { version: 1 })),
      ).rejects.toThrow();
    });

  });
}

contract('InMemoryProcessRepository', async () => {
  const repo = new InMemoryProcessRepository();
  return {
    repo,
    registerWorkspace: async () => {
      // in-memory has no FK constraint
    },
  };
});

describe.skipIf(skipPg)('PostgresProcessRepository (parity)', () => {
  const schemaName = `wf_${randomBytes(8).toString('hex')}`;
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

  it('Postgres rejects save with invalid schema (missing steps)', async () => {
    const db = drizzle(testClient, { schema });
    const repo = new PostgresProcessRepository(db);
    const nsRepo = new PostgresNamespaceRepository(db);
    const ns = `ws-bogus-${randomBytes(4).toString('hex')}`;
    if (!(await nsRepo.getNamespace(ns))) {
      await nsRepo.createNamespace({
        handle: ns,
        type: 'organization',
        displayName: ns,
        createdAt: '2026-05-27T00:00:00.000Z',
      });
    }
    const bogus = definitionFor(ns);
    (bogus as unknown as { steps: unknown }).steps = [];
    await expect(repo.saveWorkflowDefinition(bogus)).rejects.toThrow();
  });

  contract('PostgresProcessRepository', async () => {
    const db = drizzle(testClient, { schema });
    await testClient.unsafe(
      `TRUNCATE TABLE ` +
        `"${schemaName}"."workflow_meta", ` +
        `"${schemaName}"."workflow_definitions", ` +
        `"${schemaName}"."workspace_members", "${schemaName}"."workspaces" CASCADE`,
    );
    const repo = new PostgresProcessRepository(db);
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
});
