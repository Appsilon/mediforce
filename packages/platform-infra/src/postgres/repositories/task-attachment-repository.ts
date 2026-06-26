import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  NewTaskAttachmentSchema,
  TaskAttachmentSchema,
  parseRow,
  type NewTaskAttachment,
  type TaskAttachment,
  type TaskAttachmentRepository,
} from '@mediforce/platform-core';
import type { Database } from '../client';
import { taskAttachments } from '../schema/task-attachment';

/**
 * Postgres-backed `TaskAttachmentRepository` (ADR-0003, PLAN-0003 §2.2).
 *
 * Bytes live in a `BlobStore` keyed by `blobKey`; this repo owns only the
 * metadata row. `workspace` is stored on the row, so workspace gating lives in
 * the `AuthorizedTaskAttachmentRepository` wrapper (platform-api) — no parent
 * lookup, no `*InNamespaces` variants here.
 *
 * Soft-delete via `deleted_at` (NULL = active). `list` excludes tombstones;
 * `getById` returns tombstoned rows so callers can detect soft-deletion.
 *
 * Validation matches the in-memory backend: parse on every read AND every
 * write (ADR-0001 Implementation pattern 2).
 */
export class PostgresTaskAttachmentRepository
  implements TaskAttachmentRepository
{
  constructor(private readonly db: Database) {}

  async list(taskId: string): Promise<TaskAttachment[]> {
    const rows = await this.db
      .select()
      .from(taskAttachments)
      .where(
        and(
          eq(taskAttachments.taskId, taskId),
          isNull(taskAttachments.deletedAt),
        ),
      )
      .orderBy(asc(taskAttachments.uploadedAt));
    return rows.map((row) => toTaskAttachment(row));
  }

  async create(input: NewTaskAttachment): Promise<TaskAttachment> {
    const parsed = NewTaskAttachmentSchema.parse(input);
    const [row] = await this.db
      .insert(taskAttachments)
      .values({
        taskId: parsed.taskId,
        workspace: parsed.workspace,
        name: parsed.name,
        contentType: parsed.contentType,
        sizeBytes: parsed.sizeBytes,
        blobKey: parsed.blobKey,
        uploadedBy: parsed.uploadedBy,
      })
      .returning();
    return toTaskAttachment(row);
  }

  async getById(attachmentId: string): Promise<TaskAttachment | null> {
    const rows = await this.db
      .select()
      .from(taskAttachments)
      .where(eq(taskAttachments.id, attachmentId))
      .limit(1);
    const row = rows[0];
    return row ? toTaskAttachment(row) : null;
  }

  async delete(attachmentId: string): Promise<void> {
    // Re-delete is a no-op: the `deleted_at IS NULL` guard preserves the
    // original tombstone timestamp, matching the in-memory backend.
    await this.db
      .update(taskAttachments)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(taskAttachments.id, attachmentId),
          isNull(taskAttachments.deletedAt),
        ),
      );
  }
}

function toTaskAttachment(
  row: typeof taskAttachments.$inferSelect,
): TaskAttachment {
  return parseRow(TaskAttachmentSchema, {
    id: row.id,
    taskId: row.taskId,
    workspace: row.workspace,
    name: row.name,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    blobKey: row.blobKey,
    uploadedBy: row.uploadedBy,
    uploadedAt: row.uploadedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  });
}
