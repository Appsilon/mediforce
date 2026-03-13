import { z } from 'zod';

export const VerdictSchema = z.object({
  target: z.string(),
});

export const StepUiSchema = z.object({
  component: z.string().min(1),
  config: z.record(z.string(), z.unknown()).optional(),
});

export const StepParamSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean']).default('string'),
  required: z.boolean().default(false),
  description: z.string().optional(),
  default: z.unknown().optional(),
});

export const StepSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['creation', 'review', 'decision', 'terminal']).default('creation'),
  description: z.string().optional(),
  params: z.array(StepParamSchema).optional(),
  verdicts: z.record(z.string(), VerdictSchema).optional(),
  ui: StepUiSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const TransitionSchema = z.object({
  from: z.string(),
  to: z.string(),
  gate: z.string().optional(),
});

export const TriggerSchema = z.object({
  type: z.enum(['manual', 'webhook', 'event', 'cron']),
  name: z.string().min(1),
  config: z.record(z.string(), z.unknown()).optional(),
  schedule: z.string().optional(),
});

export const RepoSchema = z.object({
  url: z.string().url(),
  branch: z.string().optional(),
  directory: z.string().optional(),
});

export const ProcessDefinitionSchema = z.object({
  name: z.string().min(1),
  version: z.string(),
  description: z.string().optional(),
  repo: RepoSchema.optional(),
  url: z.string().url().optional(),
  steps: z.array(StepSchema).min(1),
  transitions: z.array(TransitionSchema),
  triggers: z.array(TriggerSchema).min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  archived: z.boolean().optional(),
});

export type Verdict = z.infer<typeof VerdictSchema>;
export type StepUi = z.infer<typeof StepUiSchema>;
export type StepParam = z.infer<typeof StepParamSchema>;
export type Step = z.infer<typeof StepSchema>;
export type Transition = z.infer<typeof TransitionSchema>;
export type Trigger = z.infer<typeof TriggerSchema>;
export type ProcessDefinition = z.infer<typeof ProcessDefinitionSchema>;
