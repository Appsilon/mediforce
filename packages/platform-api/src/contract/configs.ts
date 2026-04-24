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

const PROCESS_NAME_REQUIRED = 'processName query parameter is required';

export const ListProcessConfigsInputSchema = z.object({
  processName: z
    .string({ message: PROCESS_NAME_REQUIRED })
    .min(1, PROCESS_NAME_REQUIRED),
});

export const ListProcessConfigsOutputSchema = z.object({
  configs: z.array(ProcessConfigSchema),
});

export type ListProcessConfigsInput = z.infer<typeof ListProcessConfigsInputSchema>;
export type ListProcessConfigsOutput = z.infer<typeof ListProcessConfigsOutputSchema>;
