// @vitest-environment node
//
// Route-level integration against a REAL Postgres + REAL filesystem (true L3,
// ADR-0003 PR2). The sibling `attachments-integration.test.ts` drives the same
// route handlers but with in-memory repos; this file swaps in the production
// backends so the full path is exercised end-to-end:
//
//   HTTP route adapter
//     → AuthorizedTaskAttachmentRepository (workspace gating)
//       → PostgresTaskAttachmentRepository (real `task_attachments` rows)
//     → FilesystemBlobStore (real bytes under an `os.tmpdir()` root)
//
// Gated on `TEST_DATABASE_URL ?? DATABASE_URL` so a no-DB run (e.g. the
// platform-ui unit-tests CI job) skips cleanly via `describe.skipIf`. Small
// files only — large-file streaming is covered at L1; here we just prove the
// wiring touches Postgres and the disk, not in-memory doubles.
//
// Runs under the `node` environment (not jsdom): multipart `FormData` bodies
// are parsed by undici, which only accepts Node's native `File`.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { NextRequest, NextResponse } from 'next/server';
import type { CallerIdentity } from '@mediforce/platform-api/auth';
import { createTestScope, userCaller } from '@mediforce/platform-api/testing';
import type { TestScopeOverrides } from '@mediforce/platform-api/testing';
import {
  FilesystemBlobStore,
  PostgresHumanTaskRepository,
  PostgresProcessInstanceRepository,
  PostgresTaskAttachmentRepository,
  PostgresNamespaceRepository,
  createPostgresClient,
} from '@mediforce/platform-infra';
import type { CallerScope } from '@mediforce/platform-api/repositories';
import { makeGET as makeListGET, makePOST } from '@/app/api/tasks/[taskId]/attachments/route';
import { makeGET as makeBlobGET } from '@/app/api/attachments/[id]/blob/route';
import { makeDELETE } from '@/app/api/attachments/[id]/route';

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

const MIGRATIONS_DIR = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'platform-infra',
  'src',
  'postgres',
  'migrations',
);

const WORKSPACE = 'ws-pg-1';
const INSTANCE_ID = 'inst-attach-pg-1';
const TASK_ID = 'task-attach-pg-1';

const memberCaller = userCaller('uid-uploader', [WORKSPACE]);

interface UploadBody {
  attachment: {
    id: string;
    name: string;
    sizeBytes: number;
    workspace: string;
    blobKey: string;
    deletedAt: string | null;
  };
}

interface AttachmentRow {
  id: string;
  task_id: string;
  workspace: string;
  name: string;
  content_type: string;
  size_bytes: string;
  blob_key: string;
  uploaded_by: string;
  deleted_at: Date | null;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe.skipIf(skipPg)(
  'attachments routes ↔ Postgres + FilesystemBlobStore (real-backend integration)',
  () => {
    const schemaName = `attach_pg_${randomBytes(8).toString('hex')}`;
    let adminClient: ReturnType<typeof postgres>;
    let pg: ReturnType<typeof createPostgresClient>;
    let tmpRoot: string;
    let blobStore: FilesystemBlobStore;
    let savedMaxBytes: string | undefined;

    function buildScopeFor(caller: CallerIdentity): CallerScope {
      const instanceRepo = new PostgresProcessInstanceRepository(pg.db);
      const humanTaskRepo = new PostgresHumanTaskRepository(pg.db, instanceRepo);
      const attachmentRepo = new PostgresTaskAttachmentRepository(pg.db);
      // `createTestScope` fills the full scope (audit, namespace, etc.) with
      // safe stubs; we override only the four collaborators the attachment
      // routes actually persist through with their REAL Postgres / filesystem
      // backends.
      const overrides: TestScopeOverrides = {
        caller,
        instanceRepo,
        humanTaskRepo,
        taskAttachmentRepo: attachmentRepo,
        blobStore,
      };
      return createTestScope(overrides);
    }

    function uploadRoute(caller: CallerIdentity = memberCaller) {
      return makePOST({
        resolveCaller: async () => caller,
        buildScope: () => buildScopeFor(caller),
      });
    }
    function listRoute(caller: CallerIdentity = memberCaller) {
      return makeListGET({
        resolveCaller: async () => caller,
        buildScope: () => buildScopeFor(caller),
      });
    }
    function blobRoute(caller: CallerIdentity = memberCaller) {
      return makeBlobGET({
        resolveCaller: async () => caller,
        buildScope: () => buildScopeFor(caller),
      });
    }
    function deleteRoute(caller: CallerIdentity = memberCaller) {
      return makeDELETE({
        resolveCaller: async () => caller,
        buildScope: () => buildScopeFor(caller),
      });
    }

    async function uploadFile(
      name: string,
      contentType: string,
      bytes: Buffer,
      caller: CallerIdentity = memberCaller,
    ): Promise<NextResponse> {
      const form = new FormData();
      form.append('file', new File([bytes], name, { type: contentType }));
      const req = new NextRequest(`http://localhost/api/tasks/${TASK_ID}/attachments`, {
        method: 'POST',
        body: form,
      });
      return uploadRoute(caller)(req, { params: Promise.resolve({ taskId: TASK_ID }) });
    }

    async function rowsForTask(): Promise<AttachmentRow[]> {
      return adminClient.unsafe(
        `SELECT id, task_id, workspace, name, content_type, size_bytes, ` +
          `blob_key, uploaded_by, deleted_at ` +
          `FROM "${schemaName}"."task_attachments" WHERE task_id = $1 ORDER BY uploaded_at`,
        [TASK_ID],
      ) as Promise<AttachmentRow[]>;
    }

    async function blobOnDisk(blobKey: string): Promise<boolean> {
      try {
        await stat(join(tmpRoot, blobKey.slice(0, 2), blobKey));
        return true;
      } catch {
        return false;
      }
    }

    beforeAll(async () => {
      adminClient = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} });
      await adminClient.unsafe(`CREATE SCHEMA "${schemaName}"`);
      pg = createPostgresClient({ url: DATABASE_URL!, schema: schemaName });
      const files = readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort();
      const migrationClient = postgres(DATABASE_URL!, {
        max: 1,
        onnotice: () => {},
        connection: { search_path: schemaName },
      });
      for (const file of files) {
        const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
        await migrationClient.unsafe(sql);
      }
      await migrationClient.end();
    });

    afterAll(async () => {
      if (pg) await pg.client.end();
      if (adminClient) {
        await adminClient.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
        await adminClient.end();
      }
    });

    beforeEach(async () => {
      tmpRoot = await mkdtemp(join(tmpdir(), 'mf-attach-pg-'));
      blobStore = new FilesystemBlobStore(tmpRoot);
      savedMaxBytes = process.env.MEDIFORCE_ATTACHMENT_MAX_BYTES;
      delete process.env.MEDIFORCE_ATTACHMENT_MAX_BYTES;

      // Fresh parent FK chain per test: workspace → process_instance → human_task.
      await adminClient.unsafe(
        `TRUNCATE TABLE "${schemaName}"."task_attachments", ` +
          `"${schemaName}"."human_tasks", ` +
          `"${schemaName}"."process_instances", ` +
          `"${schemaName}"."workspace_members", "${schemaName}"."workspaces" CASCADE`,
      );

      const nsRepo = new PostgresNamespaceRepository(pg.db);
      await nsRepo.createNamespace({
        handle: WORKSPACE,
        type: 'organization',
        displayName: WORKSPACE,
        createdAt: '2026-06-24T00:00:00.000Z',
      });
      await adminClient.unsafe(
        `INSERT INTO "${schemaName}"."process_instances" ` +
          `(id, workspace, definition_name, definition_version, status, ` +
          `variables, trigger_type, trigger_payload, created_by) ` +
          `VALUES ($1, $2, 'stub-def', '1.0.0', 'completed', '{}'::jsonb, 'manual', '{}'::jsonb, 'uid-seed')`,
        [INSTANCE_ID, WORKSPACE],
      );
      await adminClient.unsafe(
        `INSERT INTO "${schemaName}"."human_tasks" ` +
          `(id, workspace, process_instance_id, step_id, assigned_role, ` +
          `status, creation_reason) ` +
          `VALUES ($1, $2, $3, 'step-1', 'reviewer', 'pending', 'human_executor')`,
        [TASK_ID, WORKSPACE, INSTANCE_ID],
      );
    });

    afterEach(async () => {
      if (savedMaxBytes === undefined) delete process.env.MEDIFORCE_ATTACHMENT_MAX_BYTES;
      else process.env.MEDIFORCE_ATTACHMENT_MAX_BYTES = savedMaxBytes;
      await rm(tmpRoot, { recursive: true, force: true });
    });

    it('upload: 201, real task_attachments row in Postgres, bytes on disk (sha256 match)', async () => {
      const bytes = randomBytes(3072);
      const expectedSha = sha256(bytes);

      const res = await uploadFile('dataset.csv', 'text/csv', bytes);
      expect(res.status).toBe(201);
      const { attachment } = (await res.json()) as UploadBody;

      // 1. The row really exists in Postgres with the right columns.
      const rows = await rowsForTask();
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.id).toBe(attachment.id);
      expect(row.task_id).toBe(TASK_ID);
      expect(row.workspace).toBe(WORKSPACE);
      expect(row.name).toBe('dataset.csv');
      expect(row.content_type).toBe('text/csv');
      expect(Number(row.size_bytes)).toBe(bytes.length);
      expect(row.blob_key).toBe(attachment.blobKey);
      expect(row.uploaded_by).toBe('uid-uploader');
      expect(row.deleted_at).toBeNull();

      // 2. The bytes really landed on disk under the FilesystemBlobStore root.
      const diskPath = join(tmpRoot, attachment.blobKey.slice(0, 2), attachment.blobKey);
      const onDisk = readFileSync(diskPath);
      expect(sha256(onDisk)).toBe(expectedSha);
    });

    it('download: 200, headers correct, body bytes sha256 match the upload', async () => {
      const bytes = randomBytes(2048);
      const expectedSha = sha256(bytes);
      const upload = await uploadFile('report.bin', 'application/octet-stream', bytes);
      const { attachment } = (await upload.json()) as UploadBody;

      const req = new NextRequest(`http://localhost/api/attachments/${attachment.id}/blob`);
      const res = await blobRoute()(req, { params: Promise.resolve({ id: attachment.id }) });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
      expect(res.headers.get('Content-Length')).toBe(String(bytes.length));
      expect(res.headers.get('Content-Disposition')).toContain('report.bin');

      const received = Buffer.from(await res.arrayBuffer());
      expect(sha256(received)).toBe(expectedSha);
    });

    it('list: includes the uploaded row (read straight from Postgres via the route)', async () => {
      const upload = await uploadFile('x.txt', 'text/plain', randomBytes(512));
      const { attachment } = (await upload.json()) as UploadBody;

      const req = new NextRequest(`http://localhost/api/tasks/${TASK_ID}/attachments`);
      const res = await listRoute()(req, { params: Promise.resolve({ taskId: TASK_ID }) });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { attachments: Array<{ id: string }> };
      expect(body.attachments.map((a) => a.id)).toContain(attachment.id);
    });

    it('oversize: 4xx validation envelope, NO row in Postgres, NO file on disk', async () => {
      process.env.MEDIFORCE_ATTACHMENT_MAX_BYTES = '1024';
      const bytes = randomBytes(4096);

      const res = await uploadFile('big.bin', 'application/octet-stream', bytes);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('validation');

      // Nothing persisted: no metadata row, and the blob dir stays empty.
      const rows = await rowsForTask();
      expect(rows).toHaveLength(0);
      const diskEntries = readdirSync(tmpRoot);
      expect(diskEntries).toHaveLength(0);
    });

    it('delete soft: 200, deleted_at set in Postgres, blob still on disk, blob GET → 404', async () => {
      const bytes = randomBytes(1536);
      const upload = await uploadFile('doomed.txt', 'text/plain', bytes);
      const { attachment } = (await upload.json()) as UploadBody;

      const delReq = new NextRequest(`http://localhost/api/attachments/${attachment.id}`, {
        method: 'DELETE',
      });
      const delRes = await deleteRoute()(delReq, {
        params: Promise.resolve({ id: attachment.id }),
      });
      expect(delRes.status).toBe(200);

      // Postgres row is tombstoned, not removed.
      const rows = await rowsForTask();
      expect(rows).toHaveLength(1);
      expect(rows[0].deleted_at).not.toBeNull();

      // Soft-delete keeps the blob on disk (GC is a later sweep, ADR-0003 §7).
      expect(await blobOnDisk(attachment.blobKey)).toBe(true);

      // But the blob route now 404s the soft-deleted row.
      const blobReq = new NextRequest(`http://localhost/api/attachments/${attachment.id}/blob`);
      const blobRes = await blobRoute()(blobReq, {
        params: Promise.resolve({ id: attachment.id }),
      });
      expect(blobRes.status).toBe(404);
    });
  },
);
