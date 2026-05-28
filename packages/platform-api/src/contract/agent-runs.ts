import { z } from 'zod';
import { AgentRunSchema } from '@mediforce/platform-core';

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
 */
export const ListAgentRunsInputSchema = z
  .object({
    namespace: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
    stepId: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    cursor: z.string().min(1).optional(),
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
