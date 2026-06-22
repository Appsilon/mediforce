import { sql } from 'drizzle-orm';
import { ATTACHMENT_MAX_BYTES } from '@mediforce/platform-core';
import {
  pgTable,
  text,
  uuid,
  bigint,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { humanTasks } from './human-task';
import { workspaces } from './workspace';

/**
 * Task attachment metadata (ADR-0003, PLAN-0003 §2.2 task_attachments).
 *
 * Bytes live in a `BlobStore` keyed by `blob_key`; this row carries only the
 * metadata. `workspace` is stored directly (FK → `workspaces.handle`) so reads
 * are workspace-gated without a parent lookup — unlike HumanTask, which derives
 * its namespace from the parent ProcessInstance.
 *
 * Soft-delete via `deleted_at` (NULL = active). DELETE flags the row and keeps
 * the blob; blob garbage-collection is a later sweep (ADR-0003 §7).
 *
 * `attachment_size_guard` rejects rows over 100 MiB at the database layer — a
 * backstop independent of the upload-path check.
 */
export const taskAttachments = pgTable(
  'task_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: text('task_id')
      .notNull()
      .references(() => humanTasks.id, { onDelete: 'cascade' }),
    workspace: text('workspace')
      .notNull()
      .references(() => workspaces.handle, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    blobKey: text('blob_key').notNull(),
    uploadedBy: text('uploaded_by').notNull(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Soft-delete tombstone (NULL = active).
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    taskIdx: index('task_attachments_task_idx').on(
      table.taskId,
      table.uploadedAt,
    ),
    workspaceIdx: index('task_attachments_workspace_idx').on(
      table.workspace,
      table.uploadedAt,
    ),
    // Number literal inlined via sql.raw: drizzle would parameterize an
    // interpolated value, which Postgres rejects inside a CHECK expression.
    sizeGuard: check(
      'attachment_size_guard',
      sql.raw(`size_bytes <= ${ATTACHMENT_MAX_BYTES}`),
    ),
  }),
);
