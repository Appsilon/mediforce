import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { BlobStore, TaskAttachmentRepository } from '@mediforce/platform-core';

/**
 * One legacy Firebase Storage `tasks/…` object to migrate, joined with the
 * metadata recovered from the owning Human Task's completion payload
 * (`human_tasks.completion_data.files[]` — name / size / type / storagePath)
 * plus `completedBy` (the uploader's Firebase uid) and the task's workspace
 * (the `human_tasks.workspace` column, read directly by the migrator shell).
 */
export const LegacyTaskAttachmentSchema = z.object({
  storagePath: z.string().min(1),
  taskId: z.string().min(1),
  workspace: z.string().min(1),
  name: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  uploadedBy: z.string().min(1),
});

export type LegacyTaskAttachment = z.infer<typeof LegacyTaskAttachmentSchema>;

/**
 * The legacy storage picture the migrator copies from. `taskAttachments` come
 * from Human Task completion payloads (each has its metadata); `agentSkills/…`
 * objects have no remaining pointer (the feature was deleted in PR1), so they
 * arrive as bare bucket paths and are abandoned — counted, never copied.
 */
export interface FirebaseAttachmentExport {
  taskAttachments: LegacyTaskAttachment[];
  abandonedSkillPaths: string[];
}

export interface CopyDependencies {
  blobStore: BlobStore;
  repository: TaskAttachmentRepository;
  /** Fetch the bytes for a Firebase Storage object path. */
  download: (storagePath: string) => Promise<Buffer>;
}

export interface CopyOptions {
  /** Preview only: classify entries but write no blobs or rows. */
  dryRun?: boolean;
}

export interface MigratedEntry {
  taskId: string;
  storagePath: string;
  blobKey: string;
  name: string;
}

export interface SkippedEntry {
  storagePath: string;
  reason: 'already-migrated';
}

export interface FailedEntry {
  storagePath: string;
  error: string;
}

export interface MigrationReport {
  dryRun: boolean;
  /** Copied (or, in `dryRun`, would be copied). */
  migrated: MigratedEntry[];
  skipped: SkippedEntry[];
  failed: FailedEntry[];
  abandonedSkillFiles: number;
}

/**
 * Deterministic blob key for a legacy storage path. Stable across runs so the
 * migration is idempotent on `blob_key`: a re-run derives the same key and the
 * existing-row check skips it (PLAN-0003 "Rollback").
 */
export function blobKeyForStoragePath(storagePath: string): string {
  return createHash('sha256').update(storagePath).digest('hex');
}

/**
 * Pure copy logic for ADR-0003 PR3: move legacy Firebase Storage `tasks/…`
 * objects into the new `BlobStore` + `task_attachments` rows. No Firebase, no
 * real database — bytes come from the injected `download`, storage and metadata
 * go through the injected `BlobStore` / `TaskAttachmentRepository`. Idempotent
 * on `blob_key`; download failures are reported, never dropped; `agentSkills/…`
 * objects are abandoned and counted.
 */
export async function copyFirebaseAttachments(
  legacyExport: FirebaseAttachmentExport,
  dependencies: CopyDependencies,
  options: CopyOptions = {},
): Promise<MigrationReport> {
  const dryRun = options.dryRun ?? false;
  const report: MigrationReport = {
    dryRun,
    migrated: [],
    skipped: [],
    failed: [],
    abandonedSkillFiles: legacyExport.abandonedSkillPaths.length,
  };

  for (const raw of legacyExport.taskAttachments) {
    const legacy = LegacyTaskAttachmentSchema.parse(raw);
    const blobKey = blobKeyForStoragePath(legacy.storagePath);

    const existing = await dependencies.repository.list(legacy.taskId);
    if (existing.some((attachment) => attachment.blobKey === blobKey)) {
      report.skipped.push({
        storagePath: legacy.storagePath,
        reason: 'already-migrated',
      });
      continue;
    }

    try {
      if (!dryRun) {
        const bytes = await dependencies.download(legacy.storagePath);
        await dependencies.blobStore.put(blobKey, bytes);
        await dependencies.repository.create({
          taskId: legacy.taskId,
          workspace: legacy.workspace,
          name: legacy.name,
          contentType: legacy.contentType,
          sizeBytes: legacy.sizeBytes,
          blobKey,
          uploadedBy: legacy.uploadedBy,
        });
      }
      report.migrated.push({
        taskId: legacy.taskId,
        storagePath: legacy.storagePath,
        blobKey,
        name: legacy.name,
      });
    } catch (error) {
      report.failed.push({
        storagePath: legacy.storagePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return report;
}
