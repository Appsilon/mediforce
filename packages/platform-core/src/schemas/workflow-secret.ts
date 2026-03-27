import { z } from 'zod';

export const WorkflowSecretsSchema = z.object({
  workflowName: z.string().min(1),
  namespace: z.string().min(1),
  secrets: z.record(z.string(), z.string()),
  updatedAt: z.string().datetime(),
});

export type WorkflowSecrets = z.infer<typeof WorkflowSecretsSchema>;
