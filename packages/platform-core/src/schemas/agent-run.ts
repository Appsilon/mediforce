import { z } from 'zod';
import { AgentOutputEnvelopeSchema } from './agent-output-envelope';

export const AgentRunStatusSchema = z.enum([
  'running',
  'completed',
  'timed_out',
  'low_confidence',
  'error',
  'escalated',
  'flagged',
  'paused',
  // Terminal (ADR-0010 §4): the driving process was shut down (deploy SIGTERM)
  // mid-run and the step is being retried with a fresh AgentRun. This one is
  // terminalized so it doesn't linger `running` in the Agents history forever.
  'interrupted',
]);

export const AgentRunSchema = z.object({
  id: z.string(),
  processInstanceId: z.string(),
  stepId: z.string(),
  pluginId: z.string(),
  autonomyLevel: z.enum(['L0', 'L1', 'L2', 'L3', 'L4']),
  status: AgentRunStatusSchema,
  envelope: AgentOutputEnvelopeSchema.nullable(),
  fallbackReason: z.string().nullable(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  executorType: z.enum(['human', 'agent']).optional(), // for UI display
  reviewerType: z.enum(['human', 'agent', 'none']).optional(), // for UI display
});

export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>;
export type AgentRun = z.infer<typeof AgentRunSchema>;

/**
 * KPI-card bucket for Monitoring → Agents — coarser than `AgentRunStatus`
 * and not a 1:1 mapping to it: `error` is derived from `fallbackReason`
 * (`'error'` or `'timeout'`), never from `status` directly (see the comment
 * on `agent-run-list-table.tsx`'s `STATUS_STYLES` — `timed_out`/`error` are
 * declared on `AgentRunStatusSchema` but never actually written to a real
 * row), and `flagged` covers both `escalated` and `flagged` statuses.
 * `running`/`completed` do map straight through. `paused`/`interrupted`
 * intentionally have no bucket — same as the KPI cards' 4-of-6 coverage.
 */
export const AgentRunCardStatusSchema = z.enum(['running', 'completed', 'error', 'flagged']);
export type AgentRunCardStatus = z.infer<typeof AgentRunCardStatusSchema>;
