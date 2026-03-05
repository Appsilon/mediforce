import { z } from 'zod';

export const AgentEventSchema = z.object({
  id: z.string(),
  processInstanceId: z.string(),
  stepId: z.string(),
  type: z.string(), // open string: 'status', 'annotation', 'result', or custom
  payload: z.unknown(),
  timestamp: z.string().datetime(),
  sequence: z.number().int(), // ordering — Firestore timestamps alone aren't reliable
});

export type AgentEvent = z.infer<typeof AgentEventSchema>;
