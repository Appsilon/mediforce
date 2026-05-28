import { z } from 'zod';
import { InstanceStatusSchema, ProcessInstanceSchema } from '@mediforce/platform-core';

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
  totalCostUsd: z.number().optional(),
});

export type GetRunInput = z.infer<typeof GetRunInputSchema>;
export type GetRunOutput = z.infer<typeof GetRunOutputSchema>;

// Server picks latest version when definitionVersion omitted.
export const StartRunInputSchema = z.object({
  namespace: z.string().min(1).optional(),
  definitionName: z.string().min(1),
  definitionVersion: z.number().int().positive().optional(),
  triggerName: z.string().min(1).default('manual'),
  triggeredBy: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const StartRunOutputSchema = z.object({
  run: ProcessInstanceSchema,
});

export type StartRunInput = z.infer<typeof StartRunInputSchema>;
export type StartRunOutput = z.infer<typeof StartRunOutputSchema>;

/**
 * Contract for `GET /api/runs`.
 */
export const ListRunsInputSchema = z.object({
  workflow: z.string().min(1).optional(),
  status: z
    .enum(['created', 'running', 'paused', 'completed', 'failed'])
    .optional(),
  /**
   * Workspace handle. Narrows the result to a single workspace; defense in
   * depth on top of the caller-namespace gate enforced by `scope.runs`.
   * Asking for a workspace the caller isn't in returns an empty list — list
   * reads are intersection semantics, not access checks.
   */
  namespace: z.string().min(1).optional(),
  // 10_000 is the parity workaround for the pre-paginated UI: Phase 4 PR3
  // moved `/handle/runs` off an unbounded Firestore read onto this contract;
  // a 100-row cap would have been a silent regression for workspaces with
  // more runs. Tracked in #588 alongside PR2's identical workaround — the
  // cap drops back to a sane page size once cursor pagination lands.
  limit: z.coerce.number().int().positive().max(10000).default(20),
});

/**
 * Read-path schema convergence per Phase 4 PRD §9: the list endpoint returns
 * the full `ProcessInstance` shape, the same one served by
 * `GET /api/processes/:instanceId`. This lets the UI hydrate detail/list cache
 * from a single wire shape — see [ADR-0006] §6 multi-cache-key template.
 *
 * Narrow projections (`{ runId, status, ... }`) belong to consumers
 * (CLI presenters, agent tooling), not the wire.
 */
export const ListRunsOutputSchema = z.object({
  runs: z.array(ProcessInstanceSchema),
});

export type ListRunsInput = z.infer<typeof ListRunsInputSchema>;
export type ListRunsOutput = z.infer<typeof ListRunsOutputSchema>;
