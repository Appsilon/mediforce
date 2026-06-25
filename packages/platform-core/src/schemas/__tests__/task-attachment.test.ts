import { describe, it, expect } from 'vitest';
import {
  TaskAttachmentSchema,
  NewTaskAttachmentSchema,
} from '../task-attachment';

const validRow = {
  id: '00000000-0000-4000-8000-000000000001',
  taskId: 'task-1',
  workspace: 'ws-1',
  name: 'dataset.csv',
  contentType: 'text/csv',
  sizeBytes: 2048,
  blobKey: 'blob-key-1',
  uploadedBy: 'uid-uploader',
  uploadedAt: '2026-06-22T10:00:00.000Z',
  deletedAt: null,
};

describe('TaskAttachmentSchema', () => {
  it('parses a valid attachment row', () => {
    const parsed = TaskAttachmentSchema.parse(validRow);
    expect(parsed).toEqual(validRow);
  });

  it('accepts a soft-deleted row (deletedAt set)', () => {
    const parsed = TaskAttachmentSchema.parse({
      ...validRow,
      deletedAt: '2026-06-22T11:00:00.000Z',
    });
    expect(parsed.deletedAt).toBe('2026-06-22T11:00:00.000Z');
  });

  it('rejects a non-uuid id', () => {
    expect(() => TaskAttachmentSchema.parse({ ...validRow, id: 'not-a-uuid' })).toThrow();
  });

  it('rejects an empty name', () => {
    expect(() => TaskAttachmentSchema.parse({ ...validRow, name: '' })).toThrow();
  });

  it('rejects a negative size', () => {
    expect(() => TaskAttachmentSchema.parse({ ...validRow, sizeBytes: -1 })).toThrow();
  });

  it('rejects a non-integer size', () => {
    expect(() => TaskAttachmentSchema.parse({ ...validRow, sizeBytes: 1.5 })).toThrow();
  });

  it('requires deletedAt to be present (null or datetime)', () => {
    const { deletedAt, ...withoutDeletedAt } = validRow;
    expect(() => TaskAttachmentSchema.parse(withoutDeletedAt)).toThrow();
  });
});

describe('NewTaskAttachmentSchema', () => {
  it('omits id / uploadedAt / deletedAt', () => {
    const input = {
      taskId: 'task-1',
      workspace: 'ws-1',
      name: 'dataset.csv',
      contentType: 'text/csv',
      sizeBytes: 2048,
      blobKey: 'blob-key-1',
      uploadedBy: 'uid-uploader',
    };
    const parsed = NewTaskAttachmentSchema.parse(input);
    expect(parsed).toEqual(input);
    expect('id' in parsed).toBe(false);
    expect('uploadedAt' in parsed).toBe(false);
    expect('deletedAt' in parsed).toBe(false);
  });

  it('strips unknown extra keys are not added (id ignored)', () => {
    const parsed = NewTaskAttachmentSchema.parse({
      taskId: 'task-1',
      workspace: 'ws-1',
      name: 'a.txt',
      contentType: 'text/plain',
      sizeBytes: 1,
      blobKey: 'k',
      uploadedBy: 'uid',
      id: 'ignored',
    } as Record<string, unknown>);
    expect('id' in parsed).toBe(false);
  });
});
