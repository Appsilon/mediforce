import { z } from 'zod';
import { InstanceStatusSchema } from '@mediforce/platform-core';

/**
 * Contract for `GET /api/runs/<runId>`.
 *
 * TODO — cross-branch coupling (spike #9, n8n-migrator):
 *
 *   Source of truth for the wire shape this schema mirrors:
 *     `packages/platform-ui/src/app/api/runs/[runId]/route.ts`
 *   That route currently lives on the `n8n-migrator` branch and has not
 *   yet been raised as a PR against `main` (status: not yet PR'd).
 *
 *   After spike #9 lands on `main`, run `mediforce run get <id>` against
 *   the deployed `/api/runs/<id>` endpoint and confirm shape parity end
 *   to end (runId, status, currentStepId, error, finalOutput). Adjust
 *   either the schema below or the route handler if drift is found.
 *
 *   Until then, this contract is unverified at runtime — the SDK method
 *   and CLI command are only exercised via fetch loopback in unit tests.
 *   No CI guard for MVP; remove this TODO block once smoke succeeds.
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
