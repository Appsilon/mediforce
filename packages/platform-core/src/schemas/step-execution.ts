import { z } from 'zod';
import { PresentationSchema, TokenUsageSchema } from './agent-output-envelope';

export const StepExecutionStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'escalated',
  'paused',
  // Terminal-ish (ADR-0010 §4): the driving process was told to shut down
  // (deploy SIGTERM) while this execution was still running. Distinct from
  // 'running' (nothing is advancing it) and 'failed' (it was interrupted, not a
  // genuine failure) so the auto-runner retries it as a fresh attempt instead
  // of reaping it as a timeout.
  'interrupted',
]);

export const GateResultSchema = z.object({
  next: z.string().min(1),
  reason: z.string(),
});

export const ReviewVerdictSchema = z.object({
  reviewerId: z.string().min(1),
  reviewerRole: z.string().min(1),
  verdict: z.string().min(1),
  comment: z.string().nullable(),
  timestamp: z.string().datetime(),
});

export const AgentOutputSnapshotSchema = z.object({
  confidence: z.number().nullable(),
  confidence_rationale: z.string().nullable(),
  reasoning: z.string().nullable(),
  model: z.string().nullable(),
  duration_ms: z.number().nullable(),
  gitMetadata: z.object({
    commitSha: z.string(),
    branch: z.string(),
    changedFiles: z.array(z.string()),
    repoUrl: z.string(),
  }).nullable(),
  deliverableFile: z.string().nullable().optional(),
  tokenUsage: TokenUsageSchema.optional(),
  estimatedCostUsd: z.number().optional(),
  presentation: z.union([z.string(), PresentationSchema])
    .transform((value) =>
      typeof value === 'string' ? { kind: 'html' as const, content: value } : value,
    )
    .nullable()
    .optional(),
});

export const StepExecutionSchema = z.object({
  id: z.string().min(1),
  instanceId: z.string().min(1),
  stepId: z.string().min(1),
  status: StepExecutionStatusSchema,
  input: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()).nullable(),
  verdict: z.string().nullable(),
  executedBy: z.string().min(1),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  iterationNumber: z.number().int().nonnegative(),
  gateResult: GateResultSchema.nullable(),
  error: z.string().nullable(),
  reviewVerdicts: z.array(ReviewVerdictSchema).optional(),
  agentOutput: AgentOutputSnapshotSchema.nullable().optional(),
});

export type StepExecutionStatus = z.infer<typeof StepExecutionStatusSchema>;
export type GateResult = z.infer<typeof GateResultSchema>;
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;
export type AgentOutputSnapshot = z.infer<typeof AgentOutputSnapshotSchema>;
export type StepExecution = z.infer<typeof StepExecutionSchema>;
