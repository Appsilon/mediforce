import { z } from 'zod';
import { InstanceStatusSchema } from '@mediforce/platform-core';

/**
 * Contract for `GET /api/runs/<runId>`.
 *
 * NOTE — cross-branch concern: the live endpoint that serves this shape
 * (`packages/platform-ui/src/app/api/runs/[runId]/route.ts`) lives on the
 * `n8n-migrator` branch and is not yet merged to `main`. The schema below
 * is written to the spec so the CLI and SDK can ship today; once the
 * endpoint lands on `main`, the wire shape will already match.
 *
 * Until then the SDK method is exercised via fetch loopback in tests, with
 * no real-server smoke. After the endpoint merges this comment can be
 * dropped without any code change.
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
