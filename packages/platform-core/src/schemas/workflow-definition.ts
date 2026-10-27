import { z } from 'zod';
import {
  StepParamSchema,
  VerdictSchema,
  SelectionSchema,
  StepUiSchema,
  TransitionSchema,
  RepoSchema,
  CommitShaSchema,
} from './process-definition';
import { ProcessNotificationConfigSchema } from './process-config';
import { BuildContextSchema } from '../utils/docker-build-paths';
import { invalidTimeoutMessage, parseIsoDurationMs } from '../utils/iso-duration';
import { McpServerConfigSchema } from './mcp-server-config';
import { StepMcpRestrictionSchema } from './agent-mcp-binding';
import { AgentSkillRefsSchema } from './agent-definition';
import { AgentOutputSchemaSchema, OutputSchemaPropertyTypeSchema } from './agent-output-schema';

export { AgentOutputSchemaSchema, OutputSchemaPropertyTypeSchema };

/** HTTP method enum used by the http action handler and (via the detached
 *  Trigger resource) webhook triggers. */
export const HttpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);

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

/** collect action config: read the results of the runs this run spawned.
 *  `step` narrows each child's output to one of its steps; without it the
 *  child's whole variables map is returned. */
export const CollectActionConfigSchema = z.object({
  step: z.string().min(1).optional(),
});

/** run-workflow action config: spawn one child, park the run until it ends or
 *  `timeout` (an ISO 8601 duration, interpolated) passes, and return that
 *  child's result. `step` narrows its output the way collect's does. */
export const RunWorkflowActionConfigSchema = SpawnTargetSchema.extend({
  timeout: z.string().min(1),
  step: z.string().min(1).optional(),
});

/** Discriminated union of action configs. New kinds plug in here. */
export const ActionConfigSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('http'), config: HttpActionConfigSchema }),
  z.object({ kind: z.literal('reshape'), config: ReshapeActionConfigSchema }),
  z.object({ kind: z.literal('email'), config: EmailActionConfigSchema }),
  z.object({ kind: z.literal('spawn'), config: SpawnActionConfigSchema }),
  z.object({ kind: z.literal('wait'), config: WaitActionConfigSchema }),
  z.object({ kind: z.literal('collect'), config: CollectActionConfigSchema }),
  z.object({ kind: z.literal('run-workflow'), config: RunWorkflowActionConfigSchema }),
]);

export type HttpMethod = z.infer<typeof HttpMethodSchema>;
export type HttpActionConfig = z.infer<typeof HttpActionConfigSchema>;
export type ReshapeActionConfig = z.infer<typeof ReshapeActionConfigSchema>;
export type EmailActionConfig = z.infer<typeof EmailActionConfigSchema>;
export type SpawnTargetConfig = z.infer<typeof SpawnTargetSchema>;
export type SpawnActionConfig = z.infer<typeof SpawnActionConfigSchema>;
export type WaitActionConfig = z.infer<typeof WaitActionConfigSchema>;
export type CollectActionConfig = z.infer<typeof CollectActionConfigSchema>;
export type RunWorkflowActionConfig = z.infer<typeof RunWorkflowActionConfigSchema>;
export type ActionConfig = z.infer<typeof ActionConfigSchema>;

/**
 * Shared container-image configuration, merged flat into both
 * WorkflowAgentConfigSchema and ScriptStepConfigSchema so the fields
 * are not copy-pasted across both definitions.
 *
 * Two mutually exclusive execution modes:
 *
 *   Prebuilt mode  — supply `image` (and nothing else from this group).
 *                    The runtime pulls the named tag as-is.
 *
 *   Build mode     — supply `dockerfile` + `repo` + `commit`.
 *                    The runtime clones `repo` at `commit`, builds the
 *                    Dockerfile, and runs the resulting image.
 *                    `image` is optional in build mode: when omitted the
 *                    runtime derives a deterministic tag from
 *                    sha256(repo + commit + dockerfile [+ context]) so repeated builds
 *                    of the same source hit the local image cache.
 *                    Supply `image` explicitly to control the registry tag
 *                    or when you push to a shared registry.
 *
 * A `dockerfile` with no `repo`/`commit` builds from the files the workflow
 * carries (`artifacts`); see `carriedDockerfile`.
 */
export const ContainerSchema = z.object({
  /**
   * Docker image tag (e.g. `mediforce-golden-image:latest`).
   * Required in prebuilt mode; optional in build mode (auto-derived when absent).
   */
  image: z.string().optional(),
  /**
   * Path to a Dockerfile inside the cloned `repo`. Activates build mode.
   * From the repo root, or from `context` when one is set.
   */
  dockerfile: z.string().optional(),
  /**
   * Build context directory inside `repo`, from its root. Absent: the
   * directory `dockerfile` sits in, so a Dockerfile in `container/` cannot
   * `COPY` from `scripts/` — set `context: "."` to build from the repo root.
   */
  context: BuildContextSchema.optional(),
  /** Git repository URL for the Docker build context (SSH or HTTPS). */
  repo: z.string().optional(),
  /**
   * Commit SHA (7–40 hex chars) to check out from `repo`.
   * Must be set whenever `repo` is set — omitting it silently no-ops the build.
   */
  commit: CommitShaSchema.optional(),
  /** Name of a workflow secret containing a token for cloning a private repo. */
  repoAuth: z.string().optional(),
});

/** Maximum run time of a step, shared by every executor flavour that runs one
 *  (agent, script, databricks); see {@link resolveStepTimeoutMinutes}. */
export const StepTimeoutMinutesSchema = z.number().positive();

const FILE_SKILL_RETIRED =
  'file skills (skill / skillsDir) were retired (ADR-0028): name the skill in agent.skills from the Skill catalog, ' +
  'and import it with `mediforce skill import` if it lives in git';

export const WorkflowAgentConfigSchema = z.object({
  model: z.string().optional(),
  prompt: z.string().optional(),
  /** Catalog Skills this step offers on top of its agent's (ADR-0027). A
   *  Skill of the agent's with the same id is replaced by the step's. */
  skills: AgentSkillRefsSchema.optional(),
  /** Refused with a pointer to `skills`, so a file written before ADR-0028 is
   *  not registered without the skill it names. */
  skill: z.never({ error: FILE_SKILL_RETIRED }).optional(),
  skillsDir: z.never({ error: FILE_SKILL_RETIRED }).optional(),
  /**
   * The file skill (`<skillsDir>/<skill>`) a version stored before ADR-0028
   * named, set by migration 0079 and never by a caller. Saving refuses it and
   * running fails on it, rather than running the step without its skill.
   */
  retiredFileSkill: z.string().optional(),
  timeoutMinutes: StepTimeoutMinutesSchema.optional(),
  /** Shown to the agent in its prompt and checked against `result` after the
   *  run: one LLM call reshapes a violating result, then the run is escalated. */
  outputSchema: AgentOutputSchemaSchema.optional(),
  /** @deprecated Step-level MCP configuration is being removed.
   *  Move servers onto the agent via AgentDefinition.mcpServers and
   *  narrow them at the step via WorkflowStep.mcpRestrictions.
   *  Step 2 of the MCP permissions refactor will migrate existing
   *  workflows and drop this field. Still parsed for backward-compat. */
  mcpServers: z.array(McpServerConfigSchema).optional(),
}).merge(ContainerSchema);

/**
 * Config for deterministic script steps (executor='script', plugin='script-container').
 * Exactly one of `command` (run in `image`) or `inlineScript` (run via `runtime`)
 * must be set. Container image fields (`image`, `dockerfile`, `context`, `repo`, `commit`,
 * `repoAuth`) are shared with agent steps via ContainerSchema — both executor
 * flavours resolve container images identically.
 */
export const ScriptStepConfigSchema = z.object({
  command: z.string().min(1).optional(),
  inlineScript: z.string().min(1).optional(),
  runtime: z.enum(['javascript', 'python', 'r', 'bash']).optional(),
  timeoutMinutes: StepTimeoutMinutesSchema.optional(),
}).merge(ContainerSchema).superRefine((config, ctx) => {
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
  /** Run-state poll cadence; the plugin defaults to 10s when unset. */
  pollIntervalMs: z.number().int().positive().optional(),
  timeoutMinutes: StepTimeoutMinutesSchema.optional(),
});

export const DatabricksSqlConfigSchema = z.object({
  warehouseId: z.string().min(1),
  statement: z.string().min(1),
  parameters: z.record(z.string(), z.string()).optional(),
  pollIntervalMs: z.number().int().positive().optional(),
  timeoutMinutes: StepTimeoutMinutesSchema.optional(),
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
  outputSchemaRef: z.enum(['workflow-definition-authorable']).optional(),
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
 * mounts that worktree at `/workspace`. Commits are made per-step; run branches
 * are never pushed.
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
  /** Id of an earlier step this (executor='human') step reviews the Agent Run
   *  of — lets a plain review step feed `human_verdict` Scores the same way
   *  an L3 agent-escalation review does. */
  reviewsAgentStep: z.string().min(1).optional(),
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
   *  (e.g. "${triggerPayload.userId}"). Valid when executor='human', or when
   *  executor='agent' (it names who reviews the agent's output at L3) — the
   *  task creator resolves it, sets the result as the task's assignedUserId, and
   *  marks the task 'claimed'. Validation rejects it on any other step. */
  assignedTo: z.string().optional(),
  agent: WorkflowAgentConfigSchema.optional(),
  /** Required when executor='script' and plugin='script-container'. */
  script: ScriptStepConfigSchema.optional(),
  /** Required when executor='script' and plugin='databricks-job'. */
  databricks: DatabricksJobConfigSchema.optional(),
  databricksSql: DatabricksSqlConfigSchema.optional(),
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
const SCRIPT_PLUGIN_CONFIG_KEY: Record<string, 'script' | 'databricks' | 'databricksSql'> = {
  'script-container': 'script',
  'databricks-job': 'databricks',
  'databricks-sql': 'databricksSql',
};

const SCRIPT_CONFIG_KEY_PLUGIN: Record<'script' | 'databricks' | 'databricksSql', string> = {
  script: 'script-container',
  databricks: 'databricks-job',
  databricksSql: 'databricks-sql',
};

/**
 * The step config key `plugin` requires, or `undefined` when the plugin reads
 * no script config (or there is no plugin — e.g. a terminal step, whose
 * `executor` is filler the schema demands but the runtime never honours).
 *
 * Exported so the editor's pre-save check reads the requirement off the same
 * map this refinement does, rather than restating it.
 */
function scriptConfigKeyForPlugin(
  plugin: string | undefined,
): 'script' | 'databricks' | 'databricksSql' | undefined {
  return plugin === undefined ? undefined : SCRIPT_PLUGIN_CONFIG_KEY[plugin];
}

/**
 * executor='action' steps must carry an `action` config; conversely, `action`
 * makes no sense on other executors. executor='script' steps carry their config
 * under `script` / `databricks` (matching the plugin) — the old shape with
 * script settings under `agent` (and `autonomyLevel`/`cowork` on script steps)
 * is rejected.
 */
function validateSteps(
  wd: {
    steps: Array<{
      id: string;
      executor: string;
      plugin?: string;
      action?: unknown;
      assignedTo?: string;
      agent?: { outputSchema?: unknown };
      autonomyLevel?: string;
      cowork?: unknown;
      script?: unknown;
      databricks?: unknown;
      databricksSql?: unknown;
    }>;
  },
  ctx: z.RefinementCtx,
): void {
  wd.steps.forEach((step, i) => {
    const pluginConfigKey = scriptConfigKeyForPlugin(step.plugin);

    for (const configKey of ['script', 'databricks', 'databricksSql'] as const) {
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

    if (step.agent?.outputSchema !== undefined && step.executor !== 'agent') {
      ctx.addIssue({
        code: 'custom',
        path: ['steps', i, 'agent', 'outputSchema'],
        message: `step '${step.id}' has agent.outputSchema but executor is '${step.executor}' (only executor='agent' enforces it)`,
      });
    }

    if (step.assignedTo !== undefined && step.executor !== 'human' && step.executor !== 'agent') {
      ctx.addIssue({
        code: 'custom',
        path: ['steps', i, 'assignedTo'],
        message: `step '${step.id}' has assignedTo but executor is '${step.executor}' (assignedTo is only valid on executor='human' or 'agent')`,
      });
    }
    if (step.assignedTo !== undefined && step.executor === 'agent' && (step.autonomyLevel ?? 'L2') !== 'L3') {
      ctx.addIssue({
        code: 'custom',
        path: ['steps', i, 'assignedTo'],
        message: `step '${step.id}' has assignedTo on an agent step that is not autonomyLevel 'L3' (only L3 creates a human review task to assign)`,
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
      if (action.kind === 'run-workflow') {
        const timeout = String(action.config.timeout);
        const timeoutMs = timeout.includes('${') ? undefined : parseIsoDurationMs(timeout);
        if (timeoutMs === null || timeoutMs === 0) {
          ctx.addIssue({
            code: 'custom',
            path: ['steps', i, 'action', 'config', 'timeout'],
            message: `step '${step.id}': ${invalidTimeoutMessage(timeout)}`,
          });
        }
      }
    }
  });
}

/** A stored step that still names a retired file skill (ADR-0028) is not
 *  saved again as it is: the new version would fail on its first run. */
function validateNoRetiredFileSkills(
  wd: { steps: WorkflowStep[] },
  ctx: z.RefinementCtx,
): void {
  wd.steps.forEach((step, index) => {
    const retired = step.agent?.retiredFileSkill;
    if (retired === undefined) return;
    ctx.addIssue({
      code: 'custom',
      path: ['steps', index, 'agent', 'retiredFileSkill'],
      message: `step '${step.id}' uses the file skill '${retired}', which no longer runs (ADR-0028): ` +
        'remove it and name the skill in agent.skills from the Skill catalog',
    });
  });
}

/**
 * Artifacts have to survive being written to a directory: two files cannot
 * share a path, a file cannot sit where another needs a directory, and the set
 * cannot outgrow the definition that carries it. Each is refused here rather
 * than failing halfway through materializing a run.
 */
function validateArtifacts(
  wd: { artifacts?: Array<{ path: string; contents: string }> },
  ctx: z.RefinementCtx,
): void {
  if (!wd.artifacts) return;
  validateFileTree(wd.artifacts, ['artifacts'], ctx, 'put what is bigger in an image or a repository', WORKFLOW_ARTIFACTS_MAX_TOTAL_BYTES);
}

/**
 * The checks any set of text files written to one directory needs: no path
 * used twice, no path used as both a file and a directory, and the whole set
 * within `maxBytes`. `field` is where the files sit in the parsed object, so an
 * issue points at the offending entry; `overflowHint` tells the author where
 * bigger content belongs.
 */
export function validateFileTree(
  files: ReadonlyArray<{ path: string; contents: string }>,
  field: ReadonlyArray<string>,
  ctx: z.RefinementCtx,
  overflowHint: string,
  maxBytes: number,
): void {
  const label = field[field.length - 1] ?? 'files';
  const byPath = new Map<string, number>();
  files.forEach((file, i) => {
    const seenAt = byPath.get(file.path);
    if (seenAt !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [...field, i, 'path'],
        message: `${label}[${i}].path '${file.path}' is already used by ${label}[${String(seenAt)}]`,
      });
      return;
    }
    byPath.set(file.path, i);
  });

  // A directory prefix of another file cannot also be a file. Checked against
  // every ancestor rather than only the parent, so `a` conflicting with
  // `a/b/c` is caught too.
  files.forEach((file, i) => {
    const segments = file.path.split('/');
    for (let depth = 1; depth < segments.length; depth += 1) {
      const ancestor = segments.slice(0, depth).join('/');
      if (byPath.has(ancestor)) {
        ctx.addIssue({
          code: 'custom',
          path: [...field, i, 'path'],
          message: `${label}[${i}].path '${file.path}' needs '${ancestor}' to be a directory, but ${label}[${String(byPath.get(ancestor))}] is a file at that path`,
        });
        return;
      }
    }
  });

  const total = fileTreeBytes(files);
  if (total > maxBytes) {
    ctx.addIssue({
      code: 'custom',
      path: [...field],
      message: `${label} total ${String(total)} bytes, over the ${String(maxBytes)} byte limit — ${overflowHint}`,
    });
  }
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
/** `object` carries an opaque JSON object whose contents the Definition does not
 *  enumerate — the escape hatch for a proxied third-party body (ADR-0012). It is
 *  the only way un-enumerable input enters a Run: the validator checks it is a
 *  non-null, non-array JSON object and nothing else. An opaque top-level array
 *  nests under such a field rather than getting its own type. */
export const TriggerInputFieldSchema = StepParamSchema.extend({
  type: z.enum(['string', 'number', 'boolean', 'date', 'datetime', 'select', 'multiselect', 'textarea', 'object']).default('string'),
});

export type TriggerInputField = z.infer<typeof TriggerInputFieldSchema>;

export const WorkflowVisibilitySchema = z.enum(['public', 'private']);
export type WorkflowVisibility = z.infer<typeof WorkflowVisibilitySchema>;

/**
 * Provenance of a Workflow Definition imported from a git repo. Reuses
 * `RepoSchema` (`url`) minus `auth` (provenance never clones, so a token would
 * be meaningless), plus the `path` of the imported `.wd.json`. `commit` is the
 * immutable SHA resolved from the requested ref at import time — the import
 * *input* still accepts a branch/tag/SHA, but only the resolved commit is
 * stored. Informational only — no automatic sync. See ADR-0009.
 */
export const WorkflowSourceSchema = RepoSchema.omit({ auth: true }).extend({
  commit: CommitShaSchema,
  path: z.string().min(1),
});
export type WorkflowSource = z.infer<typeof WorkflowSourceSchema>;

/** Bytes one artifact may hold. Generous for a Dockerfile, a script or a
 *  SKILL.md, and small enough that a definition stays a definition. */
export const WORKFLOW_ARTIFACT_MAX_BYTES = 64 * 1024;

/** Bytes every artifact of a workflow may hold together. The set rides in the
 *  definition row and is read on every fetch of it, so the total is capped as
 *  well as each file. Anything beyond this is a dependency, not a workflow
 *  file: it belongs in an image or a repository. */
export const WORKFLOW_ARTIFACTS_MAX_TOTAL_BYTES = 256 * 1024;

/** UTF-8 length, which is what a stored definition actually costs — a
 *  character count would let four-byte characters through the cap. */
function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** The bytes a set of files costs against a total cap
 *  ({@link WORKFLOW_ARTIFACTS_MAX_TOTAL_BYTES}, {@link SKILL_MAX_TOTAL_BYTES}):
 *  every path and its contents, as UTF-8. */
export function fileTreeBytes(files: ReadonlyArray<{ path: string; contents: string }>): number {
  return files.reduce((sum, file) => sum + utf8Bytes(file.path) + utf8Bytes(file.contents), 0);
}

/**
 * A file a workflow carries with it: a script a step runs, a Dockerfile its
 * image is built from, a SKILL.md an agent reads. Text only, and part of the
 * definition, so it versions with the workflow and needs no git checkout to
 * reach a run.
 *
 * `path` is materialized onto the host before a run, so it has to be a plain
 * relative posix path: anything that escapes the directory (`..`, a leading
 * `/`) or that a filesystem would refuse (`\`, an empty segment) is rejected
 * here rather than at write time. `.mediforce/` is the engine's own directory
 * inside a run workspace and is not an author's to write.
 */
export const WorkflowArtifactPathSchema = z.string()
  .min(1, 'artifact path is required')
  .max(512, 'artifact path is too long')
  .refine((value) => value.startsWith('/') === false, 'artifact path must be relative')
  .refine((value) => value.includes('\\') === false, 'artifact path must use forward slashes')
  .refine(
    (value) => value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..'),
    'artifact path must not contain empty, "." or ".." segments',
  )
  .refine(
    (value) => value.split('/')[0] !== '.mediforce',
    '.mediforce is written by the platform, so it cannot hold an artifact',
  );

/** Stored as `jsonb`, which cannot represent U+0000, so it is refused here
 *  as a validation error rather than surfacing as a database failure. */
export const ArtifactTextSchema = z.string().refine(
  (value) => value.includes('\u0000') === false,
  'artifact must be text; it contains a NUL character',
);

export const WorkflowArtifactSchema = z.object({
  path: WorkflowArtifactPathSchema,
  contents: ArtifactTextSchema.refine(
    (value) => utf8Bytes(value) <= WORKFLOW_ARTIFACT_MAX_BYTES,
    `artifact is larger than ${String(WORKFLOW_ARTIFACT_MAX_BYTES)} bytes`,
  ),
});
export type WorkflowArtifact = z.infer<typeof WorkflowArtifactSchema>;

/**
 * What a version looked like before migration 0079 (ADR-0028) retired file
 * skills and `externalSkillsRepo`: its steps verbatim (`skill` / `skillsDir`
 * included) and the repo the definition read skills and build contexts from.
 * Written once by the migration, read-only afterwards, so the author can see
 * what to move into the Skill catalog. Steps stay `unknown`: they no longer
 * parse as {@link WorkflowStepSchema}.
 */
export const LegacyDefinitionSchema = z.object({
  steps: z.array(z.unknown()),
  externalSkillsRepo: z.object({
    url: z.string(),
    commit: z.string(),
    auth: z.string().optional(),
  }).optional(),
});
export type LegacyDefinition = z.infer<typeof LegacyDefinitionSchema>;

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
  /** Refused, so a file written before ADR-0028 does not register with its
   *  skills gone and a bare `dockerfile` quietly handed the golden image. */
  externalSkillsRepo: z.never({
    error: 'externalSkillsRepo was retired (ADR-0028): import its skills with `mediforce skill import` and name them in ' +
      'agent.skills; a step that built from it sets its own repo + commit',
  }).optional(),
  url: z.string().url().optional(),
  roles: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  notifications: z.array(ProcessNotificationConfigSchema).optional(),
  workspace: WorkflowWorkspaceSchema.optional(),
  steps: z.array(WorkflowStepSchema).min(1),
  transitions: z.array(TransitionSchema),
  metadata: z.record(z.string(), z.unknown()).optional(),
  copiedFrom: z.object({
    namespace: z.string().min(1),
    name: z.string().min(1),
    version: z.number().int().positive(),
  }).optional(),
  source: WorkflowSourceSchema.optional(),
  archived: z.boolean().optional(),
  deleted: z.boolean().optional(),
  createdAt: z.string().datetime().optional(),
  inputForNextRun: z.array(InputForNextRunEntrySchema).optional(),
  triggerInput: z.array(TriggerInputFieldSchema).optional(),
  /** Files this workflow carries: scripts its steps run, a Dockerfile its image
   *  is built from, skills its agents read. See {@link WorkflowArtifactSchema}. */
  artifacts: z.array(WorkflowArtifactSchema).optional(),
  /** Server-managed, see {@link LegacyDefinitionSchema}. */
  legacyDefinition: LegacyDefinitionSchema.optional(),
});

/**
 * Fields the platform injects or manages at registration — never authored by
 * template files, the design LLM, or `validate` callers. The loader supplies
 * `namespace`; `version` and `createdAt` are assigned server-side (so is `legacyDefinition`, which only a migration writes). Single
 * source for every `.omit()` / strip that drops them, so the three call sites
 * that used to redeclare this set can no longer drift apart.
 */
export const SERVER_MANAGED_WORKFLOW_FIELDS = {
  namespace: true,
  version: true,
  createdAt: true,
  legacyDefinition: true,
} as const;

/**
 * The surface a workflow author controls — the design LLM's output schema (via
 * {@link getWorkflowAuthorableJsonSchema}). Built with `.pick()` rather than
 * `.omit()` so server-managed (`namespace`/`version`/`createdAt`) and lifecycle
 * (`copiedFrom`/`archived`/`deleted`) fields are excluded by construction: a
 * new lifecycle field added to the base schema cannot silently leak into the
 * authorable contract.
 */
export const WorkflowAuthorableSchema = WorkflowDefinitionBaseSchema.pick({
  name: true,
  visibility: true,
  title: true,
  description: true,
  preamble: true,
  url: true,
  roles: true,
  env: true,
  notifications: true,
  workspace: true,
  steps: true,
  transitions: true,
  metadata: true,
  inputForNextRun: true,
  triggerInput: true,
  artifacts: true,
});

export function getWorkflowAuthorableJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(WorkflowAuthorableSchema, { io: 'input' }) as Record<string, unknown>;
}

export function resolveCoworkOutputSchema(
  cowork: WorkflowCoworkConfig | undefined,
): Record<string, unknown> | null {
  if (!cowork) return null;
  if (cowork.outputSchema) return cowork.outputSchema;

  if (cowork.outputSchemaRef === undefined) return null;
  if (cowork.outputSchemaRef === 'workflow-definition-authorable') {
    return getWorkflowAuthorableJsonSchema();
  }

  const _exhaustive: never = cowork.outputSchemaRef;
  return _exhaustive;
}

export const WorkflowDefinitionSchema = WorkflowDefinitionBaseSchema.superRefine(
  (wd, ctx) => {
    validateInputForNextRun(wd, ctx);
    validateSteps(wd, ctx);
    validateVerdicts(wd, ctx);
    validateTriggerInput(wd, ctx);
    validateArtifacts(wd, ctx);
  },
);

export {
  validateInputForNextRun,
  validateSteps,
  validateVerdicts,
  validateTriggerInput,
  validateArtifacts,
  scriptConfigKeyForPlugin,
};

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
  return WorkflowDefinitionBaseSchema.omit({ version: true, createdAt: true, legacyDefinition: true })
    .superRefine((wd, ctx) => {
      validateInputForNextRun(wd, ctx);
      validateSteps(wd, ctx);
      validateVerdicts(wd, ctx);
      validateTriggerInput(wd, ctx);
      validateArtifacts(wd, ctx);
      validateNoRetiredFileSkills(wd, ctx);
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
export const WorkflowTemplateSchema = WorkflowDefinitionBaseSchema.omit(
  SERVER_MANAGED_WORKFLOW_FIELDS,
).superRefine((wd, ctx) => {
  validateInputForNextRun(wd, ctx);
  validateSteps(wd, ctx);
  validateVerdicts(wd, ctx);
  validateTriggerInput(wd, ctx);
  validateArtifacts(wd, ctx);
  validateNoRetiredFileSkills(wd, ctx);
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

export type ContainerConfig = z.infer<typeof ContainerSchema>;
export type WorkflowAgentConfig = z.infer<typeof WorkflowAgentConfigSchema>;
export type { AgentOutputSchema, OutputSchemaPropertyType } from './agent-output-schema';
export type ScriptStepConfig = z.infer<typeof ScriptStepConfigSchema>;
export type DatabricksJobConfig = z.infer<typeof DatabricksJobConfigSchema>;
export type DatabricksSqlConfig = z.infer<typeof DatabricksSqlConfigSchema>;
export type WorkflowCoworkConfig = z.infer<typeof WorkflowCoworkConfigSchema>;
export type WorkflowReviewConfig = z.infer<typeof WorkflowReviewConfigSchema>;
export type WorkflowWorkspace = z.infer<typeof WorkflowWorkspaceSchema>;
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
export type InputForNextRunEntry = z.infer<typeof InputForNextRunEntrySchema>;

/** How long a step may run when it names no timeout of its own. */
export const DEFAULT_STEP_TIMEOUT_MINUTES = 30;

/**
 * Effective step timeout in minutes, regardless of executor flavour.
 */
export function resolveStepTimeoutMinutes(
  step: Pick<WorkflowStep, 'agent' | 'script' | 'databricks' | 'databricksSql'>,
): number {
  return step.agent?.timeoutMinutes
    ?? step.script?.timeoutMinutes
    ?? step.databricks?.timeoutMinutes
    ?? step.databricksSql?.timeoutMinutes
    ?? DEFAULT_STEP_TIMEOUT_MINUTES;
}

/**
 * Effective step timeout in milliseconds — the raw bound at which a stranded
 * execution is reaped as a timeout (ADR-0010).
 */
export function resolveStepTimeoutMs(
  step: Pick<WorkflowStep, 'agent' | 'script' | 'databricks' | 'databricksSql'>,
): number {
  return resolveStepTimeoutMinutes(step) * 60_000;
}

/**
 * Grace added on top of a step's own timeout before a `running` instance is
 * treated as stranded. A live driver enforces the step timeout and then
 * advances/fails the step (refreshing `updatedAt`); this grace covers the gap
 * between the timeout firing and that write, plus queue/spawn latency, so a
 * driver about to enforce its own timeout is never pre-empted by the heartbeat.
 */
export const STRANDED_STEP_GRACE_MS = 15 * 60_000;

/**
 * How long a `running` instance may sit idle before its driver is presumed dead
 * and the heartbeat re-kicks it: the step's effective timeout + grace. Once
 * re-kicked, the re-entered driver reaps anything past the raw
 * {@link resolveStepTimeoutMs}. Single source so the heartbeat's sweep bound and
 * the driver's reap bound derive from the same timeout and can never drift.
 */
export function resolveStrandedBudgetMs(
  step: Pick<WorkflowStep, 'agent' | 'script' | 'databricks'>,
): number {
  return resolveStepTimeoutMs(step) + STRANDED_STEP_GRACE_MS;
}
