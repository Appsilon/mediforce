import { z } from 'zod';

export const ReviewConstraintsSchema = z.object({
  maxIterations: z.number().int().positive().optional(),
  timeBoxDays: z.number().positive().optional(),
});

export const NotificationTargetSchema = z.object({
  channel: z.enum(['email', 'webhook']),
  address: z.string().min(1),
});

export const AgentConfigSchema = z.object({
  skill: z.string().optional(),
  prompt: z.string().optional(),
  model: z.string().optional(),
  skillsDir: z.string().optional(),
  timeoutMs: z.number().positive().optional(),
  command: z.string().optional(),
  inlineScript: z.string().optional(),
  runtime: z.enum(['javascript', 'python', 'r', 'bash']).optional(),
  // Container image — when omitted, inline scripts auto-resolve the image from the runtime
  image: z.string().optional(),
  dockerfile: z.string().optional(),
  repo: z.string().optional(),
  commit: z.string().optional(),
});

export const StepConfigSchema = z.object({
  stepId: z.string(),
  executorType: z.enum(['human', 'agent', 'script']), // required: who executes this step
  plugin: z.string().optional(), // e.g. '@mediforce/example-agent'
  autonomyLevel: z.enum(['L0', 'L1', 'L2', 'L3', 'L4']).optional(), // L0 added
  confidenceThreshold: z.number().min(0).max(1).optional(), // default 0 (always pass)
  fallbackBehavior: z
    .enum(['escalate_to_human', 'continue_with_flag', 'pause'])
    .optional(),
  timeoutMinutes: z.number().optional(),
  model: z.string().optional(), // e.g. 'anthropic/claude-sonnet-4'
  reviewConstraints: ReviewConstraintsSchema.optional(),
  allowedRoles: z.array(z.string()).optional(),  // RBAC: e.g. ['reviewer', 'approver']
  reviewerType: z.enum(['human', 'agent', 'none']).optional(), // who reviews; 'none' for L4 no-review
  reviewerPlugin: z.string().optional(), // required at runtime when reviewerType='agent'
  agentConfig: AgentConfigSchema.optional(),
  params: z.record(z.string(), z.unknown()).optional(), // Step parameters — merged into step input at runtime
  // Env vars injected into the agent process. Overrides config-level env.
  // Values can reference server secrets: "{{SECRET_NAME}}"
  env: z.record(z.string(), z.string()).optional(),
});

export const ProcessNotificationConfigSchema = z.object({
  event: z.enum(['task_assigned', 'agent_escalation']),
  roles: z.array(z.string()),
});
export type ProcessNotificationConfig = z.infer<typeof ProcessNotificationConfigSchema>;

export const ProcessConfigSchema = z.object({
  processName: z.string(),
  configName: z.string().min(1),
  configVersion: z.string().min(1),
  roles: z.array(z.string()).optional(),          // Declares roles available in this process
  stepConfigs: z.array(StepConfigSchema),
  notifications: z.array(ProcessNotificationConfigSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  archived: z.boolean().optional(),
  // Default env vars for all agent steps. Step-level env overrides these.
  // Values can reference server secrets: "{{SECRET_NAME}}"
  env: z.record(z.string(), z.string()).optional(),
});

export type ReviewConstraints = z.infer<typeof ReviewConstraintsSchema>;
export type NotificationTarget = z.infer<typeof NotificationTargetSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type StepConfig = z.infer<typeof StepConfigSchema>;
export type ProcessConfig = z.infer<typeof ProcessConfigSchema>;
