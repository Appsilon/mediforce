import { describe, expect, it } from 'vitest';
import {
  InMemoryBlobStore,
  InMemoryTaskAttachmentRepository,
} from '@mediforce/platform-core/testing';
import {
  blobKeyForStoragePath,
  copyFirebaseAttachments,
  type FirebaseAttachmentExport,
  type LegacyTaskAttachment,
} from './copy-firebase-attachments';

function legacy(
  overrides: Partial<LegacyTaskAttachment> = {},
): LegacyTaskAttachment {
  return {
    storagePath: 'tasks/task-1/uuid_protocol.pdf',
    taskId: 'task-1',
    workspace: 'acme',
    name: 'protocol.pdf',
    contentType: 'application/pdf',
    sizeBytes: 1024,
    uploadedBy: 'firebase-uid-1',
    ...overrides,
  };
}

function exportWith(
  taskAttachments: LegacyTaskAttachment[],
  abandonedSkillPaths: string[] = [],
): FirebaseAttachmentExport {
  return { taskAttachments, abandonedSkillPaths };
}

/** Download that returns deterministic bytes derived from the storage path. */
function fakeDownload(storagePath: string): Promise<Buffer> {
  return Promise.resolve(Buffer.from(`bytes::${storagePath}`));
}

describe('copyFirebaseAttachments', () => {
  it('copies each tasks/… object to a blob and a metadata row', async () => {
    const blobStore = new InMemoryBlobStore();
    const repository = new InMemoryTaskAttachmentRepository();
    const a = legacy({ storagePath: 'tasks/task-1/u_a.pdf', name: 'a.pdf' });
    const b = legacy({
      storagePath: 'tasks/task-2/u_b.csv',
      taskId: 'task-2',
      name: 'b.csv',
      contentType: 'text/csv',
      sizeBytes: 2048,
    });

    const report = await copyFirebaseAttachments(
      exportWith([a, b]),
      { blobStore, repository, download: fakeDownload },
    );

    expect(report.migrated).toHaveLength(2);
    expect(report.failed).toHaveLength(0);
    expect(report.skipped).toHaveLength(0);

    const rowsTask1 = await repository.list('task-1');
    expect(rowsTask1).toHaveLength(1);
    expect(rowsTask1[0]).toMatchObject({
      taskId: 'task-1',
      workspace: 'acme',
      name: 'a.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
      uploadedBy: 'firebase-uid-1',
      blobKey: blobKeyForStoragePath('tasks/task-1/u_a.pdf'),
    });

    const blobKeyA = blobKeyForStoragePath('tasks/task-1/u_a.pdf');
    expect(blobStore.getBytes(blobKeyA)).toEqual(
      Buffer.from('bytes::tasks/task-1/u_a.pdf'),
    );
    expect(blobStore.size).toBe(2);
  });

  it('is idempotent on blob_key — re-running creates no duplicate rows or blobs', async () => {
    const blobStore = new InMemoryBlobStore();
    const repository = new InMemoryTaskAttachmentRepository();
    const entries = [legacy(), legacy({ storagePath: 'tasks/task-1/u_b.pdf' })];

    const first = await copyFirebaseAttachments(exportWith(entries), {
      blobStore,
      repository,
      download: fakeDownload,
    });
    expect(first.migrated).toHaveLength(2);

    const second = await copyFirebaseAttachments(exportWith(entries), {
      blobStore,
      repository,
      download: fakeDownload,
    });

    expect(second.migrated).toHaveLength(0);
    expect(second.skipped).toHaveLength(2);
    expect(second.skipped.every((s) => s.reason === 'already-migrated')).toBe(
      true,
    );
    expect(await repository.list('task-1')).toHaveLength(2);
    expect(blobStore.size).toBe(2);
  });

  it('abandons agentSkills/… objects, counting them without writing', async () => {
    const blobStore = new InMemoryBlobStore();
    const repository = new InMemoryTaskAttachmentRepository();

    const report = await copyFirebaseAttachments(
      exportWith(
        [legacy()],
        ['agentSkills/agent-1/skill-a.md', 'agentSkills/agent-1/skill-b.md'],
      ),
      { blobStore, repository, download: fakeDownload },
    );

    expect(report.abandonedSkillFiles).toBe(2);
    expect(report.migrated).toHaveLength(1);
    // Only the task attachment produced a blob — skill files are abandoned.
    expect(blobStore.size).toBe(1);
  });

  it('reports download failures instead of dropping them', async () => {
    const blobStore = new InMemoryBlobStore();
    const repository = new InMemoryTaskAttachmentRepository();
    const good = legacy({ storagePath: 'tasks/task-1/good.pdf' });
    const bad = legacy({ storagePath: 'tasks/task-1/missing.pdf' });

    const download = (storagePath: string): Promise<Buffer> => {
      if (storagePath === 'tasks/task-1/missing.pdf') {
        return Promise.reject(new Error('404 Not Found'));
      }
      return fakeDownload(storagePath);
    };

    const report = await copyFirebaseAttachments(exportWith([good, bad]), {
      blobStore,
      repository,
      download,
    });

    expect(report.migrated).toHaveLength(1);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]).toMatchObject({
      storagePath: 'tasks/task-1/missing.pdf',
      error: '404 Not Found',
    });
    // Failed download wrote neither blob nor row.
    expect(blobStore.size).toBe(1);
    expect(await repository.list('task-1')).toHaveLength(1);
  });

  it('dry-run previews the plan without writing blobs or rows', async () => {
    const blobStore = new InMemoryBlobStore();
    const repository = new InMemoryTaskAttachmentRepository();
    const entries = [legacy(), legacy({ storagePath: 'tasks/task-1/u_b.pdf' })];

    const report = await copyFirebaseAttachments(
      exportWith(entries, ['agentSkills/x.md']),
      { blobStore, repository, download: fakeDownload },
      { dryRun: true },
    );

    expect(report.dryRun).toBe(true);
    expect(report.migrated).toHaveLength(2);
    expect(report.abandonedSkillFiles).toBe(1);
    expect(blobStore.size).toBe(0);
    expect(await repository.list('task-1')).toHaveLength(0);
  });

  it('dry-run flags already-migrated entries as skipped', async () => {
    const blobStore = new InMemoryBlobStore();
    const repository = new InMemoryTaskAttachmentRepository();
    const entries = [legacy()];

    await copyFirebaseAttachments(exportWith(entries), {
      blobStore,
      repository,
      download: fakeDownload,
    });

    const preview = await copyFirebaseAttachments(
      exportWith(entries),
      { blobStore, repository, download: fakeDownload },
      { dryRun: true },
    );

    expect(preview.migrated).toHaveLength(0);
    expect(preview.skipped).toHaveLength(1);
    expect(preview.skipped[0].reason).toBe('already-migrated');
  });
});
