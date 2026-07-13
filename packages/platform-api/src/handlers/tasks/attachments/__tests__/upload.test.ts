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
import { NotFoundError, ValidationError } from '../../../../errors';
import { uploadAttachment } from '../upload';

const WORKSPACE = 'ws-1';
const INSTANCE_ID = 'inst-attach-1';
const TASK_ID = 'task-attach-1';

describe('uploadAttachment', () => {
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

  it('writes a metadata row + bytes to the blob store', async () => {
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

  it('hides a foreign-workspace task (404)', async () => {
    const foreign = createTestScope({
      caller: userCaller('uid-intruder', ['ws-other']),
      instanceRepo,
      humanTaskRepo,
      blobStore,
      taskAttachmentRepo: attachmentRepo,
    });

    await expect(
      uploadAttachment(
        {
          taskId: TASK_ID,
          name: 'x',
          contentType: 'text/plain',
          content: Buffer.from('secret', 'utf-8'),
        },
        foreign,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
