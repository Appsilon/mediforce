import { z } from 'zod';

export const StepInputSchema = z.object({
  stepId: z.string(),
  processInstanceId: z.string(),
  data: z.record(z.string(), z.unknown()),
  context: z.record(z.string(), z.unknown()).optional(),
});

export const StepOutputSchema = z.object({
  stepId: z.string(),
  processInstanceId: z.string(),
  result: z.record(z.string(), z.unknown()),
  verdict: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type StepInput = z.infer<typeof StepInputSchema>;
export type StepOutput = z.infer<typeof StepOutputSchema>;
