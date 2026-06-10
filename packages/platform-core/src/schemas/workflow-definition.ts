import { z } from 'zod';
import {
  StepParamSchema,
  VerdictSchema,
  SelectionSchema,
  StepUiSchema,
  TransitionSchema,
  TriggerSchema,
  RepoSchema,
} from './process-definition';
import { ProcessNotificationConfigSchema } from './process-config';
import { McpServerConfigSchema } from './mcp-server-config';
import { StepMcpRestrictionSchema } from './agent-mcp-binding';

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

export const EmailActionConfigSchema = z.object({
  to: z.union([z.string().min(1), z.array(z.string().min(1))]),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  from: z.string().optional(),
  replyTo: z.string().optional(),
  subject: z.string().min(1),
  body: z.string().min(1),
  html: z.string().optional(),
});

export const SpawnTargetSchema = z.object({
  definitionName: z.string().min(1),
  definitionVersion: z.number().int().positive().optional(),
  triggerName: z.string().min(1).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const SpawnActionConfigSchema = z.object({
  targets: z.union([SpawnTargetSchema, z.array(SpawnTargetSchema)]),
  forEach: z.string().min(1).optional(),
  continueOnSpawnError: z.boolean().default(true),
});

export const WaitActionConfigSchema = z.object({
  duration: z.object({
    seconds: z.number().int().nonnegative().optional(),
    minutes: z.number().int().nonnegative().optional(),
    hours: z.number().int().nonnegative().optional(),
  }).optional(),
  deadline: z.string().min(1).optional(),
  condition: z.string().optional(),
});

/** Discriminated union of action configs. New kinds plug in here. */
export const ActionConfigSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('http'), config: HttpActionConfigSchema }),
  z.object({ kind: z.literal('reshape'), config: ReshapeActionConfigSchema }),
  z.object({ kind: z.literal('email'), config: EmailActionConfigSchema }),
  z.object({ kind: z.literal('spawn'), config: SpawnActionConfigSchema }),
  z.object({ kind: z.literal('wait'), config: WaitActionConfigSchema }),
]);

export type HttpMethod = z.infer<typeof HttpMethodSchema>;
export type WebhookTriggerConfig = z.infer<typeof WebhookTriggerConfigSchema>;
export type HttpActionConfig = z.infer<typeof HttpActionConfigSchema>;
export type ReshapeActionConfig = z.infer<typeof ReshapeActionConfigSchema>;
export type EmailActionConfig = z.infer<typeof EmailActionConfigSchema>;
export type SpawnTargetConfig = z.infer<typeof SpawnTargetSchema>;
export type SpawnActionConfig = z.infer<typeof SpawnActionConfigSchema>;
export type WaitActionConfig = z.infer<typeof WaitActionConfigSchema>;
export type ActionConfig = z.infer<typeof ActionConfigSchema>;

export const WorkflowAgentConfigSchema = z.object({
  model: z.string().optional(),
  skill: z.string().optional(),
  prompt: z.string().optional(),
  skillsDir: z.string().optional(),
  timeoutMs: z.number().positive().optional(),
  timeoutMinutes: z.number().optional(),
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

/**
 * Config for deterministic script steps (executor='script', plugin='script-container').
 * Exactly one of `command` (run in `image`) or `inlineScript` (run via `runtime`)
 * must be set. `image`/`dockerfile`/`repo`/`commit`/`repoAuth` mirror the agent
 * config fields — container plugins resolve image builds identically for both.
 */
export const ScriptStepConfigSchema = z.object({
  command: z.string().min(1).optional(),
  inlineScript: z.string().min(1).optional(),
  runtime: z.enum(['javascript', 'python', 'r', 'bash']).optional(),
  image: z.string().optional(),
  dockerfile: z.string().optional(),
  repo: z.string().optional(),
  commit: z.string().regex(/^[a-f0-9]{7,40}$/, 'commit must be a hex SHA (7-40 chars)').optional(),
  /** Name of a workflow secret containing a token for repo access. */
  repoAuth: z.string().optional(),
  timeoutMinutes: z.number().positive().optional(),
}).superRefine((config, ctx) => {
  if ((config.command !== undefined) === (config.inlineScript !== undefined)) {
    ctx.addIssue({
      code: 'custom',
      message: 'exactly one of command or inlineScript must be set',
    });
  }
  if (config.inlineScript !== undefined && config.runtime === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['runtime'],
      message: 'runtime is required when inlineScript is set',
    });
  }
});

/** Config for Databricks job steps (executor='script', plugin='databricks-job'). */
export const DatabricksJobConfigSchema = z.object({
  /** Numeric Databricks job id, or a string to allow `${...}` interpolation. */
  jobId: z.union([z.number().int().positive(), z.string().min(1)]),
  notebookParams: z.record(z.string(), z.string()).optional(),
  jobParameters: z.record(z.string(), z.string()).optional(),
  pollIntervalMs: z.number().int().positive().default(10_000),
  timeoutMinutes: z.number().positive().optional(),
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

/**
 * Run-scoped git workspace shared across all steps of a single workflow run.
 *
 * When set, the runtime creates one bare repo per workflow definition (host-cached)
 * and a fresh `git worktree` per run on branch `run/<runId>`. Every step in the run
 * mounts that worktree at `/workspace`. Commits are made per-step; pushes are
 * controlled by `push` and default to `never`.
 *
 * Distinct from `agentConfig.repo + commit` which drive image build source and
 * skills source (both still tied to immutable SHAs).
 */
export const WorkflowWorkspaceSchema = z.object({
  /** Remote git URL — "org/repo", SSH URL, HTTPS URL. When unset the bare repo is local-only. */
  remote: z.string().optional(),
  /** Name of a workflow secret holding a token for HTTPS auth to the remote. */
  remoteAuth: z.string().optional(),
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
  /** When true, an exception thrown by the step (e.g. action handler error,
   *  unexpected runtime failure) is logged as a warning and the workflow
   *  advances to the next step instead of failing the whole instance. The
   *  step execution is recorded with status='failed' so the failure stays
   *  visible in the audit trail. Useful for non-critical side-effects like
   *  email notifications where the rest of the pipeline must run regardless. */
  continueOnError: z.boolean().optional(),
  plugin: z.string().optional(),
  /** References an AgentDefinition by its deterministic slug (doc id).
   *  The referenced definition carries canonical MCP server bindings
   *  and runtime identity. Step-level mcpRestrictions narrow further.
   *  When unset, no MCP resolution runs for this step. */
  agentId: z.string().optional(),
  allowedRoles: z.array(z.string()).optional(),
  /** Pre-assigns the created human task to a specific user. Supports `${...}`
   *  interpolation against the run's trigger payload / step outputs
   *  (e.g. "${triggerPayload.userId}"). Only valid when executor='human' — the
   *  auto-runner resolves it, sets the result as the task's assignedUserId, and
   *  marks the task 'claimed'. Validation rejects it on non-human steps. */
  assignedTo: z.string().optional(),
  agent: WorkflowAgentConfigSchema.optional(),
  /** Required when executor='script' and plugin='script-container'. */
  script: ScriptStepConfigSchema.optional(),
  /** Required when executor='script' and plugin='databricks-job'. */
  databricks: DatabricksJobConfigSchema.optional(),
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
 * Script-executor plugins and the step config key they read. A plugin listed
 * here REQUIRES its config key on the step (and executor='script'); the
 * config keys are rejected everywhere else.
 */
const SCRIPT_PLUGIN_CONFIG_KEY: Record<string, 'script' | 'databricks'> = {
  'script-container': 'script',
  'databricks-job': 'databricks',
};

const SCRIPT_CONFIG_KEY_PLUGIN: Record<'script' | 'databricks', string> = {
  script: 'script-container',
  databricks: 'databricks-job',
};

/**
 * executor='action' steps must carry an `action` config; conversely, `action`
 * makes no sense on other executors. executor='script' steps carry their config
 * under `script` / `databricks` (matching the plugin) — the old shape with
 * script settings under `agent` (and `autonomyLevel`/`cowork` on script steps)
 * is rejected. Webhook triggers must declare a typed config (method+path) —
 * TriggerSchema accepts `config: z.record(...).optional()` for back-compat
 * with cron/manual, so we narrow webhook here.
 */
function validateExecutorAndTriggers(
  wd: {
    steps: Array<{
      id: string;
      executor: string;
      plugin?: string;
      action?: unknown;
      assignedTo?: string;
      agent?: unknown;
      autonomyLevel?: string;
      cowork?: unknown;
      script?: unknown;
      databricks?: unknown;
    }>;
    triggers: Array<{ type: string; config?: unknown }>;
  },
  ctx: z.RefinementCtx,
): void {
  wd.steps.forEach((step, i) => {
    const pluginConfigKey = step.plugin !== undefined ? SCRIPT_PLUGIN_CONFIG_KEY[step.plugin] : undefined;

    for (const configKey of ['script', 'databricks'] as const) {
      if (step[configKey] === undefined) continue;
      if (step.executor !== 'script') {
        ctx.addIssue({
          code: 'custom',
          path: ['steps', i, configKey],
          message: `step '${step.id}' has ${configKey} config but executor is '${step.executor}' (must be 'script')`,
        });
      }
      if (pluginConfigKey !== configKey) {
        ctx.addIssue({
          code: 'custom',
          path: ['steps', i, configKey],
          message: `step '${step.id}' has ${configKey} config but plugin is '${step.plugin ?? 'unset'}' (expected '${SCRIPT_CONFIG_KEY_PLUGIN[configKey]}')`,
        });
      }
    }

    if (pluginConfigKey !== undefined && step.executor !== 'script') {
      ctx.addIssue({
        code: 'custom',
        path: ['steps', i, 'plugin'],
        message: `step '${step.id}': plugin '${step.plugin}' requires executor='script' (got '${step.executor}')`,
      });
    }

    if (step.executor === 'script') {
      if (pluginConfigKey !== undefined && step[pluginConfigKey] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['steps', i, pluginConfigKey],
          message: `step '${step.id}' has plugin '${step.plugin}' but no ${pluginConfigKey} config`,
        });
      }
      if (step.agent !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['steps', i, 'agent'],
          message: `step '${step.id}': agent config is not allowed on script steps — script settings moved to step.script`,
        });
      }
      if (step.autonomyLevel !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['steps', i, 'autonomyLevel'],
          message: `step '${step.id}': autonomyLevel is not allowed on script steps (scripts are deterministic — remove the field)`,
        });
      }
      if (step.cowork !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['steps', i, 'cowork'],
          message: `step '${step.id}': cowork config is not allowed on script steps`,
        });
      }
    }

    if (step.assignedTo !== undefined && step.executor !== 'human') {
      ctx.addIssue({
        code: 'custom',
        path: ['steps', i, 'assignedTo'],
        message: `step '${step.id}' has assignedTo but executor is '${step.executor}' (assignedTo is only valid on executor='human')`,
      });
    }
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
    if (step.executor === 'action' && step.action !== undefined) {
      const action = step.action as { kind: string; config: Record<string, unknown> };
      if (action.kind === 'spawn' && action.config.forEach && Array.isArray(action.config.targets)) {
        ctx.addIssue({
          code: 'custom',
          path: ['steps', i, 'action', 'config', 'forEach'],
          message: `step '${step.id}': forEach requires a single target template, not an array`,
        });
      }
      if (action.kind === 'wait') {
        const c = action.config as { duration?: { seconds?: number; minutes?: number; hours?: number }; deadline?: string };
        if ((c.duration !== undefined) === (c.deadline !== undefined)) {
          ctx.addIssue({
            code: 'custom',
            path: ['steps', i, 'action', 'config'],
            message: `step '${step.id}': exactly one of duration or deadline must be set`,
          });
        }
        if (c.duration) {
          const total = (c.duration.seconds ?? 0) + (c.duration.minutes ?? 0) + (c.duration.hours ?? 0);
          if (total === 0) {
            ctx.addIssue({
              code: 'custom',
              path: ['steps', i, 'action', 'config', 'duration'],
              message: `step '${step.id}': duration must be greater than zero`,
            });
          }
        }
      }
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

function validateTriggerInput(
  wd: {
    triggerInput?: Array<{ name: string; type?: string }>;
  },
  ctx: z.RefinementCtx,
): void {
  if (!wd.triggerInput) return;
  const seen = new Set<string>();
  wd.triggerInput.forEach((field, i) => {
    if (seen.has(field.name)) {
      ctx.addIssue({
        code: 'custom',
        path: ['triggerInput', i, 'name'],
        message: `triggerInput[${i}].name '${field.name}' is duplicated (must be unique)`,
      });
    }
    seen.add(field.name);
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
 * L3 agent revision loop in workflow-engine's `complete-human-task.ts`
 * (`isL3Revise`) keys off the literal 'revise' verdict. Allowing custom
 * verdicts on L3 steps would silently break the loop. Lifting this is
 * tracked in #391.
 */
const L3_VERDICT_KEYS = ['approve', 'revise'] as const; // see #391 — lift this allowlist when isL3Revise generalises to a per-verdict loopBack flag

function validateVerdicts(
  wd: {
    steps: Array<{
      id: string;
      autonomyLevel?: string;
      verdicts?: Record<string, { target: string }> | undefined;
    }>;
  },
  ctx: z.RefinementCtx,
): void {
  const stepIds = new Set(wd.steps.map((s) => s.id));
  wd.steps.forEach((step, i) => {
    if (!step.verdicts) return;
    const keys = Object.keys(step.verdicts);
    if (step.autonomyLevel === 'L3') {
      for (const key of keys) {
        if (!L3_VERDICT_KEYS.includes(key as 'approve' | 'revise')) {
          ctx.addIssue({
            code: 'custom',
            path: ['steps', i, 'verdicts', key],
            message: `verdict key '${key}' on L3 step '${step.id}' not allowed — L3 revision loop requires one of: ${L3_VERDICT_KEYS.join(', ')}`,
          });
        }
      }
    }
    for (const [key, verdict] of Object.entries(step.verdicts)) {
      if (!stepIds.has(verdict.target)) {
        ctx.addIssue({
          code: 'custom',
          path: ['steps', i, 'verdicts', key, 'target'],
          message: `verdict '${key}' on step '${step.id}' targets '${verdict.target}' which does not match any step id`,
        });
      }
    }
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
export const TriggerInputFieldSchema = StepParamSchema.extend({
  type: z.enum(['string', 'number', 'boolean', 'date', 'datetime', 'select', 'multiselect', 'textarea']).default('string'),
});

export type TriggerInputField = z.infer<typeof TriggerInputFieldSchema>;

export const WorkflowVisibilitySchema = z.enum(['public', 'private']);
export type WorkflowVisibility = z.infer<typeof WorkflowVisibilitySchema>;

export const WorkflowDefinitionBaseSchema = z.object({
  name: z.string().min(1),
  version: z.number().int().positive(),
  /** Workspace namespace that owns this definition. Required because
   *  MCP resolution, workflow secret lookups, and the namespace-scoped
   *  tool catalog all key off this field — a workflow without one is
   *  not a runnable workflow. */
  namespace: z.string().min(1),
  visibility: WorkflowVisibilitySchema.default('private'),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  preamble: z.string().optional(),
  repo: RepoSchema.optional(),
  url: z.string().url().optional(),
  roles: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  notifications: z.array(ProcessNotificationConfigSchema).optional(),
  workspace: WorkflowWorkspaceSchema.optional(),
  steps: z.array(WorkflowStepSchema).min(1),
  transitions: z.array(TransitionSchema),
  triggers: z.array(TriggerSchema).min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  copiedFrom: z.object({
    namespace: z.string().min(1),
    name: z.string().min(1),
    version: z.number().int().positive(),
  }).optional(),
  archived: z.boolean().optional(),
  deleted: z.boolean().optional(),
  createdAt: z.string().datetime().optional(),
  inputForNextRun: z.array(InputForNextRunEntrySchema).optional(),
  triggerInput: z.array(TriggerInputFieldSchema).optional(),
});

export const WorkflowDefinitionSchema = WorkflowDefinitionBaseSchema.superRefine(
  (wd, ctx) => {
    validateInputForNextRun(wd, ctx);
    validateExecutorAndTriggers(wd, ctx);
    validateVerdicts(wd, ctx);
    validateTriggerInput(wd, ctx);
  },
);

export { validateInputForNextRun, validateExecutorAndTriggers, validateVerdicts, validateTriggerInput };

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
      validateVerdicts(wd, ctx);
      validateTriggerInput(wd, ctx);
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
  validateVerdicts(wd, ctx);
  validateTriggerInput(wd, ctx);
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
export type ScriptStepConfig = z.infer<typeof ScriptStepConfigSchema>;
export type DatabricksJobConfig = z.infer<typeof DatabricksJobConfigSchema>;
export type WorkflowCoworkConfig = z.infer<typeof WorkflowCoworkConfigSchema>;
export type WorkflowReviewConfig = z.infer<typeof WorkflowReviewConfigSchema>;
export type WorkflowWorkspace = z.infer<typeof WorkflowWorkspaceSchema>;
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
export type InputForNextRunEntry = z.infer<typeof InputForNextRunEntrySchema>;

/**
 * Effective step timeout in minutes, regardless of executor flavour.
 * Mirrors the runtime's historical default of 30 minutes (agent-runner).
 */
export function resolveStepTimeoutMinutes(
  step: Pick<WorkflowStep, 'agent' | 'script' | 'databricks'>,
): number {
  return step.agent?.timeoutMinutes
    ?? step.script?.timeoutMinutes
    ?? step.databricks?.timeoutMinutes
    ?? 30;
}
