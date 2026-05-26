import { z } from 'zod';

/**
 * Payload shape for completing a `HumanTask` (the body of
 * `POST /api/tasks/:taskId/complete`).
 *
 * Defined here in platform-core so both `workflow-engine` (which validates
 * + applies the payload) and `platform-api` (which exposes the HTTP
 * contract) can import the type without creating an upward dep cycle.
 *
 * Five variants, discriminated by `kind`. The variant MUST match the
 * task's UI component / params configuration; `WorkflowEngine.completeHumanTask`
 * raises `CompleteHumanTaskValidationError` otherwise.
 */

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

// Per-variant objects are `.strict()` so a typo in a sibling field (e.g.
// `selectedIndices` instead of `selectedIndex`) fails parse instead of
// silently dropping. Keeps the wire contract tight; UI/client must send
// exactly the documented shape.
export const CompleteHumanTaskPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('verdict'),
    verdict: z.string().min(1),
    comment: z.string().optional(),
    selectedIndex: z.number().int().nonnegative().optional(),
  }).strict(),
  z.object({
    kind: z.literal('params'),
    paramValues: z.record(z.string(), z.unknown()),
  }).strict(),
  z.object({
    kind: z.literal('upload'),
    attachments: z.array(AttachmentSchema).min(1),
  }).strict(),
  z.object({
    kind: z.literal('assignment'),
    assignments: z.array(AssignmentItemSchema).min(1),
  }).strict(),
  z.object({
    kind: z.literal('rows'),
    rows: z.array(TableEditorRowSchema).min(1),
  }).strict(),
]);

export type Attachment = z.infer<typeof AttachmentSchema>;
export type AssignmentItem = z.infer<typeof AssignmentItemSchema>;
export type TableEditorRow = z.infer<typeof TableEditorRowSchema>;
export type CompleteHumanTaskPayload = z.infer<typeof CompleteHumanTaskPayloadSchema>;
