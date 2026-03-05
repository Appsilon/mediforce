import { z } from 'zod';

export const HandoffStatusSchema = z.enum([
  'created',       // created by agent escalation; unacknowledged
  'acknowledged',  // claiming user has viewed and accepted responsibility
  'resolved',      // user has submitted structured resolution; lifecycle complete
]);

export const HandoffEntitySchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),                      // discriminator e.g. 'alert', 'issue', 'code_review'
  processInstanceId: z.string().min(1),
  stepId: z.string().min(1),
  agentRunId: z.string().min(1),
  assignedRole: z.string().min(1),
  assignedUserId: z.string().nullable(),         // null until claimed
  status: HandoffStatusSchema,
  // Agent context captured at escalation time:
  agentWork: z.record(z.string(), z.unknown()),
  agentReasoning: z.string(),
  agentQuestion: z.string(),
  // App-defined payload (schema registered via handoffTypeRegistry):
  payload: z.record(z.string(), z.unknown()),
  // App-defined resolution (null until resolved):
  resolution: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
});

export type HandoffStatus = z.infer<typeof HandoffStatusSchema>;
export type HandoffEntity = z.infer<typeof HandoffEntitySchema>;
