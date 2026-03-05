import { z } from 'zod';
import { AgentOutputEnvelopeSchema } from './agent-output-envelope.js';

export const AgentRunStatusSchema = z.enum([
  'running',
  'completed',
  'timed_out',
  'low_confidence',
  'error',
  'escalated',
  'flagged',
  'paused',
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
