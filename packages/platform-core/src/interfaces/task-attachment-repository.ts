import type { NewTaskAttachment, TaskAttachment } from '../schemas/task-attachment';

/**
 * Metadata store for task attachments (ADR-0003). Each row carries its own
 * `workspace`, so workspace gating lives in the `AuthorizedTaskAttachmentRepository`
 * wrapper (platform-api) via `canSeeNamespace` on the row — no parent lookup,
 * no `*InNamespaces` variants on this interface.
 *
 * Bytes are NOT here — they live in the `BlobStore`, keyed by `blobKey`.
 */
export interface TaskAttachmentRepository {
  /** Active (non-deleted) attachments for a task, oldest first. */
  list(taskId: string): Promise<TaskAttachment[]>;
  create(input: NewTaskAttachment): Promise<TaskAttachment>;
  /** A single attachment by id, including soft-deleted rows (caller filters). */
  getById(attachmentId: string): Promise<TaskAttachment | null>;
  /** Soft-delete: flag the row, keep the blob (ADR-0003 §7). */
  delete(attachmentId: string): Promise<void>;
}
