import { z } from 'zod';
import { StepParamSchema, StepUiSchema, SelectionSchema } from './process-definition.js';

export const HumanTaskStatusSchema = z.enum([
  'pending',    // unassigned, visible to all with matching role
  'claimed',    // pinned by a user, still visible in queue (soft claim)
  'completed',  // done, workflow advanced
  'cancelled',  // withdrawn (e.g., process aborted)
]);

export const CreationReasonSchema = z.enum(['human_executor', 'agent_review_l3']);

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
  params: z.array(StepParamSchema).optional(),  // copied from step definition — tells UI what form fields to render
  creationReason: CreationReasonSchema.optional(),  // why this task was created
  selection: SelectionSchema.optional(),  // copied from step definition — enables "pick one" review mode
  options: z.array(z.record(z.string(), z.unknown())).optional(),  // options from previous step output
});

export type HumanTaskStatus = z.infer<typeof HumanTaskStatusSchema>;
export type HumanTask = z.infer<typeof HumanTaskSchema>;
