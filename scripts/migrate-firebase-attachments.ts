/**
 * ADR-0003 PR3 — one-off migrator: copy legacy Firebase Storage `tasks/…`
 * attachment objects into the new `BlobStore` + `task_attachments` rows.
 *
 * Legacy task attachments live in `human_tasks.completion_data.files[]`
 * (`{ name, size, type, storagePath, downloadUrl }`, uploader =
 * `completion_data.completedBy`). The bytes themselves are still only in
 * Firebase Storage at `storagePath` — this script downloads each one through
 * firebase-admin, writes it to the `BlobStore`, and inserts the metadata row.
 *
 * `agentSkills/…` objects are abandoned (the uploaded-skills feature was
 * deleted in PR1) — listed and counted, never copied.
 *
 * The copy logic is the pure, unit-tested `copyFirebaseAttachments`
 * (platform-infra) — this file is only the Firebase + Postgres shell around it.
 *
 * Run (staging only — never production):
 *   DATABASE_URL=… NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=… MEDIFORCE_DATA_DIR=… \
 *     pnpm tsx scripts/migrate-firebase-attachments.ts [--dry-run]
 */

import { getApps, initializeApp, getApp, type App } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { z } from 'zod';
import {
  copyFirebaseAttachments,
  createPostgresClient,
  FilesystemBlobStore,
  PostgresTaskAttachmentRepository,
  type FirebaseAttachmentExport,
  type LegacyTaskAttachment,
  type MigrationReport,
} from '@mediforce/platform-infra';

const SYSTEM_UPLOADER = 'firebase-storage-migration';
const TASK_PREFIX = 'tasks/';
const SKILL_PREFIX = 'agentSkills/';

/** Stored upload-completion shape on `human_tasks.completion_data` — `files`
 *  (not the API payload's `attachments`), each with a nullable `storagePath`. */
const StoredUploadFileSchema = z.object({
  name: z.string().min(1),
  size: z.number().nonnegative(),
  type: z.string(),
  storagePath: z.string().nullish(),
  downloadUrl: z.string().nullish(),
});

const StoredCompletionSchema = z.object({
  files: z.array(StoredUploadFileSchema),
  completedBy: z.string().nullish(),
});

const HumanTaskRowSchema = z.object({
  id: z.string(),
  workspace: z.string(),
  assigned_user_id: z.string().nullable(),
  completion_data: z.unknown(),
});

interface SkippedFile {
  taskId: string;
  name: string;
  reason: 'no-storage-path' | 'not-a-task-object';
}

function ensureAdminApp(): App {
  if (getApps().length > 0) return getApp();
  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
    process.env.GOOGLE_CLOUD_PROJECT;
  initializeApp(projectId !== undefined ? { projectId } : {});
  return getApp();
}

/** Read legacy task-attachment metadata from Postgres `human_tasks`. */
async function readTaskAttachments(
  client: ReturnType<typeof createPostgresClient>['client'],
): Promise<{ attachments: LegacyTaskAttachment[]; skipped: SkippedFile[] }> {
  const rows = await client`
    select id, workspace, assigned_user_id, completion_data
    from human_tasks
    where completion_data is not null
  `;

  const attachments: LegacyTaskAttachment[] = [];
  const skipped: SkippedFile[] = [];

  for (const raw of rows) {
    const row = HumanTaskRowSchema.parse(raw);
    const completion = StoredCompletionSchema.safeParse(row.completion_data);
    if (!completion.success) continue; // not an upload completion

    const uploadedBy =
      completion.data.completedBy ?? row.assigned_user_id ?? SYSTEM_UPLOADER;

    for (const file of completion.data.files) {
      if (file.storagePath == null) {
        skipped.push({ taskId: row.id, name: file.name, reason: 'no-storage-path' });
        continue;
      }
      if (!file.storagePath.startsWith(TASK_PREFIX)) {
        skipped.push({ taskId: row.id, name: file.name, reason: 'not-a-task-object' });
        continue;
      }
      attachments.push({
        storagePath: file.storagePath,
        taskId: row.id,
        workspace: row.workspace,
        name: file.name,
        contentType: file.type.length > 0 ? file.type : 'application/octet-stream',
        sizeBytes: Math.round(file.size),
        uploadedBy,
      });
    }
  }

  return { attachments, skipped };
}

function printReport(
  report: MigrationReport,
  skipped: SkippedFile[],
): void {
  const verb = report.dryRun ? 'WOULD migrate' : 'Migrated';
  console.log(`\n=== Firebase attachment migration ${report.dryRun ? '(DRY RUN)' : ''} ===`);
  console.log(`${verb}:            ${report.migrated.length}`);
  console.log(`Already migrated:   ${report.skipped.length}`);
  console.log(`Download failures:  ${report.failed.length}`);
  console.log(`Abandoned skills:   ${report.abandonedSkillFiles}`);
  console.log(`Unmigratable files: ${skipped.length}`);

  if (report.failed.length > 0) {
    console.log('\n--- Download failures ---');
    for (const failure of report.failed) {
      console.log(`  ${failure.storagePath}: ${failure.error}`);
    }
  }
  if (skipped.length > 0) {
    console.log('\n--- Unmigratable files (no/invalid storagePath) ---');
    for (const entry of skipped) {
      console.log(`  task=${entry.taskId} name=${entry.name} (${entry.reason})`);
    }
  }
  console.log('');
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (bucketName === undefined || bucketName.length === 0) {
    throw new Error('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET is not set.');
  }

  const { client, db } = createPostgresClient();
  const bucket = getStorage(ensureAdminApp()).bucket(bucketName);

  try {
    const { attachments, skipped } = await readTaskAttachments(client);

    const [skillFiles] = await bucket.getFiles({ prefix: SKILL_PREFIX });
    const abandonedSkillPaths = skillFiles.map((file) => file.name);

    const legacyExport: FirebaseAttachmentExport = {
      taskAttachments: attachments,
      abandonedSkillPaths,
    };

    const report = await copyFirebaseAttachments(
      legacyExport,
      {
        blobStore: new FilesystemBlobStore(),
        repository: new PostgresTaskAttachmentRepository(db),
        download: async (storagePath: string) => {
          const [bytes] = await bucket.file(storagePath).download();
          return bytes;
        },
      },
      { dryRun },
    );

    printReport(report, skipped);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
