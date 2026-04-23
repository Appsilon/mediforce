import { z } from 'zod';
import { ProcessConfigSchema } from '@mediforce/platform-core';

/**
 * Contracts for the `configs` domain (read endpoints).
 *
 * The list endpoint mirrors the pre-migration `GET /api/configs?processName=X`
 * shape: the `processName` query param is required (400 when missing), and
 * the list is wrapped in `{ configs }` for future-proofing (pagination,
 * metadata) — consistent with `ListTasksOutputSchema`.
 */

// ---- GET /api/configs?processName=X -----------------------------------------

export const ListProcessConfigsInputSchema = z.object({
  processName: z.string().min(1),
});

export const ListProcessConfigsOutputSchema = z.object({
  configs: z.array(ProcessConfigSchema),
});

export type ListProcessConfigsInput = z.infer<typeof ListProcessConfigsInputSchema>;
export type ListProcessConfigsOutput = z.infer<typeof ListProcessConfigsOutputSchema>;

// ---- POST /api/configs ------------------------------------------------------
//
// Register a new version of a ProcessConfig. Handler runs `validateProcessConfig`
// against the latest ProcessDefinition version before persisting; failures are
// returned as 400 `ValidationError`s. Version conflicts become 409
// `ConflictError`.

export const CreateProcessConfigInputSchema = ProcessConfigSchema;

export const CreateProcessConfigOutputSchema = z.object({ ok: z.literal(true) });

export type CreateProcessConfigInput = z.infer<typeof CreateProcessConfigInputSchema>;
export type CreateProcessConfigOutput = z.infer<typeof CreateProcessConfigOutputSchema>;
