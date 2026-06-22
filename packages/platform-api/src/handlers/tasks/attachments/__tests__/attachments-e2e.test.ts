import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Readable } from 'node:stream';
import {
  InMemoryBlobStore,
  InMemoryHumanTaskRepository,
  InMemoryProcessInstanceRepository,
  InMemoryTaskAttachmentRepository,
  buildHumanTask,
  buildProcessInstance,
} from '@mediforce/platform-core/testing';
import { createTestScope, userCaller } from '../../../../repositories/__tests__/create-test-scope';
import type { CallerScope } from '../../../../repositories/index';
import { NotFoundError, ValidationError } from '../../../../errors';
import { uploadAttachment } from '../upload';
import { listAttachments } from '../list';
import { deleteAttachment } from '../delete';
import { getAttachmentBlob } from '../get-blob';

const WORKSPACE = 'ws-1';
const INSTANCE_ID = 'inst-attach-1';
const TASK_ID = 'task-attach-1';

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * L3 API E2E for ADR-0003 PR2: drives the upload → list → get-blob → delete
 * handlers through a real `CallerScope` over in-memory repos + blob store —
 * proving the whole slice (metadata repo + authz wrapper + blob store + audit)
 * is wired end-to-end. The route adapters are thin (PR scope); this is the
 * caller that proves the path is live.
 */
describe('task attachments — handler E2E', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;
  let humanTaskRepo: InMemoryHumanTaskRepository;
  let blobStore: InMemoryBlobStore;
  let attachmentRepo: InMemoryTaskAttachmentRepository;
  let scope: CallerScope;

  beforeEach(async () => {
    instanceRepo = new InMemoryProcessInstanceRepository();
    humanTaskRepo = new InMemoryHumanTaskRepository(instanceRepo);
    blobStore = new InMemoryBlobStore();
    attachmentRepo = new InMemoryTaskAttachmentRepository();

    await instanceRepo.create(
      buildProcessInstance({ id: INSTANCE_ID, namespace: WORKSPACE }),
    );
    await humanTaskRepo.create(
      buildHumanTask({ id: TASK_ID, processInstanceId: INSTANCE_ID }),
    );

    scope = createTestScope({
      caller: userCaller('uid-uploader', [WORKSPACE]),
      instanceRepo,
      humanTaskRepo,
      blobStore,
      taskAttachmentRepo: attachmentRepo,
    });
  });

  it('upload writes a metadata row + bytes to the blob store', async () => {
    const content = Buffer.from('drug-name,grade\naspirin,2\n', 'utf-8');
    const { attachment } = await uploadAttachment(
      { taskId: TASK_ID, name: 'ae.csv', contentType: 'text/csv', content },
      scope,
    );

    expect(attachment.taskId).toBe(TASK_ID);
    expect(attachment.workspace).toBe(WORKSPACE);
    expect(attachment.name).toBe('ae.csv');
    expect(attachment.contentType).toBe('text/csv');
    expect(attachment.sizeBytes).toBe(content.length);
    expect(attachment.uploadedBy).toBe('uid-uploader');
    expect(attachment.deletedAt).toBeNull();

    // Bytes live in the blob store under blobKey, not in the metadata.
    expect(blobStore.getBytes(attachment.blobKey)).toEqual(content);

    const { attachments } = await listAttachments({ taskId: TASK_ID }, scope);
    expect(attachments.map((a) => a.id)).toEqual([attachment.id]);
  });

  it('get-blob streams byte-identical content', async () => {
    const content = Buffer.from('a'.repeat(5000), 'utf-8');
    const { attachment } = await uploadAttachment(
      { taskId: TASK_ID, name: 'big.txt', contentType: 'text/plain', content },
      scope,
    );

    const result = await getAttachmentBlob({ attachmentId: attachment.id }, scope);
    expect(result.attachment.id).toBe(attachment.id);
    const roundTripped = await readAll(result.stream);
    expect(roundTripped).toEqual(content);
  });

  it('rejects an oversize upload', async () => {
    const prev = process.env.MEDIFORCE_ATTACHMENT_MAX_BYTES;
    process.env.MEDIFORCE_ATTACHMENT_MAX_BYTES = '10';
    try {
      await expect(
        uploadAttachment(
          {
            taskId: TASK_ID,
            name: 'too-big.bin',
            contentType: 'application/octet-stream',
            content: Buffer.alloc(20),
          },
          scope,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    } finally {
      if (prev === undefined) delete process.env.MEDIFORCE_ATTACHMENT_MAX_BYTES;
      else process.env.MEDIFORCE_ATTACHMENT_MAX_BYTES = prev;
    }
  });

  it('hides attachments from a foreign workspace (404)', async () => {
    const content = Buffer.from('secret', 'utf-8');
    const { attachment } = await uploadAttachment(
      { taskId: TASK_ID, name: 's.txt', contentType: 'text/plain', content },
      scope,
    );

    const foreign = createTestScope({
      caller: userCaller('uid-intruder', ['ws-other']),
      instanceRepo,
      humanTaskRepo,
      blobStore,
      taskAttachmentRepo: attachmentRepo,
    });

    await expect(listAttachments({ taskId: TASK_ID }, foreign)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      getAttachmentBlob({ attachmentId: attachment.id }, foreign),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      deleteAttachment({ attachmentId: attachment.id }, foreign),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      uploadAttachment(
        { taskId: TASK_ID, name: 'x', contentType: 'text/plain', content },
        foreign,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('delete is soft: row flagged, blob retained, get-blob 404s', async () => {
    const content = Buffer.from('keep-my-bytes', 'utf-8');
    const { attachment } = await uploadAttachment(
      { taskId: TASK_ID, name: 'd.txt', contentType: 'text/plain', content },
      scope,
    );

    const { attachment: deleted } = await deleteAttachment(
      { attachmentId: attachment.id },
      scope,
    );
    expect(deleted.deletedAt).not.toBeNull();

    // Blob bytes survive the soft-delete (GC is a later sweep).
    expect(blobStore.getBytes(attachment.blobKey)).toEqual(content);

    // List excludes the soft-deleted row.
    const { attachments } = await listAttachments({ taskId: TASK_ID }, scope);
    expect(attachments).toHaveLength(0);

    // Bytes are no longer downloadable once soft-deleted.
    await expect(
      getAttachmentBlob({ attachmentId: attachment.id }, scope),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
