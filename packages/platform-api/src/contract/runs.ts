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
  /** Workflow definition name the run was started from. Optional for
   *  backward compat with older servers — omit when absent. */
  definitionName: z.string().min(1).optional(),
  /** Namespace (= workspace handle) that owns the workflow definition.
   *  Lets clients build the human-facing URL without a second request.
   *  Nullable when the definition has been deleted; optional for older
   *  servers that don't include the field. */
  definitionNamespace: z.string().min(1).nullable().optional(),
});

export type GetRunInput = z.infer<typeof GetRunInputSchema>;
export type GetRunOutput = z.infer<typeof GetRunOutputSchema>;

/**
 * Contract for `POST /api/processes` — fires a manual trigger and creates
 * a new run for the named workflow definition. Server picks the latest
 * version when `definitionVersion` is omitted.
 */
export const StartRunInputSchema = z.object({
  definitionName: z.string().min(1),
  definitionVersion: z.number().int().positive().optional(),
  triggerName: z.string().min(1).default('manual'),
  triggeredBy: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const StartRunOutputSchema = z.object({
  instanceId: z.string().min(1),
  status: z.string().min(1),
});

export type StartRunInput = z.infer<typeof StartRunInputSchema>;
export type StartRunOutput = z.infer<typeof StartRunOutputSchema>;
