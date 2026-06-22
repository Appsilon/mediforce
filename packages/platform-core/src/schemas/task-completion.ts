import { z } from 'zod';

// Lives in platform-core so workflow-engine + platform-api can share the
// type without an upward dep cycle.

export const AttachmentSchema = z.object({
  name: z.string().min(1),
  size: z.number().positive(),
  type: z.string().min(1),
  storagePath: z.string().optional(),
  downloadUrl: z.string().optional(),
});

export const AssignmentItemSchema = z.object({
  itemId: z.string().min(1),
  assigneeId: z.string().min(1),
  assigneeKind: z.enum(['human', 'agent']),
  priority: z.string(),
  note: z.string().optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
});

export const TableEditorRowSchema = z.object({
  itemId: z.string().min(1),
  values: z.record(z.string(), z.unknown()),
});

// .strict() so typos like `selectedIndices` fail parse instead of dropping.
export const CompleteHumanTaskPayloadSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('verdict'),
      verdict: z.string().min(1),
      comment: z.string().optional(),
      selectedIndex: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('params'),
      paramValues: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      kind: z.literal('verdict-with-params'),
      verdict: z.string().min(1),
      comment: z.string().optional(),
      paramValues: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      kind: z.literal('upload'),
      attachments: z.array(AttachmentSchema).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('assignment'),
      assignments: z.array(AssignmentItemSchema).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('rows'),
      rows: z.array(TableEditorRowSchema).min(1),
    })
    .strict(),
]);

export type Attachment = z.infer<typeof AttachmentSchema>;
export type AssignmentItem = z.infer<typeof AssignmentItemSchema>;
export type TableEditorRow = z.infer<typeof TableEditorRowSchema>;
export type CompleteHumanTaskPayload = z.infer<typeof CompleteHumanTaskPayloadSchema>;
