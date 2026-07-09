import { describe, it, expect, beforeEach } from 'vitest';
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
import { listAttachments } from '../list';
import { deleteAttachment } from '../delete';

const WORKSPACE = 'ws-1';
const INSTANCE_ID = 'inst-attach-1';
const TASK_ID = 'task-attach-1';

describe('deleteAttachment', () => {
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

  it('soft-deletes: row flagged, blob retained, list excludes it', async () => {
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

    const { attachments } = await listAttachments({ taskId: TASK_ID }, scope);
    expect(attachments).toHaveLength(0);
  });

  it('hides a foreign-workspace attachment (404)', async () => {
    const { attachment } = await uploadAttachment(
      {
        taskId: TASK_ID,
        name: 's.txt',
        contentType: 'text/plain',
        content: Buffer.from('secret', 'utf-8'),
      },
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
      deleteAttachment({ attachmentId: attachment.id }, foreign),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
