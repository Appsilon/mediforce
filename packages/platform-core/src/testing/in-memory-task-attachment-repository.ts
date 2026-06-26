import { randomUUID } from 'node:crypto';
import {
  NewTaskAttachmentSchema,
  TaskAttachmentSchema,
  type NewTaskAttachment,
  type TaskAttachment,
} from '../schemas/task-attachment';
import type { TaskAttachmentRepository } from '../interfaces/task-attachment-repository';

/**
 * In-memory `TaskAttachmentRepository` for tests. Plain `Map` storage; parses
 * on write to mirror the Postgres backend (ADR-0001 Implementation pattern 2).
 */
export class InMemoryTaskAttachmentRepository implements TaskAttachmentRepository {
  private readonly attachments = new Map<string, TaskAttachment>();

  async list(taskId: string): Promise<TaskAttachment[]> {
    return [...this.attachments.values()]
      .filter((a) => a.taskId === taskId && a.deletedAt === null)
      .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt))
      .map((a) => ({ ...a }));
  }

  async create(input: NewTaskAttachment): Promise<TaskAttachment> {
    const parsedInput = NewTaskAttachmentSchema.parse(input);
    const attachment = TaskAttachmentSchema.parse({
      ...parsedInput,
      id: randomUUID(),
      uploadedAt: new Date().toISOString(),
      deletedAt: null,
    });
    this.attachments.set(attachment.id, attachment);
    return { ...attachment };
  }

  async getById(attachmentId: string): Promise<TaskAttachment | null> {
    const attachment = this.attachments.get(attachmentId);
    return attachment ? { ...attachment } : null;
  }

  async delete(attachmentId: string): Promise<void> {
    const attachment = this.attachments.get(attachmentId);
    if (attachment === undefined || attachment.deletedAt !== null) return;
    this.attachments.set(attachmentId, {
      ...attachment,
      deletedAt: new Date().toISOString(),
    });
  }

  /** Test helper: clear all stored data. */
  clear(): void {
    this.attachments.clear();
  }
}
