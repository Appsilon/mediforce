import { z } from 'zod';
import { InstanceStatusSchema } from '@mediforce/platform-core';

/**
 * Contract for `GET /api/runs/<runId>`.
 *
 * Source of truth for the wire shape this schema mirrors:
 *   `packages/platform-ui/src/app/api/runs/[runId]/route.ts`
 */

export const GetRunInputSchema = z.object({
  runId: z.string().min(1),
});

export const GetRunOutputSchema = z.object({
  runId: z.string().min(1),
  status: InstanceStatusSchema,
  currentStepId: z.string().nullable(),
  error: z.string().nullable(),
  finalOutput: z.unknown(),
});

export type GetRunInput = z.infer<typeof GetRunInputSchema>;
export type GetRunOutput = z.infer<typeof GetRunOutputSchema>;
