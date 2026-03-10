import { z } from 'zod';
import { StepUiSchema } from './process-definition.js';

export const HumanTaskStatusSchema = z.enum([
  'pending',    // unassigned, visible to all with matching role
  'claimed',    // pinned by a user, still visible in queue (soft claim)
  'completed',  // done, workflow advanced
  'cancelled',  // withdrawn (e.g., process aborted)
]);

export const HumanTaskSchema = z.object({
  id: z.string().min(1),
  processInstanceId: z.string().min(1),
  stepId: z.string().min(1),
  assignedRole: z.string().min(1),
  assignedUserId: z.string().nullable(),      // null until claimed ("pinned")
  status: HumanTaskStatusSchema,
  deadline: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  completionData: z.record(z.string(), z.unknown()).nullable(),  // structured response on completion
  ui: StepUiSchema.optional(),  // copied from step definition — tells UI what form to render
});

export type HumanTaskStatus = z.infer<typeof HumanTaskStatusSchema>;
export type HumanTask = z.infer<typeof HumanTaskSchema>;
