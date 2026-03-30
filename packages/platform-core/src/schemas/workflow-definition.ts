import { z } from 'zod';
import {
  StepParamSchema,
  VerdictSchema,
  SelectionSchema,
  StepUiSchema,
  TransitionSchema,
  TriggerSchema,
  RepoSchema,
} from './process-definition.js';
import { ProcessNotificationConfigSchema } from './process-config.js';

export const WorkflowAgentConfigSchema = z.object({
  model: z.string().optional(),
  skill: z.string().optional(),
  prompt: z.string().optional(),
  skillsDir: z.string().optional(),
  timeoutMs: z.number().positive().optional(),
  timeoutMinutes: z.number().optional(),
  command: z.string().optional(),
  inlineScript: z.string().optional(),
  runtime: z.enum(['javascript', 'python', 'r', 'bash']).optional(),
  image: z.string().optional(),
  repo: z.string().optional(),
  commit: z.string().optional(),
  confidenceThreshold: z.number().min(0).max(1).optional(),
  fallbackBehavior: z.enum(['escalate_to_human', 'continue_with_flag', 'pause']).optional(),
});

export const WorkflowCoworkConfigSchema = z.object({
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
});

export const WorkflowReviewConfigSchema = z.object({
  type: z.enum(['human', 'agent', 'none']).optional(),
  plugin: z.string().optional(),
  maxIterations: z.number().int().positive().optional(),
  timeBoxDays: z.number().positive().optional(),
});

export const WorkflowStepSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['creation', 'review', 'decision', 'terminal']).default('creation'),
  description: z.string().optional(),
  params: z.array(StepParamSchema).optional(),
  verdicts: z.record(z.string(), VerdictSchema).optional(),
  selection: SelectionSchema.optional(),
  ui: StepUiSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  executor: z.enum(['human', 'agent', 'script', 'cowork']),
  autonomyLevel: z.enum(['L0', 'L1', 'L2', 'L3', 'L4']).optional(),
  plugin: z.string().optional(),
  allowedRoles: z.array(z.string()).optional(),
  agent: WorkflowAgentConfigSchema.optional(),
  review: WorkflowReviewConfigSchema.optional(),
  cowork: WorkflowCoworkConfigSchema.optional(),
  stepParams: z.record(z.string(), z.unknown()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export const WorkflowDefinitionSchema = z.object({
  name: z.string().min(1),
  version: z.number().int().positive(),
  namespace: z.string().optional(),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  preamble: z.string().optional(),
  repo: RepoSchema.optional(),
  url: z.string().url().optional(),
  roles: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  notifications: z.array(ProcessNotificationConfigSchema).optional(),
  steps: z.array(WorkflowStepSchema).min(1),
  transitions: z.array(TransitionSchema),
  triggers: z.array(TriggerSchema).min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  archived: z.boolean().optional(),
  deleted: z.boolean().optional(),
  createdAt: z.string().datetime().optional(),
});

export type WorkflowAgentConfig = z.infer<typeof WorkflowAgentConfigSchema>;
export type WorkflowCoworkConfig = z.infer<typeof WorkflowCoworkConfigSchema>;
export type WorkflowReviewConfig = z.infer<typeof WorkflowReviewConfigSchema>;
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
