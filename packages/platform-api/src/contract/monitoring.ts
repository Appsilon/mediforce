import { z } from 'zod';

/**
 * Contract for `GET /api/namespaces/:handle/monitoring/summary`.
 *
 * Compact (~200 B) dashboard aggregates. Closed shape; extend additively in
 * follow-ups (e.g. `agent_runs_active`, `cron_triggers_due`) without breaking
 * change. The endpoint runs server-side aggregation queries — never a raw
 * list payload (anti-pattern called out in user story #9).
 */
export const MonitoringSummaryInputSchema = z.object({
  handle: z.string().min(1),
});

export const MonitoringSummarySchema = z.object({
  runs: z.object({
    running: z.number().int().nonnegative(),
    paused: z.number().int().nonnegative(),
    completed_24h: z.number().int().nonnegative(),
    failed_24h: z.number().int().nonnegative(),
    archived_total: z.number().int().nonnegative(),
  }),
  tasks: z.object({
    pending: z.number().int().nonnegative(),
    claimed: z.number().int().nonnegative(),
    stuck_count: z.number().int().nonnegative(),
  }),
  roleTaskCounts: z.record(
    z.string(),
    z.object({
      pending: z.number().int().nonnegative(),
      claimed: z.number().int().nonnegative(),
    }),
  ),
});

export const GetMonitoringSummaryOutputSchema = z.object({
  summary: MonitoringSummarySchema,
});

export type MonitoringSummaryInput = z.infer<typeof MonitoringSummaryInputSchema>;
export type MonitoringSummary = z.infer<typeof MonitoringSummarySchema>;
export type GetMonitoringSummaryOutput = z.infer<typeof GetMonitoringSummaryOutputSchema>;
