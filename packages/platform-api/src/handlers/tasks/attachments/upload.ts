import { randomUUID } from 'node:crypto';
import type {
  UploadAttachmentInput,
  UploadAttachmentOutput,
} from '../../../contract/task-attachment';
import type { CallerScope } from '../../../repositories/index';
import { NotFoundError, ValidationError } from '../../../errors';
import { actorFromCaller, loadOr404 } from '../../_helpers';
import { attachmentMaxBytes } from './_limits';

/**
 * Upload a file to a Human Task (ADR-0003). Validates size against
 * `MEDIFORCE_ATTACHMENT_MAX_BYTES`, writes the bytes to the `BlobStore` under a
 * fresh `blobKey`, then writes the workspace-gated `task_attachments` row.
 *
 * Workspace is resolved from the parent run (`scope.runs.getById`) — a Human
 * Task carries no namespace of its own. A task the caller can't see surfaces
 * as 404 via the workspace-gated `scope.tasks` / `scope.runs` reads.
 */
export async function uploadAttachment(
  input: UploadAttachmentInput,
  scope: CallerScope,
): Promise<UploadAttachmentOutput> {
  const sizeBytes = input.content.length;
  const maxBytes = attachmentMaxBytes();
  if (sizeBytes > maxBytes) {
    throw new ValidationError(
      `Attachment is ${sizeBytes} bytes, exceeds the ${maxBytes}-byte limit.`,
      { sizeBytes, maxBytes },
    );
  }

  const task = await loadOr404(scope.tasks.getById(input.taskId), 'Task not found');
  const run = await loadOr404(
    scope.runs.getById(task.processInstanceId),
    'Task not found',
  );
  const workspace = run.namespace;
  if (workspace === undefined) {
    // A run with no namespace can't anchor a workspace-gated attachment row;
    // treat it as unreachable rather than writing an orphaned attachment.
    throw new NotFoundError('Task not found');
  }
  const actor = actorFromCaller(scope);

  const blobKey = randomUUID();
  await scope.system.blobStore.put(blobKey, input.content);

  const attachment = await scope.attachments.create({
    taskId: input.taskId,
    workspace,
    name: input.name,
    contentType: input.contentType,
    sizeBytes,
    blobKey,
    uploadedBy: actor.actorId,
  });

  await scope.system.audit.append({
    ...actor,
    action: 'task.attachment_added',
    description: `Attachment '${input.name}' added to task '${input.taskId}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: { taskId: input.taskId, name: input.name, sizeBytes },
    outputSnapshot: { attachmentId: attachment.id, blobKey },
    basis: 'User uploaded a task attachment via API',
    entityType: 'taskAttachment',
    entityId: attachment.id,
    processInstanceId: task.processInstanceId,
  });

  return { attachment };
}
