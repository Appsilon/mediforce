import type { Readable } from 'node:stream';
import type { TaskAttachment } from '@mediforce/platform-core';
import type { GetAttachmentBlobInput } from '../../../contract/task-attachment';
import type { CallerScope } from '../../../repositories/index';
import { NotFoundError } from '../../../errors';
import { loadOr404 } from '../../_helpers';

export interface GetAttachmentBlobResult {
  readonly attachment: TaskAttachment;
  readonly stream: Readable;
}

/**
 * Resolve an attachment's bytes for streaming (ADR-0003). The metadata read is
 * workspace-gated (foreign workspace → 404). Soft-deleted rows and rows whose
 * blob is missing from the store also surface as 404. The caller (route
 * adapter) sets `Content-Type` / `Content-Length` / `Content-Disposition` from
 * the returned metadata and streams `stream` without buffering the whole file.
 */
export async function getAttachmentBlob(
  input: GetAttachmentBlobInput,
  scope: CallerScope,
): Promise<GetAttachmentBlobResult> {
  const attachment = await loadOr404(
    scope.attachments.getById(input.attachmentId),
    'Attachment not found',
  );
  if (attachment.deletedAt !== null) {
    throw new NotFoundError('Attachment not found');
  }
  const stream = await scope.system.blobStore.getStream(attachment.blobKey);
  if (stream === null) {
    throw new NotFoundError('Attachment bytes not found');
  }
  return { attachment, stream };
}
