import { z } from 'zod';
import { AgentRunSchema, AgentRunStatusSchema, AgentRunCardStatusSchema } from '@mediforce/platform-core';

/**
 * Contract for `GET /api/agent-runs` and `GET /api/agent-runs/:agentRunId`.
 *
 * The list endpoint is namespace-aware via the `CallerScope` wrapper — system
 * actors see every run, user callers see only runs whose parent process
 * instance lives in a workspace they're a member of. Filter axes:
 *
 *   - `runId`  — narrow to a single process instance
 *   - `stepId` — further narrow to a specific step (requires `runId`; a
 *                stepId without a runId is ambiguous across the data set)
 *   - `namespace` — explicit workspace handle filter; the wrapper already
 *                enforces "must be a member"; this further narrows to a
 *                single workspace inside that set.
 *
 * Pagination is opaque cursor + capped limit. The server encodes the cursor
 * (`startedAt|id` tie-breaker today, Postgres `(started_at, id)` keyset
 * tomorrow); the client treats the value as a token.
 *
 * The `max(10_000)` cap is a deliberate ceiling for the Run History UI,
 * which today fetches the workspace in a single bounded request so the
 * JS-side filters keep working. A proper server-side filter + keyset PR is
 * scoped after the Postgres migration (ADR-0001); at that point `max`
 * should drop back to a small triple-digit ceiling and the UI moves to
 * either an infinite-scroll list or filter-pushdown queries.
 */
export const ListAgentRunsInputSchema = z
  .object({
    namespace: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
    stepId: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(10_000).optional(),
    cursor: z.string().min(1).optional(),
    /** Raw status filter — the Monitoring → Agents tab's "All Statuses" dropdown. */
    status: AgentRunStatusSchema.optional(),
    /** KPI-card bucket filter — see `AgentRunCardStatusSchema`'s docstring.
     *  Composable with `status`. */
    cardStatus: AgentRunCardStatusSchema.optional(),
    /**
     * Workflow-name filter, pre-resolved client-side into the matching
     * process instance ids (via the already-fetched processInstanceId →
     * definitionName map) — avoids a repository-level join. Repeated query
     * param (`?processInstanceId=a&processInstanceId=b`).
     */
    processInstanceIds: z.array(z.string().min(1)).optional(),
  })
  .refine((v) => v.stepId === undefined || v.runId !== undefined, {
    message: 'stepId requires runId',
    path: ['stepId'],
  });

export const ListAgentRunsOutputSchema = z.object({
  runs: z.array(AgentRunSchema),
  nextCursor: z.string().optional(),
});

export type ListAgentRunsInput = z.infer<typeof ListAgentRunsInputSchema>;
export type ListAgentRunsOutput = z.infer<typeof ListAgentRunsOutputSchema>;

/**
 * Contract for `GET /api/agent-runs/card-status-counts` — grouped
 * `AgentRunCardStatus` counts for the Agents tab's KPI cards, a real
 * Postgres aggregation rather than a client-side tally over a fetched row
 * set. Same `namespace`/`processInstanceIds`/`status` filters as
 * `ListAgentRunsInputSchema` (minus `cardStatus` itself and pagination).
 */
export const GetAgentRunCardStatusCountsInputSchema = z.object({
  namespace: z.string().min(1).optional(),
  status: AgentRunStatusSchema.optional(),
  processInstanceIds: z.array(z.string().min(1)).optional(),
});

export const AgentRunCardStatusCountsSchema = z.object({
  total: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  error: z.number().int().nonnegative(),
  flagged: z.number().int().nonnegative(),
});

export const GetAgentRunCardStatusCountsOutputSchema = z.object({
  counts: AgentRunCardStatusCountsSchema,
});

export type GetAgentRunCardStatusCountsInput = z.infer<typeof GetAgentRunCardStatusCountsInputSchema>;
export type GetAgentRunCardStatusCountsOutput = z.infer<typeof GetAgentRunCardStatusCountsOutputSchema>;

/**
 * Contract for `GET /api/agent-runs/:agentRunId`. Single-resource read; the
 * route adapter uses `getByIdAdapter` so this contract is just the path-id
 * envelope plus a `{ run }` wrapper around the entity.
 */
export const GetAgentRunInputSchema = z.object({
  agentRunId: z.string().min(1),
});

export const GetAgentRunOutputSchema = z.object({
  run: AgentRunSchema,
});

export type GetAgentRunInput = z.infer<typeof GetAgentRunInputSchema>;
export type GetAgentRunOutput = z.infer<typeof GetAgentRunOutputSchema>;
