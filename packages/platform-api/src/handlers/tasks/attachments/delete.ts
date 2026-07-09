import type {
  DeleteAttachmentInput,
  DeleteAttachmentOutput,
} from '../../../contract/task-attachment';
import type { CallerScope } from '../../../repositories/index';
import { actorFromCaller, loadOr404 } from '../../_helpers';

/**
 * Soft-delete a task attachment (ADR-0003 §7): flag the metadata row and keep
 * the blob — garbage collection of orphaned bytes is a later sweep. Returns the
 * soft-deleted row (entity echo). A row outside the caller's workspaces is 404.
 */
export async function deleteAttachment(
  input: DeleteAttachmentInput,
  scope: CallerScope,
): Promise<DeleteAttachmentOutput> {
  const attachment = await loadOr404(
    scope.attachments.getById(input.attachmentId),
    'Attachment not found',
  );
  await scope.attachments.delete(input.attachmentId);
  const deleted = await loadOr404(
    scope.attachments.getById(input.attachmentId),
    'Attachment not found',
  );

  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: 'task.attachment_deleted',
    description: `Attachment '${attachment.name}' removed from task '${attachment.taskId}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: { taskId: attachment.taskId, attachmentId: attachment.id },
    outputSnapshot: { deletedAt: deleted.deletedAt },
    basis: 'User deleted a task attachment via API',
    entityType: 'taskAttachment',
    entityId: attachment.id,
    namespace: attachment.workspace,
  });

  return { attachment: deleted };
}
