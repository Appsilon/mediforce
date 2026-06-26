import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTaskAttachmentRepository } from '@mediforce/platform-core/testing';
import type { TaskAttachment } from '@mediforce/platform-core';
import type { CallerIdentity } from '../../auth';
import { ForbiddenError, NotFoundError } from '../../errors';
import { AuthorizedTaskAttachmentRepository } from '../authorized-task-attachment-repository';
import { userCaller } from './create-test-scope';

const apiKeyCaller: CallerIdentity = { kind: 'apiKey', isSystemActor: true };

async function seed(
  raw: InMemoryTaskAttachmentRepository,
  workspace: string,
  taskId: string,
): Promise<TaskAttachment> {
  return raw.create({
    taskId,
    workspace,
    name: 'f.txt',
    contentType: 'text/plain',
    sizeBytes: 3,
    blobKey: `blob-${workspace}-${taskId}`,
    uploadedBy: 'uid-1',
  });
}

describe('AuthorizedTaskAttachmentRepository', () => {
  let raw: InMemoryTaskAttachmentRepository;

  beforeEach(() => {
    raw = new InMemoryTaskAttachmentRepository();
  });

  it('list hides rows from workspaces the caller is not a member of', async () => {
    await seed(raw, 'ws-1', 'task-1');
    await seed(raw, 'ws-2', 'task-1');

    const member = new AuthorizedTaskAttachmentRepository(userCaller('u', ['ws-1']), raw);
    const rows = await member.list('task-1');
    expect(rows.map((r) => r.workspace)).toEqual(['ws-1']);
  });

  it('getById returns null for a foreign-workspace row (anti-enumeration)', async () => {
    const created = await seed(raw, 'ws-1', 'task-1');
    const foreign = new AuthorizedTaskAttachmentRepository(userCaller('u', ['ws-2']), raw);
    expect(await foreign.getById(created.id)).toBeNull();
  });

  it('create rejects a write outside the caller workspaces', async () => {
    const outsider = new AuthorizedTaskAttachmentRepository(userCaller('u', ['ws-2']), raw);
    await expect(
      outsider.create({
        taskId: 'task-1',
        workspace: 'ws-1',
        name: 'f.txt',
        contentType: 'text/plain',
        sizeBytes: 3,
        blobKey: 'k',
        uploadedBy: 'u',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('delete 404s for a foreign-workspace row and never touches the raw store', async () => {
    const created = await seed(raw, 'ws-1', 'task-1');
    const foreign = new AuthorizedTaskAttachmentRepository(userCaller('u', ['ws-2']), raw);
    await expect(foreign.delete(created.id)).rejects.toBeInstanceOf(NotFoundError);
    const stillActive = await raw.getById(created.id);
    expect(stillActive?.deletedAt).toBeNull();
  });

  it('system actor sees and mutates every workspace', async () => {
    const a = await seed(raw, 'ws-1', 'task-1');
    await seed(raw, 'ws-2', 'task-1');
    const system = new AuthorizedTaskAttachmentRepository(apiKeyCaller, raw);
    expect(await system.list('task-1')).toHaveLength(2);
    await system.delete(a.id);
    expect((await raw.getById(a.id))?.deletedAt).not.toBeNull();
  });
});
