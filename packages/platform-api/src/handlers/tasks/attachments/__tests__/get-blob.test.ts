import { describe, it, expect, beforeEach } from 'vitest';
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
import { NotFoundError } from '../../../../errors';
import { uploadAttachment } from '../upload';
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

describe('getAttachmentBlob', () => {
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

  it('streams byte-identical content', async () => {
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

  it('rejects a soft-deleted attachment (404)', async () => {
    const content = Buffer.from('gone', 'utf-8');
    const { attachment } = await uploadAttachment(
      { taskId: TASK_ID, name: 'gone.txt', contentType: 'text/plain', content },
      scope,
    );
    await deleteAttachment({ attachmentId: attachment.id }, scope);

    await expect(
      getAttachmentBlob({ attachmentId: attachment.id }, scope),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('hides a foreign-workspace attachment (404)', async () => {
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

    await expect(
      getAttachmentBlob({ attachmentId: attachment.id }, foreign),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
