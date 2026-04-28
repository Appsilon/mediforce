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
import { McpServerConfigSchema } from './mcp-server-config.js';
import { StepMcpRestrictionSchema } from './agent-mcp-binding.js';

/** HTTP method enum used by webhook triggers and the http action handler. */
export const HttpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);

/** Webhook trigger config: method + url path (relative to /api/triggers/webhook/<ns>/<wf>).
 *  The path discriminates when a workflow has multiple webhook triggers and is
 *  matched verbatim against the suffix segment(s) the caller used. */
export const WebhookTriggerConfigSchema = z.object({
  method: HttpMethodSchema,
  path: z
    .string()
    .min(1)
    .regex(/^\/[A-Za-z0-9_\-/]*$/, 'path must start with "/" and contain url-safe chars only'),
});

/** http action config: minimal request shape passed to fetch().
 *  `body` accepts any JSON-serializable value or a string template — the action
 *  handler interpolates `${...}` placeholders before sending. */
export const HttpActionConfigSchema = z.object({
  method: HttpMethodSchema,
  url: z.string().min(1),
  body: z.unknown().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

/** reshape action config: rebuild a new object by interpolating each leaf
 *  against the same sources (triggerPayload, steps, variables). Pure
 *  data transformation — no side effects. Output is the interpolated
 *  values map. */
export const ReshapeActionConfigSchema = z.object({
  values: z.record(z.string(), z.unknown()),
});

/** Discriminated union of action configs. Future kinds (wait, subworkflow,
 *  email, set) plug in here. */
export const ActionConfigSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('http'), config: HttpActionConfigSchema }),
  z.object({ kind: z.literal('reshape'), config: ReshapeActionConfigSchema }),
]);

export type HttpMethod = z.infer<typeof HttpMethodSchema>;
export type WebhookTriggerConfig = z.infer<typeof WebhookTriggerConfigSchema>;
export type HttpActionConfig = z.infer<typeof HttpActionConfigSchema>;
export type ReshapeActionConfig = z.infer<typeof ReshapeActionConfigSchema>;
export type ActionConfig = z.infer<typeof ActionConfigSchema>;

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
  dockerfile: z.string().optional(),
  repo: z.string().optional(),
  commit: z.string().regex(/^[a-f0-9]{7,40}$/, 'commit must be a hex SHA (7-40 chars)').optional(),
  /** Name of a workflow secret containing a token for repo access. */
  repoAuth: z.string().optional(),
  confidenceThreshold: z.number().min(0).max(1).optional(),
  fallbackBehavior: z.enum(['escalate_to_human', 'continue_with_flag', 'pause']).optional(),
  /** @deprecated Step-level MCP configuration is being removed.
   *  Move servers onto the agent via AgentDefinition.mcpServers and
   *  narrow them at the step via WorkflowStep.mcpRestrictions.
   *  Step 2 of the MCP permissions refactor will migrate existing
   *  workflows and drop this field. Still parsed for backward-compat. */
  mcpServers: z.array(McpServerConfigSchema).optional(),
  /** Additional Claude Code tools to allow beyond the default set
   *  (Bash, Read, Write, Edit, Glob, Grep). Use this to grant internet
   *  access (WebSearch, WebFetch) or any other built-in tool. */
  allowedTools: z.array(z.string()).optional(),
});

export const CoworkChatConfigSchema = z.object({
  model: z.string().optional(),
});

export const CoworkVoiceRealtimeConfigSchema = z.object({
  model: z.string().optional(),
  voice: z.string().optional(),
  synthesisModel: z.string().optional(),
  maxDurationSeconds: z.number().positive().optional(),
  idleTimeoutSeconds: z.number().positive().optional(),
});

export const WorkflowCoworkConfigSchema = z.object({
  agent: z.enum(['chat', 'voice-realtime']),
  systemPrompt: z.string().optional(),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  chat: CoworkChatConfigSchema.optional(),
  voiceRealtime: CoworkVoiceRealtimeConfigSchema.optional(),
  /** @deprecated Step-level MCP configuration is being removed.
   *  Attach servers to the cowork agent definition and narrow per step
   *  via WorkflowStep.mcpRestrictions. Retained for backward-compat
   *  until the Step 2 migrator runs. */
  mcpServers: z.array(McpServerConfigSchema).optional(),
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
  executor: z.enum(['human', 'agent', 'script', 'cowork', 'action']),
  /** Required when executor='action'. Discriminated by `kind`. */
  action: ActionConfigSchema.optional(),
  autonomyLevel: z.enum(['L0', 'L1', 'L2', 'L3', 'L4']).optional(),
  plugin: z.string().optional(),
  /** References an AgentDefinition by its deterministic slug (doc id).
   *  The referenced definition carries canonical MCP server bindings
   *  and runtime identity. Step-level mcpRestrictions narrow further.
   *  When unset, no MCP resolution runs for this step. */
  agentId: z.string().optional(),
  allowedRoles: z.array(z.string()).optional(),
  agent: WorkflowAgentConfigSchema.optional(),
  review: WorkflowReviewConfigSchema.optional(),
  cowork: WorkflowCoworkConfigSchema.optional(),
  stepParams: z.record(z.string(), z.unknown()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  /** Step-level subtractive MCP restrictions, keyed by server name
   *  (matching AgentDefinition.mcpServers). Can only disable servers or
   *  deny specific tools — the shape has no allow/broaden field. */
  mcpRestrictions: StepMcpRestrictionSchema.optional(),
});

/**
 * Declares which step outputs of the current run are exposed to the next run
 * under ProcessInstance.previousRun. Each entry reads: from step `stepId`,
 * take output key `output`, expose it as `as` on the next run.
 */
export const InputForNextRunEntrySchema = z.object({
  stepId: z.string().min(1),
  output: z.string().min(1),
  as: z.string().min(1),
});

/**
 * Cross-field validation for `inputForNextRun`:
 *   - every stepId must match an existing step
 *   - every `as` must be unique within the block
 *
 * Applied via superRefine on the top-level schema (and also exported so that
 * callers using `.omit()` or `.partial()` on the base object can re-apply it).
 */
/**
 * executor='action' steps must carry an `action` config; conversely, `action`
 * makes no sense on other executors. Webhook triggers must declare a typed
 * config (method+path) — TriggerSchema accepts `config: z.record(...).optional()`
 * for back-compat with cron/manual, so we narrow webhook here.
 */
function validateExecutorAndTriggers(
  wd: {
    steps: Array<{ id: string; executor: string; action?: unknown }>;
    triggers: Array<{ type: string; config?: unknown }>;
  },
  ctx: z.RefinementCtx,
): void {
  wd.steps.forEach((step, i) => {
    if (step.executor === 'action' && step.action === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['steps', i, 'action'],
        message: `step '${step.id}' has executor='action' but no action config`,
      });
    }
    if (step.executor !== 'action' && step.action !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['steps', i, 'action'],
        message: `step '${step.id}' has action config but executor is '${step.executor}' (must be 'action')`,
      });
    }
  });

  wd.triggers.forEach((trigger, i) => {
    if (trigger.type !== 'webhook') return;
    const parsed = WebhookTriggerConfigSchema.safeParse(trigger.config);
    if (!parsed.success) {
      ctx.addIssue({
        code: 'custom',
        path: ['triggers', i, 'config'],
        message: `webhook trigger config invalid: ${parsed.error.issues
          .map((iss) => `${iss.path.join('.')}: ${iss.message}`)
          .join('; ')}`,
      });
    }
  });
}

function validateInputForNextRun(
  wd: {
    steps: Array<{ id: string }>;
    inputForNextRun?: Array<{ stepId: string; as: string }>;
  },
  ctx: z.RefinementCtx,
): void {
  if (!wd.inputForNextRun) return;
  const stepIds = new Set(wd.steps.map((s) => s.id));
  const seenAs = new Set<string>();
  wd.inputForNextRun.forEach((entry, i) => {
    if (!stepIds.has(entry.stepId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['inputForNextRun', i, 'stepId'],
        message: `inputForNextRun[${i}].stepId '${entry.stepId}' does not match any step id`,
      });
    }
    if (seenAs.has(entry.as)) {
      ctx.addIssue({
        code: 'custom',
        path: ['inputForNextRun', i, 'as'],
        message: `inputForNextRun[${i}].as '${entry.as}' is duplicated (must be unique within inputForNextRun)`,
      });
    }
    seenAs.add(entry.as);
  });
}

/**
 * Base WorkflowDefinition schema (no cross-field refinements). Exposed so
 * callers can `.omit()` / `.partial()` and then re-apply validation via
 * `.superRefine(validateInputForNextRun)`.
 *
 * WARNING: Using this schema directly bypasses the `inputForNextRun`
 * cross-field validation (unknown stepId, duplicate `as`). If you reshape
 * the schema (e.g. `.omit()`) you MUST re-apply `.superRefine(validateInputForNextRun)`
 * or silently accept WDs with broken `inputForNextRun` references — the
 * engine's resolver swallows unknown keys at runtime with no signal.
 *
 * For the common "register a new WD" path (API routes, server actions),
 * prefer {@link parseWorkflowDefinitionForCreation} which applies the
 * refinement for you.
 */
export const WorkflowDefinitionBaseSchema = z.object({
  name: z.string().min(1),
  version: z.number().int().positive(),
  /** Workspace namespace that owns this definition. Required because
   *  MCP resolution, workflow secret lookups, and the namespace-scoped
   *  tool catalog all key off this field — a workflow without one is
   *  not a runnable workflow. */
  namespace: z.string().min(1),
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
  inputForNextRun: z.array(InputForNextRunEntrySchema).optional(),
});

export const WorkflowDefinitionSchema = WorkflowDefinitionBaseSchema.superRefine(
  (wd, ctx) => {
    validateInputForNextRun(wd, ctx);
    validateExecutorAndTriggers(wd, ctx);
  },
);

export { validateInputForNextRun, validateExecutorAndTriggers };

/**
 * Default parse path for registering a new WorkflowDefinition (API routes,
 * server actions). Omits the server-managed `version` and `createdAt` fields
 * and re-applies the cross-field `inputForNextRun` validation so callers
 * cannot accidentally skip it.
 *
 * Returns a Zod `SafeParseReturnType` — check `.success` before using
 * `.data` or `.error`.
 */
export function parseWorkflowDefinitionForCreation(input: unknown) {
  return WorkflowDefinitionBaseSchema.omit({ version: true, createdAt: true })
    .superRefine((wd, ctx) => {
      validateInputForNextRun(wd, ctx);
      validateExecutorAndTriggers(wd, ctx);
    })
    .safeParse(input);
}

/**
 * Namespace-agnostic workflow template. Files in apps/examples/<app>/src/*.wd.json
 * omit `namespace`; the loader injects it at registration so the same template
 * can serve multiple tenants. Validation reuses WorkflowDefinitionBaseSchema
 * minus the `namespace` field, then re-applies the same cross-field refinements.
 *
 * Templates that declare `namespace` are rejected — silently stripping the key
 * would let the author believe their value was honored when the loader
 * actually overwrites it.
 */
export const WorkflowTemplateSchema = WorkflowDefinitionBaseSchema.omit({
  namespace: true,
  version: true,
  createdAt: true,
}).superRefine((wd, ctx) => {
  validateInputForNextRun(wd, ctx);
  validateExecutorAndTriggers(wd, ctx);
});

export type WorkflowTemplate = z.infer<typeof WorkflowTemplateSchema>;

export function parseWorkflowTemplate(input: unknown) {
  if (
    typeof input === 'object' &&
    input !== null &&
    !Array.isArray(input) &&
    'namespace' in input
  ) {
    return {
      success: false as const,
      error: new z.ZodError([
        {
          code: 'custom',
          path: ['namespace'],
          message:
            'Workflow templates must not declare a namespace; it is injected at registration time',
          input,
        },
      ]),
    };
  }
  return WorkflowTemplateSchema.safeParse(input);
}

export type WorkflowAgentConfig = z.infer<typeof WorkflowAgentConfigSchema>;
export type WorkflowCoworkConfig = z.infer<typeof WorkflowCoworkConfigSchema>;
export type WorkflowReviewConfig = z.infer<typeof WorkflowReviewConfigSchema>;
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
export type InputForNextRunEntry = z.infer<typeof InputForNextRunEntrySchema>;
