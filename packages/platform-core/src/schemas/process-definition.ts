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
  type: z.enum(['string', 'number', 'boolean', 'date']).default('string'),
  required: z.boolean().default(false),
  description: z.string().optional(),
  default: z.unknown().optional(),
  options: z.array(z.string()).optional(),
});

/** Selection constraint for review steps that present multiple options.
 *  - number shorthand: exact count (e.g. `selection: 3` → min=max=3)
 *  - object form: range (e.g. `selection: { min: 2, max: 5 }`) */
export const SelectionSchema = z.union([
  z.number().int().positive(),
  z.object({
    min: z.number().int().positive(),
    max: z.number().int().positive(),
  }),
]);

export const StepSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['creation', 'review', 'decision', 'terminal']).default('creation'),
  description: z.string().optional(),
  params: z.array(StepParamSchema).optional(),
  verdicts: z.record(z.string(), VerdictSchema).optional(),
  selection: SelectionSchema.optional(),
  ui: StepUiSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const TransitionSchema = z.object({
  from: z.string(),
  to: z.string(),
  when: z.string().optional(),
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
  commit: z.string().regex(/^[a-f0-9]{7,40}$/, 'commit must be a hex SHA (7-40 chars)').optional(),
  /** Name of a workflow secret containing a token for repo access (e.g. "GITHUB_TOKEN"). */
  auth: z.string().optional(),
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

/** Normalize selection shorthand (number) to { min, max } form. */
export function normalizeSelection(selection: Selection): { min: number; max: number } {
  if (typeof selection === 'number') return { min: selection, max: selection };
  return selection;
}

export type Verdict = z.infer<typeof VerdictSchema>;
export type StepUi = z.infer<typeof StepUiSchema>;
export type StepParam = z.infer<typeof StepParamSchema>;
export type Selection = z.infer<typeof SelectionSchema>;
export type Step = z.infer<typeof StepSchema>;
export type Transition = z.infer<typeof TransitionSchema>;
export type Trigger = z.infer<typeof TriggerSchema>;
export type ProcessDefinition = z.infer<typeof ProcessDefinitionSchema>;
