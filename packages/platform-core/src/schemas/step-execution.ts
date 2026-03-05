import { z } from 'zod';

export const StepExecutionStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
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
});

export type StepExecutionStatus = z.infer<typeof StepExecutionStatusSchema>;
export type GateResult = z.infer<typeof GateResultSchema>;
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;
export type StepExecution = z.infer<typeof StepExecutionSchema>;
