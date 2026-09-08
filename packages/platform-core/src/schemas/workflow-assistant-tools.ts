import { z } from 'zod';
import { WorkflowStepSchema, WorkflowAuthorableSchema } from './workflow-definition';
import { BLOCK_PRESETS } from '../blocks/block-presets';

const ACTION_KIND_ALIASES: Record<string, 'http' | 'reshape' | 'email' | 'spawn' | 'wait'> = {
  sendemail: 'email', mail: 'email', notify: 'email', notification: 'email',
  webhook: 'http', apicall: 'http', request: 'http',
  delay: 'wait', pause: 'wait', sleep: 'wait',
  trigger: 'spawn', childworkflow: 'spawn',
  transform: 'reshape', map: 'reshape',
};

function normalizeActionKind(kind: unknown): unknown {
  if (typeof kind !== 'string') return kind;
  const key = kind.toLowerCase().replace(/[\s_-]/g, '');
  const validKinds = ['http', 'reshape', 'email', 'spawn', 'wait'];
  if (validKinds.includes(key)) return key;
  return ACTION_KIND_ALIASES[key] ?? kind;
}

function preprocessJsonStringObject(val: unknown): unknown {
  if (typeof val !== 'string') return val;
  try {
    const parsed: unknown = JSON.parse(val);
    return parsed !== null && typeof parsed === 'object' ? parsed : val;
  } catch {
    return val;
  }
}

// Omit only machine-managed fields (`id` is canvas-assigned, `metadata` is
// display/internal) and `plugin`, which the reducer derives from the executor.
// Everything else a user can author is exposed, so the assistant has parity
// with hand-editing — including `stepParams`, which is not the legacy bag its
// old comment claimed: `execute-agent-step` merges it into the agent's input
// context, under `appContext`.
const StepConfigSchema = WorkflowStepSchema.omit({
  id: true,
  plugin: true,
  metadata: true,
}).extend({
  type: WorkflowStepSchema.shape.type.unwrap().exclude(['terminal']),
  agent: z.preprocess(preprocessJsonStringObject, WorkflowStepSchema.shape.agent),
  script: z.preprocess(preprocessJsonStringObject, WorkflowStepSchema.shape.script),
  databricks: z.preprocess(preprocessJsonStringObject, WorkflowStepSchema.shape.databricks),
  review: z.preprocess(preprocessJsonStringObject, WorkflowStepSchema.shape.review),
  cowork: z.preprocess(preprocessJsonStringObject, WorkflowStepSchema.shape.cowork),
  ui: z.preprocess(preprocessJsonStringObject, WorkflowStepSchema.shape.ui),
  action: z.preprocess(
    (val) => {
      const unwrapped = preprocessJsonStringObject(val);
      if (typeof unwrapped === 'string') return { kind: normalizeActionKind(unwrapped) };
      if (unwrapped !== null && typeof unwrapped === 'object') {
        const obj = unwrapped as Record<string, unknown>;
        if ('kind' in obj) {
          return { ...obj, kind: normalizeActionKind(obj.kind) };
        }
        if ('type' in obj) {
          const { type, ...rest } = obj;
          return { ...rest, kind: normalizeActionKind(type) };
        }
      }
      return unwrapped;
    },
    WorkflowStepSchema.shape.action,
  ),
});

function verdictsRequireDecisionType(
  data: { type?: string; verdicts?: Record<string, unknown> },
  ctx: z.RefinementCtx,
): void {
  if (data.verdicts && Object.keys(data.verdicts).length > 0 && data.type !== undefined && data.type !== 'decision') {
    ctx.addIssue({
      code: 'custom',
      path: ['type'],
      message: `A step with 'verdicts' must be type 'decision' — 'review' is deprecated (even though it still routes) and any other type silently ignores verdicts.`,
    });
  }
}

const PRESET_BY_ID = new Map(BLOCK_PRESETS.map((preset) => [preset.id, preset]));

// Non-empty by construction; `block-presets.test.ts` pins that the catalog has
// entries and that their ids are unique.
const BLOCK_PRESET_IDS = BLOCK_PRESETS.map((preset) => preset.id) as [string, ...string[]];

/**
 * Merge a named block preset underneath the call's own fields.
 *
 * This is what makes "the same block whether the user clicked it or asked for it"
 * a property of the code rather than an instruction in the prompt: `presetId`
 * resolves to the exact payload the Add Block panel inserts, and anything the
 * assistant states explicitly (a name, a real recipient) still wins over it.
 */
function resolvePreset(val: unknown): unknown {
  if (val === null || typeof val !== 'object' || Array.isArray(val)) return val;
  const call = val as Record<string, unknown>;
  if (typeof call.presetId !== 'string') return val;
  const preset = PRESET_BY_ID.get(call.presetId);
  // An unknown id falls through to the enum below, which names the valid ones.
  if (preset === undefined) return val;
  return { ...preset.payload, ...call };
}

/** The field shape, before preset resolution — exported so callers can inspect it. */
export const AddStepToolFieldsSchema = StepConfigSchema.extend({
  presetId: z.enum(BLOCK_PRESET_IDS).optional(),
  insertAfterId: z.string().nullable().optional(),
  insertBeforeId: z.string().nullable().optional(),
  clientId: z.string().optional(),
});

export const AddStepToolSchema = z.preprocess(
  resolvePreset,
  AddStepToolFieldsSchema.superRefine(verdictsRequireDecisionType),
);
export type AddStepTool = z.infer<typeof AddStepToolSchema>;

export const UpdateStepToolSchema = StepConfigSchema.partial().extend({
  stepId: z.string().min(1),
  insertAfterId: z.string().nullable().optional(),
  insertBeforeId: z.string().nullable().optional(),
}).superRefine(verdictsRequireDecisionType);
export type UpdateStepTool = z.infer<typeof UpdateStepToolSchema>;

export const RemoveStepToolSchema = z.object({
  stepId: z.string().min(1),
});
export type RemoveStepTool = z.infer<typeof RemoveStepToolSchema>;

/**
 * The workflow level, which no tool could reach: all three step tools are
 * step-scoped, so a request like "make the study ID a required input" or "add
 * these house rules to every agent step" had no way to land however it was
 * phrased.
 *
 * Patch semantics — a call naming one field leaves the others alone, so the
 * assistant can answer "also set the preamble" without re-sending `env`.
 * `name` is excluded: renaming a registered workflow is a different operation
 * from editing a draft version, and the canvas cannot do it either.
 */
export const UpdateWorkflowToolSchema = WorkflowAuthorableSchema.omit({
  name: true,
  steps: true,
  transitions: true,
  inputForNextRun: true,
}).partial();
export type UpdateWorkflowTool = z.infer<typeof UpdateWorkflowToolSchema>;

/**
 * Conditional routing. `when` is evaluated by the transition-resolver's own
 * expression language — not the `${...}` interpolation steps use — and the
 * canvas preserves it on rewire and renders it as an edge label, but no control
 * could write it.
 *
 * Omitting `when` clears the condition, which is how an edge goes back to
 * unconditional.
 */
export const SetTransitionConditionToolSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  when: z.string().min(1).optional(),
});
export type SetTransitionConditionTool = z.infer<typeof SetTransitionConditionToolSchema>;

export const WORKFLOW_ASSISTANT_TOOLS = {
  add_step: AddStepToolSchema,
  update_step: UpdateStepToolSchema,
  remove_step: RemoveStepToolSchema,
  update_workflow: UpdateWorkflowToolSchema,
  set_transition_condition: SetTransitionConditionToolSchema,
} as const;

export type WorkflowAssistantToolName = keyof typeof WORKFLOW_ASSISTANT_TOOLS;

export const ListModelsToolSchema = z.object({
  preference: z.string().optional(),
});
export type ListModelsTool = z.infer<typeof ListModelsToolSchema>;

/** A single canvas-mutation tool call, discriminated on `tool`. */
export const WorkflowAssistantToolCallSchema = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('add_step'), arguments: AddStepToolSchema }),
  z.object({ tool: z.literal('update_step'), arguments: UpdateStepToolSchema }),
  z.object({ tool: z.literal('remove_step'), arguments: RemoveStepToolSchema }),
  z.object({ tool: z.literal('update_workflow'), arguments: UpdateWorkflowToolSchema }),
  z.object({ tool: z.literal('set_transition_condition'), arguments: SetTransitionConditionToolSchema }),
]);
export type WorkflowAssistantToolCall = z.infer<typeof WorkflowAssistantToolCallSchema>;

export const WORKFLOW_ASSISTANT_DEFAULT_MODEL = 'anthropic/claude-sonnet-4';
