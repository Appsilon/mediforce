import type {
  ListAttachmentsInput,
  ListAttachmentsOutput,
} from '../../../contract/task-attachment';
import type { CallerScope } from '../../../repositories/index';
import { loadOr404 } from '../../_helpers';

/**
 * List active attachments for a Human Task (ADR-0003). The task read is
 * workspace-gated, so a task outside the caller's workspaces surfaces as 404
 * before any attachment rows are returned.
 */
export async function listAttachments(
  input: ListAttachmentsInput,
  scope: CallerScope,
): Promise<ListAttachmentsOutput> {
  await loadOr404(scope.tasks.getById(input.taskId), 'Task not found');
  const attachments = await scope.attachments.list(input.taskId);
  return { attachments };
}
