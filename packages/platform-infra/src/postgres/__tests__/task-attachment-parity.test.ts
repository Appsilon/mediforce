import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InMemoryTaskAttachmentRepository } from '@mediforce/platform-core/testing';
import type {
  NewTaskAttachment,
  TaskAttachmentRepository,
} from '@mediforce/platform-core';
import { PostgresTaskAttachmentRepository } from '../repositories/task-attachment-repository';
import { PostgresNamespaceRepository } from '../repositories/namespace-repository';
import * as schema from '../schema/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

function attachmentFor(
  taskId: string,
  overrides: Partial<NewTaskAttachment> = {},
): NewTaskAttachment {
  return {
    taskId,
    workspace: 'ws-1',
    name: 'dataset.csv',
    contentType: 'text/csv',
    sizeBytes: 1024,
    blobKey: randomUUID(),
    uploadedBy: 'uid-uploader',
    ...overrides,
  };
}

/**
 * Shared contract for `TaskAttachmentRepository` (ADR-0003 L2 parity).
 * Both the in-memory double and Postgres backend MUST satisfy it.
 *
 * Factory returns `(repo, registerTask)`: callers register `(taskId →
 * workspace)` so the Postgres backend can satisfy the FK to `human_tasks`. The
 * in-memory backend ignores the registration (no FK).
 */
function contract(
  name: string,
  factory: () => Promise<{
    repo: TaskAttachmentRepository;
    registerTask: (taskId: string, workspace: string) => Promise<void>;
  }>,
) {
  describe(`${name} — TaskAttachmentRepository contract`, () => {
    let repo: TaskAttachmentRepository;
    let registerTask: (taskId: string, workspace: string) => Promise<void>;

    beforeEach(async () => {
      ({ repo, registerTask } = await factory());
    });

    it('create round-trips all fields; getById returns it', async () => {
      const taskId = `task-${randomUUID()}`;
      await registerTask(taskId, 'ws-1');
      const created = await repo.create(
        attachmentFor(taskId, {
          name: 'sdtm.xpt',
          contentType: 'application/octet-stream',
          sizeBytes: 4096,
          uploadedBy: 'uid-reviewer',
        }),
      );
      expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(created.taskId).toBe(taskId);
      expect(created.workspace).toBe('ws-1');
      expect(created.name).toBe('sdtm.xpt');
      expect(created.contentType).toBe('application/octet-stream');
      expect(created.sizeBytes).toBe(4096);
      expect(created.uploadedBy).toBe('uid-reviewer');
      expect(created.uploadedAt).toMatch(/T.*Z$/);
      expect(created.deletedAt).toBeNull();

      const fetched = await repo.getById(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.id).toBe(created.id);
      expect(fetched?.blobKey).toBe(created.blobKey);
    });

    it('getById returns null for unknown id', async () => {
      const missing = await repo.getById(randomUUID());
      expect(missing).toBeNull();
    });

    it('list returns active attachments oldest-first, excluding soft-deleted', async () => {
      const taskId = `task-${randomUUID()}`;
      await registerTask(taskId, 'ws-1');
      const first = await repo.create(attachmentFor(taskId, { name: 'a.csv' }));
      // Distinct uploaded_at so ordering is deterministic.
      await new Promise((res) => setTimeout(res, 5));
      const second = await repo.create(attachmentFor(taskId, { name: 'b.csv' }));
      await new Promise((res) => setTimeout(res, 5));
      const third = await repo.create(attachmentFor(taskId, { name: 'c.csv' }));

      await repo.delete(second.id);

      const active = await repo.list(taskId);
      expect(active.map((a) => a.id)).toEqual([first.id, third.id]);
    });

    it('list excludes attachments for other tasks', async () => {
      const taskA = `task-${randomUUID()}`;
      const taskB = `task-${randomUUID()}`;
      await registerTask(taskA, 'ws-1');
      await registerTask(taskB, 'ws-1');
      await repo.create(attachmentFor(taskA));
      await repo.create(attachmentFor(taskB));

      const onlyA = await repo.list(taskA);
      expect(onlyA).toHaveLength(1);
      expect(onlyA[0].taskId).toBe(taskA);
    });

    it('delete soft-deletes: getById still returns the row with deletedAt set', async () => {
      const taskId = `task-${randomUUID()}`;
      await registerTask(taskId, 'ws-1');
      const created = await repo.create(attachmentFor(taskId));

      await repo.delete(created.id);

      const fetched = await repo.getById(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.deletedAt).not.toBeNull();

      const active = await repo.list(taskId);
      expect(active).toHaveLength(0);
    });
  });
}

contract('InMemoryTaskAttachmentRepository', async () => {
  const repo = new InMemoryTaskAttachmentRepository();
  return {
    repo,
    registerTask: async () => {
      // No FK in the in-memory backend.
    },
  };
});

describe.skipIf(skipPg)('PostgresTaskAttachmentRepository (parity)', () => {
  const schemaName = `task_attachment_${randomBytes(8).toString('hex')}`;
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

  /**
   * Seeds the parent `human_tasks` row (and its `process_instances` + workspace
   * ancestors) so a `task_attachments` insert satisfies the FK chain.
   */
  async function seedTask(taskId: string, workspace: string): Promise<void> {
    const nsRepo = new PostgresNamespaceRepository(
      drizzle(testClient, { schema }),
    );
    if (!(await nsRepo.getNamespace(workspace))) {
      await nsRepo.createNamespace({
        handle: workspace,
        type: 'organization',
        displayName: workspace,
        createdAt: '2026-05-27T00:00:00.000Z',
      });
    }
    const instanceId = `inst-${taskId}`;
    await testClient.unsafe(
      `INSERT INTO "${schemaName}"."process_instances" ` +
        `(id, workspace, definition_name, definition_version, status, ` +
        `variables, trigger_type, trigger_payload) ` +
        `VALUES ($1, $2, 'stub-def', '1.0.0', 'completed', '{}'::jsonb, 'manual', '{}'::jsonb) ` +
        `ON CONFLICT (id) DO NOTHING`,
      [instanceId, workspace],
    );
    await testClient.unsafe(
      `INSERT INTO "${schemaName}"."human_tasks" ` +
        `(id, workspace, process_instance_id, step_id, assigned_role, ` +
        `status, creation_reason) ` +
        `VALUES ($1, $2, $3, 'step-1', 'reviewer', 'pending', 'human_executor') ` +
        `ON CONFLICT (id) DO NOTHING`,
      [taskId, workspace, instanceId],
    );
  }

  contract('PostgresTaskAttachmentRepository', async () => {
    const db = drizzle(testClient, { schema });
    await testClient.unsafe(
      `TRUNCATE TABLE "${schemaName}"."task_attachments", ` +
        `"${schemaName}"."human_tasks", ` +
        `"${schemaName}"."process_instances", ` +
        `"${schemaName}"."workspace_members", "${schemaName}"."workspaces" CASCADE`,
    );
    const repo = new PostgresTaskAttachmentRepository(db);
    return {
      repo,
      registerTask: async (taskId, workspace) => {
        await seedTask(taskId, workspace);
      },
    };
  });

  // --- Postgres-only invariants (no in-memory analogue) ---

  it('cascade-deletes attachments when the parent human_task is deleted', async () => {
    const db = drizzle(testClient, { schema });
    const repo = new PostgresTaskAttachmentRepository(db);
    const taskId = `task-${randomUUID()}`;
    await seedTask(taskId, 'ws-1');
    const created = await repo.create(attachmentFor(taskId));
    expect(await repo.getById(created.id)).not.toBeNull();

    await testClient.unsafe(
      `DELETE FROM "${schemaName}"."human_tasks" WHERE id = $1`,
      [taskId],
    );

    expect(await repo.getById(created.id)).toBeNull();
  });

  it('rejects attachments larger than 100 MiB via the CHECK constraint', async () => {
    const db = drizzle(testClient, { schema });
    const repo = new PostgresTaskAttachmentRepository(db);
    const taskId = `task-${randomUUID()}`;
    await seedTask(taskId, 'ws-1');

    await expect(
      repo.create(attachmentFor(taskId, { sizeBytes: 104857600 + 1 })),
    ).rejects.toThrow();
  });
});
