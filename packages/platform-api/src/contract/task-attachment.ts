import { z } from 'zod';
import { TaskAttachmentSchema } from '@mediforce/platform-core';

/**
 * Contracts for the task-attachment endpoints (ADR-0003).
 *
 *   GET    /api/tasks/:taskId/attachments      → list
 *   POST   /api/tasks/:taskId/attachments      → upload (multipart/form-data)
 *   GET    /api/attachments/:attachmentId/blob → stream bytes (binary, no JSON)
 *   DELETE /api/attachments/:attachmentId      → soft-delete
 *
 * The blob endpoints carry raw bytes, not the JSON envelope, so they ride
 * custom routes (auth + scope pipeline identical) rather than `createRouteAdapter`.
 */

export const ListAttachmentsInputSchema = z.object({
  taskId: z.string().min(1),
});

export const ListAttachmentsOutputSchema = z.object({
  attachments: z.array(TaskAttachmentSchema),
});

export type ListAttachmentsInput = z.infer<typeof ListAttachmentsInputSchema>;
export type ListAttachmentsOutput = z.infer<typeof ListAttachmentsOutputSchema>;

/**
 * Upload input. `content` is the raw file bytes — a `Buffer`, validated via
 * `z.custom` so the schema module stays safe to import in the browser (the
 * predicate runs only when `.parse` is called, server-side). `sizeBytes` is
 * derived from `content` by the handler, never trusted from the client.
 */
export const UploadAttachmentInputSchema = z.object({
  taskId: z.string().min(1),
  name: z.string().min(1),
  contentType: z.string().min(1),
  content: z.custom<Buffer>(
    (value) => Buffer.isBuffer(value),
    'content must be a Buffer',
  ),
});

export const UploadAttachmentOutputSchema = z.object({
  attachment: TaskAttachmentSchema,
});

export type UploadAttachmentInput = z.infer<typeof UploadAttachmentInputSchema>;
export type UploadAttachmentOutput = z.infer<typeof UploadAttachmentOutputSchema>;

export const DeleteAttachmentInputSchema = z.object({
  attachmentId: z.string().min(1),
});

export const DeleteAttachmentOutputSchema = z.object({
  attachment: TaskAttachmentSchema,
});

export type DeleteAttachmentInput = z.infer<typeof DeleteAttachmentInputSchema>;
export type DeleteAttachmentOutput = z.infer<typeof DeleteAttachmentOutputSchema>;

/** Input for the binary blob stream route (path-derived). */
export const GetAttachmentBlobInputSchema = z.object({
  attachmentId: z.string().min(1),
});

export type GetAttachmentBlobInput = z.infer<typeof GetAttachmentBlobInputSchema>;
