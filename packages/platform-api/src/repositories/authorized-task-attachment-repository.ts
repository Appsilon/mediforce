import type {
  NewTaskAttachment,
  TaskAttachment,
  TaskAttachmentRepository,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth';
import { NotFoundError } from '../errors';
import { AuthorizedScope } from './authorized-repository';

/**
 * Workspace-scoped task-attachment metadata access (ADR-0003 / ADR-0004).
 *
 * Each `task_attachments` row carries its own `workspace`, so gating is a
 * direct `canSeeNamespace(row.workspace)` predicate — no parent lookup. Reads
 * outside the caller's workspaces return empty / null (anti-enumeration);
 * writes assert membership first.
 *
 * The bytes themselves are NOT gated here — they flow through
 * `scope.system.blobStore`, keyed by `blobKey`. A caller can only learn a
 * `blobKey` by reading an attachment row through this gate, so the metadata
 * layer is the authorization boundary for the unscoped blob store.
 */
export class AuthorizedTaskAttachmentRepository extends AuthorizedScope {
  constructor(
    caller: CallerIdentity,
    private readonly raw: TaskAttachmentRepository,
  ) {
    super(caller);
  }

  list = async (taskId: string): Promise<TaskAttachment[]> => {
    const rows = await this.raw.list(taskId);
    return rows.filter((row) => this.canSeeNamespace(row.workspace));
  };

  getById = async (attachmentId: string): Promise<TaskAttachment | null> => {
    const row = await this.raw.getById(attachmentId);
    if (row === null || !this.canSeeNamespace(row.workspace)) return null;
    return row;
  };

  create = async (input: NewTaskAttachment): Promise<TaskAttachment> => {
    this.assertNamespaceWrite(input.workspace);
    return this.raw.create(input);
  };

  delete = async (attachmentId: string): Promise<void> => {
    const row = await this.raw.getById(attachmentId);
    if (row === null || !this.canSeeNamespace(row.workspace)) {
      throw new NotFoundError(`Attachment ${attachmentId} not found`);
    }
    this.assertNamespaceWrite(row.workspace);
    await this.raw.delete(attachmentId);
  };
}
