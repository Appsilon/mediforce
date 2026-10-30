'use client';

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Lock, User, Bot, Terminal, Users, PenLine, Search, GitBranch, Flag, AlertTriangle, CircleCheck, X } from 'lucide-react';
import { DatabricksLogo } from '../workflow-diagram';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { usePlugins } from '@/hooks/use-plugins';
import { usePinnedDefaultModel } from '@/hooks/use-model-registry';
import { useNamespaceMembers } from '@/hooks/use-namespace-members';
import { useWorkspaceRoles } from '@/hooks/use-workspace-roles';
import { useAuth } from '@/contexts/auth-context';
import { useAgentValidationStatuses, useAgentVersions, useStepQualification } from '@/hooks/use-step-evaluation';
import { mediforce } from '@/lib/mediforce';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { paramNameCounts } from '@/lib/workflow-save-utils';
import { parseJsonObjectText } from '@/lib/trigger-input-payload';

import { AgentOutputSchemaSchema, DEFAULT_AGENT_IMAGE, agentImageOf, agentStepChanges, DEFAULT_STEP_TIMEOUT_MINUTES, defaultVerdictLabel, scriptConfigKeyForPlugin, stepHasBuildSource, uniqueName, uniqueSlug } from '@mediforce/platform-core';
import type { AgentDefinition, AgentStepChange, WorkflowDefinition, WorkflowStep, HttpMethod, ActionConfig, SpawnTargetConfig } from '@mediforce/platform-core';
import type { DockerImageInfo, ImageCatalogEntryView, StepValidation } from '@mediforce/platform-api/contract';
import { ModelPicker } from './model-picker';
import { selectAgentPatch } from '../workflow-editor-utils';
import {
  STEP_TYPE_LABELS,
  RUNTIME_OPTIONS,
} from './constants';
import { CoworkSection } from './cowork-section';
import { OutputSchemaEditor } from './output-schema-editor';
import { StepUiConfigSection } from './step-ui-config-section';
import { StepDataFlow } from './step-data-flow';
import { FieldRow, FieldGroup, Section, PillToggle, inputBase, inputBaseMono, selectBase, textareaBase, humanizeToken } from './step-editor-fields';
import { ImageSourceFields } from './image-source-fields';
import { identityImageValue, pickerImageValue } from './image-options';
import { McpRestrictionsSection } from './mcp-restrictions-section';
import { StepSkillsField } from './step-skills-field';
import { McpCommandWarnings } from '@/components/agents/mcp-command-alert';
import { stdioServerCommands } from '@/components/agents/mcp-command-warnings';
import { useToolCatalogEntries } from '@/hooks/use-tool-catalog';
import { AllowedRolesField, AssignedToField } from './step-editor-roles';
import { CollapsibleCard } from './collapsible-card';
import { ModifyValidatedAgentDialog } from './modify-validated-agent-dialog';
import {
  buildImagePicker,
  requiredRuntimeFor,
  type ImagePickerGroup,
} from './image-picker-options';

/** Stable identity for "no catalog", so the picker memo is not defeated by a
 *  fresh array on every render of a caller that passes none. */
const NO_CATALOG_ENTRIES: ImageCatalogEntryView[] = [];

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** A saved agent with an Agent Version to validate: a plugin agent owned by a workspace. */
function isEvaluableAgent(agent: AgentDefinition): agent is AgentDefinition & { namespace: string } {
  return agent.kind === 'plugin' && agent.runtimeId !== undefined && agent.namespace !== undefined;
}

/** What a saved agent brings to every step that names it. */
function agentSummary(agent: AgentDefinition): string {
  return [
    agent.foundationModel,
    plural(agent.skills?.length ?? 0, 'skill'),
    plural(Object.keys(agent.mcpServers ?? {}).length, 'MCP server'),
  ].join(' · ');
}

function friendlyFieldError(message: string): string {
  if (/too small|>=1|at least 1/i.test(message)) return 'This field cannot be empty.';
  return message;
}

export function buildExecutorChangePatch(step: WorkflowStep, targetExecutor: WorkflowStep['executor']): Partial<WorkflowStep> {
  const SHARED_CONTAINER_KEYS = ['image', 'dockerfile', 'context', 'repo', 'commit', 'repoAuth'] as const;
  const base: Partial<WorkflowStep> = { executor: targetExecutor };

  if (targetExecutor === 'human') {
    return { ...base, plugin: undefined, agent: undefined, script: undefined, databricks: undefined, databricksSql: undefined, cowork: undefined };
  }
  if (targetExecutor === 'agent') {
    const carriedFromScript = step.script
      ? Object.fromEntries(Object.entries(step.script).filter(([k]) => SHARED_CONTAINER_KEYS.includes(k as typeof SHARED_CONTAINER_KEYS[number])))
      : undefined;
    const agent = step.agent ?? (Object.keys(carriedFromScript ?? {}).length > 0 ? carriedFromScript as WorkflowStep['agent'] : undefined);
    return {
      ...base, cowork: undefined, script: undefined, databricks: undefined, databricksSql: undefined,
      plugin: step.plugin === 'script-container' || step.plugin === 'databricks-job' || step.plugin === 'databricks-sql' ? 'opencode-agent' : step.plugin ?? 'opencode-agent',
      agent,
    };
  }
  if (targetExecutor === 'script') {
    const carriedFromAgent = step.agent
      ? Object.fromEntries(Object.entries(step.agent).filter(([k]) => SHARED_CONTAINER_KEYS.includes(k as typeof SHARED_CONTAINER_KEYS[number])))
      : undefined;
    const script = step.script ?? (Object.keys(carriedFromAgent ?? {}).length > 0 ? carriedFromAgent as WorkflowStep['script'] : undefined);
    return {
      ...base, allowedRoles: undefined, assignedTo: undefined, autonomyLevel: undefined, cowork: undefined, agent: undefined,
      plugin: step.plugin ?? 'script-container',
      script,
    };
  }
  return {
    ...base, plugin: undefined, autonomyLevel: undefined, allowedRoles: undefined, assignedTo: undefined,
    agent: undefined, script: undefined, databricks: undefined, databricksSql: undefined, cowork: step.cowork ?? { agent: 'chat' },
  };
}

const ri = inputBase;
const riMono = inputBaseMono;

function WorkflowTargetInputs({ target, onChange }: {
  target: SpawnTargetConfig;
  onChange: (patch: Pick<SpawnTargetConfig, 'definitionName' | 'definitionVersion'>) => void;
}) {
  return (
    <>
      <input
        value={target.definitionName}
        placeholder="workflow-name"
        onChange={(e) => onChange({ definitionName: e.target.value, definitionVersion: target.definitionVersion })}
        className={cn(riMono, 'flex-1 placeholder:italic placeholder:text-muted-foreground/40')}
      />
      <input
        type="number"
        min={1}
        value={target.definitionVersion ?? ''}
        placeholder="default"
        onChange={(e) => onChange({ definitionName: target.definitionName, definitionVersion: e.target.value ? Number(e.target.value) : undefined })}
        className={cn(ri, 'w-20 placeholder:italic placeholder:text-muted-foreground/40')}
      />
    </>
  );
}
const rs = selectBase;
const rt = textareaBase;

// ---------------------------------------------------------------------------
// Executor / step-type icon maps (mirrors workflow-diagram.tsx)
// ---------------------------------------------------------------------------

const EXECUTOR_ICON: Record<string, { icon: React.ElementType; color: string; bg: string; label: string }> = {
  human:  { icon: User,     color: 'text-blue-600 dark:text-blue-400',    bg: 'bg-blue-100 dark:bg-blue-900/30',    label: 'Human' },
  agent:  { icon: Bot,      color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-100 dark:bg-violet-900/30', label: 'Agent' },
  script: { icon: Terminal, color: 'text-amber-600 dark:text-amber-400',   bg: 'bg-amber-100 dark:bg-amber-900/30',  label: 'Script' },
  cowork: { icon: Users,    color: 'text-teal-600 dark:text-teal-400',     bg: 'bg-teal-100 dark:bg-teal-900/30',    label: 'Cowork' },
  action: { icon: Terminal, color: 'text-sky-600 dark:text-sky-400',       bg: 'bg-sky-100 dark:bg-sky-900/30',      label: 'Action' },
};

// A plugin listed here overrides its executor's icon/label in the header,
// so e.g. a Databricks script step reads as Databricks rather than "Script".
const PLUGIN_ICON: Record<string, { icon: React.ElementType; color: string; bg: string; label: string }> = {
  'databricks-job': { icon: DatabricksLogo, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-900/30', label: 'Databricks' },
  'databricks-sql': { icon: DatabricksLogo, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-900/30', label: 'Databricks' },
};

const STEP_TYPE_ICON: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  creation: { icon: PenLine,   color: 'text-blue-500 dark:text-blue-400',    label: 'Creation' },
  review:   { icon: Search,    color: 'text-amber-500 dark:text-amber-400',   label: 'Review' },
  decision: { icon: GitBranch, color: 'text-purple-500 dark:text-purple-400', label: 'Decision' },
  terminal: { icon: Flag,      color: 'text-emerald-500 dark:text-emerald-400', label: 'End' },
};

// ---------------------------------------------------------------------------
// Tooltip strings
// ---------------------------------------------------------------------------

const TIP = {
  name:                    'Human-readable name shown in the workflow diagram and task lists.',
  id:                      'Unique slug identifier used in transition targets and API references. Generated for new steps when the name is committed, and editable afterward.',
  description:             'Optional notes for collaborators explaining what this step does and why it exists.',
  type:                    'Structural role in the workflow: creation, review, decision, or terminal. Fixed at step creation.',
  executor:                'Who performs this step: human, agent, script, cowork, or action. Fixed at step creation.',

  autonomyLevel:           'Assist: agent runs and produces a draft; human approves. Human review: explicit human approval required. Autonomous agent: agent executes without review. L0/L1 are developer-only flags set via raw YAML.',
  plugin:                  'Runtime that runs the agent (e.g. opencode-agent, claude-code-agent). Filled in from the agent you pick; change it to run this step on another runtime.',
  pluginScript:            'Plugin that runs the script (usually script-container). Must be registered in the platform.',
  databricksKind:          'Job triggers an existing Databricks job and waits for its result. SQL runs one statement on a warehouse.',
  agentId:                 'Saved agent from the Agents page. Its system prompt, model, skills and MCP servers are used for this step; the fields below add to them.',
  agentModel:              'Leave on the default to run the agent\'s own model. Picking a model here replaces it for this step only; the agent itself is unchanged.',
  agentSkills:             'Skills offered to the agent in this step, on top of its own. The agent loads one when its description fits the task. A step skill replaces the agent\'s skill of the same name.',
  stepTimeoutMinutes:      `How long the step may run before it is stopped as timed out. Blank means ${DEFAULT_STEP_TIMEOUT_MINUTES} minutes.`,
  agentOutputSchema:       'JSON Schema the agent\'s result must match. Shown to the agent; a result that breaks it is reshaped once from what it already says (the agent is not rerun), and if that cannot fix it the run is escalated to a person with the reason.',
  agentPrompt:             'Instructions for this step, added after the agent\'s system prompt. The agent\'s own prompt still applies.',

  scriptRuntime:           'Language runtime for the inline script: javascript, python, r, or bash.',
  scriptCommand:           'Shell command to run in the container, typically to invoke a file from script.repo.',
  scriptInlineScript:      'Script source code to run directly in the container. Set the language via script.runtime.',

  databricksJobId:         'ID of an existing Databricks job to trigger. Supports ${steps.*} interpolation when given as a string.',
  databricksNotebookParams:'notebook_params for run-now as JSON object of string values. Values support ${steps.*} interpolation.',
  databricksJobParameters: 'job_parameters for run-now (jobs with job-level parameters) as JSON object of string values.',
  databricksPollIntervalMs:'How often to poll the run state, in milliseconds. Default 10000.',

  databricksSqlWarehouseId:'ID of the Databricks SQL Warehouse to run the statement on (from the warehouse\'s Connection Details).',
  databricksSqlStatement:  'SQL statement to run. Use :name placeholders for values from databricksSql.parameters — never interpolate values directly into this text.',
  databricksSqlParameters: 'Named parameters bound into the statement\'s :name placeholders. Values support ${steps.*} interpolation and are sent to Databricks as parameters, never concatenated into the statement.',
  databricksSqlPollIntervalMs: 'How often to poll the statement state, in milliseconds. Default 2000.',

  allowedRoles:            'Roles that can claim and complete this task. Enforced: a member holding none of them is refused, and a role nobody holds on this workflow makes the step unclaimable. Pick from the roles this workspace already knows, or type a new one. Leave empty to allow any workspace member.',
  assignedTo:              'Pre-assign this human task to a specific user. Pick a workspace member, or type an interpolated value like ${triggerPayload.userId} to assign per run. Human steps and Human Review agent steps only.',
  continueOnError:         'When on, a failure of this step is logged as a warning and the workflow advances anyway instead of failing the whole run. Use for non-critical side-effects (e.g. a notification), never for a step later steps depend on.',

  reviewType:              'Who performs the review: human (creates a task), agent (auto-evaluates), or none (skips review).',
  reviewPlugin:            'Plugin used when review.type is agent.',
  reviewMaxIterations:     'Maximum revision cycles before the review is auto-escalated. Prevents infinite feedback loops.',
  reviewTimeBoxDays:       'Calendar days before an unresolved review is automatically escalated.',
  selectionMin:            'Minimum number of reviewers required to reach a binding verdict.',
  selectionMax:            'Maximum number of reviewers who may participate in this review step.',

  actionKind:              'Action type: http (outbound API call), reshape (update workflow variables), email, spawn (run another workflow), wait (pause), collect (read back what spawned workflows produced) or run-workflow (run one workflow, wait for it and return its result). Fixed at creation.',
  actionTargets:           'The workflow(s) this step starts. Each target names a registered workflow; leave the version unset to use its default.',
  actionForEach:           'Interpolation path to an array — the step spawns one child per element, with ${item} bound to it. Leave empty to spawn each target once.',
  // Written explicitly rather than as absence, unlike the optional `allowSkip`
  // and `noteField`: `SpawnActionConfigSchema` gives this a `.default(true)`, so
  // its parsed type is a required boolean.
  actionContinueOnSpawnError: 'On by default: one child failing to start does not fail this step. Turn off to fail the step on the first error.',
  actionWaitDuration:      'How long to pause. Fields combine, so 1 hour 30 minutes is hours 1 + minutes 30.',
  actionWaitDeadline:      'Absolute time to wait until — an ISO timestamp, or an interpolation like ${steps.x.dueAt}. Takes precedence over a duration.',
  actionWaitCondition:     'Transition-language expression checked while waiting; the step proceeds as soon as it is true. `children.allFinished` is true once every spawned workflow has completed or failed, and when none were spawned.',
  actionCollectStep:       'Step id whose output to read from each spawned workflow. Leave empty to read all of its variables.',
  actionRunWorkflowName:   'The workflow this step runs; the version is its default unless pinned.',
  actionRunWorkflowPayload: 'Trigger payload for the workflow, as JSON. Values interpolate, e.g. ${steps.intake.case}.',
  actionRunWorkflowTimeout: 'ISO 8601 duration (P14D, PT2H) or an interpolation. When it passes, the step continues with the workflow\'s current status.',
  actionRunWorkflowStep:   'Step id whose output to return from the workflow. Leave empty to return all of its variables.',
  verdictLabel:            'Button text shown to the reviewer. Defaults to a title-cased form of the verdict key.',
  verdictIntent:           'Button styling: success, danger, warning or neutral. Defaults from the key for the common names.',
  verdictRequiresComment:  'Enforced server-side — the task cannot be completed on this verdict without a comment.',
  paramRequiredForVerdicts: 'Verdict keys that make this parameter mandatory. Leave empty to use the plain required flag.',
  actionMethod:            'HTTP method for the outbound request.',
  actionUrl:               'Target URL. Supports ${steps.<id>.<field>} and ${triggerPayload.<field>} interpolation — never put ${secrets.NAME} here, the resolved URL is persisted as this step\'s output.',
  actionBody:              'JSON body sent with the request. Supports ${steps.<id>.<field>} interpolation. Only the response is stored, so ${secrets.NAME} is safe here.',
  actionValues:            'Key-value pairs that become this step\'s output. Values support ${steps.<id>.<field>} interpolation — never put ${secrets.NAME} here, the resolved values are persisted.',
  actionTo:                'Recipient email address(es), comma-separated.',
  actionCc:                'CC recipients, comma-separated.',
  actionBcc:               'BCC recipients, comma-separated. Not visible to other recipients.',
  actionFrom:              'Sender address. Must be authorised by the configured email provider.',
  actionReplyTo:           'Reply-to address. Replies from recipients go here instead of action.from.',
  actionSubject:           'Email subject line. Supports ${steps.<id>.<field>} interpolation.',
  actionEmailBody:         'Plain-text email body. Displayed by clients that do not support HTML.',
  actionHtml:              'HTML email body. HTML-capable clients show this instead of the plain-text body.',

  verdictName:             'Verdict label (e.g. "approve", "reject"). Referenced in downstream transition conditions.',
  verdictTarget:           'The step to route to when this verdict is selected.',
  transitionWhen:          'Expression checked against this step\'s output, e.g. output.status == "ok". Leave empty to always take this transition, or use "else" to match only if no other condition on this step did. With more than one outgoing transition, every one of them needs a condition.',
  transitionTarget:        'The step this transition leads to.',

  paramName:               'Identifier for this parameter. Its submitted value becomes part of this step\'s output — later steps read it as ${steps.<this step id>.<name>}.',
  paramType:               'Data type: string, number, boolean, or date. Controls validation and the input widget shown to users.',
  paramRequired:           'When checked, the assignee cannot submit this task until the field has a value.',
  paramDescription:        'Hint text shown next to this field on the task form.',
  paramDefault:            'Value pre-filled on the task form. The assignee can overwrite it.',
  paramOptions:            'Fixed list of allowed values, comma-separated. Shown as a dropdown instead of a free-text input.',
};

// ---------------------------------------------------------------------------
// StepIdField
// ---------------------------------------------------------------------------

function StepIdField({ currentId, onChange, error }: { currentId: string; onChange: (v: string) => void; error?: string }) {
  const [draft, setDraft] = useState(currentId);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { if (!dirty) setDraft(currentId); }, [currentId, dirty]);

  const commit = useCallback(() => {
    const slug = draft.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (slug && slug !== currentId) onChange(slug);
    setDraft(slug || currentId);
    setDirty(false);
  }, [draft, currentId, onChange]);

  return (
    <input
      data-testid="step-id-field"
      value={draft}
      onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
      className={cn(riMono, error && 'border-red-400 focus:border-red-500')}
    />
  );
}

// Blank clears the payload; text that is not a JSON object stays in the box
// with the error shown and never replaces the last committed payload.
function JsonObjectPayloadField({ value, onChange, label, tooltip, placeholder }: {
  value: Record<string, unknown> | undefined;
  onChange: (payload: Record<string, unknown> | undefined) => void;
  label: string;
  tooltip: string;
  placeholder: string;
}) {
  const [draft, setDraft] = useState(value === undefined ? '' : JSON.stringify(value, null, 2));
  const rejected = draft.trim() !== '' && parseJsonObjectText(draft) === null;

  return (
    <FieldRow label={label} tooltip={tooltip} alignStart error={rejected ? 'Must be a JSON object — not saved' : undefined}>
      <textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (e.target.value.trim() === '') {
            onChange(undefined);
            return;
          }
          const parsed = parseJsonObjectText(e.target.value);
          if (parsed !== null) onChange(parsed);
        }}
        rows={3}
        placeholder={placeholder}
        className={cn(rt, 'font-mono text-[11px] placeholder:italic placeholder:text-muted-foreground/40', rejected && 'ring-1 ring-red-400')}
      />
    </FieldRow>
  );
}

// ---------------------------------------------------------------------------
// StepEditor
// ---------------------------------------------------------------------------

function StepTimeoutField({ value, onChange }: {
  value: number | undefined;
  onChange: (timeoutMinutes: number | undefined) => void;
}) {
  return (
    <FieldRow label="Step's maximum duration (minutes)" tooltip={TIP.stepTimeoutMinutes}>
      <input
        type="number"
        min="1"
        step="1"
        aria-label="Step's maximum duration in minutes"
        value={value ?? ''}
        placeholder={String(DEFAULT_STEP_TIMEOUT_MINUTES)}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
        className={ri}
      />
    </FieldRow>
  );
}

export function StepEditor({
  step,
  allSteps,
  workflowName,
  onChange: applyChange,
  onClose,
  errors,
  imageWarning,
  dockerImages,
  catalogEntries = NO_CATALOG_ENTRIES,
  workflowArtifacts,
  workflowVisibility = 'private',
  workflowPreamble,
  savedValidation,
  transitions = [],
  onTransitionsChange = () => {},
}: {
  step: WorkflowStep;
  allSteps: WorkflowStep[];
  workflowName?: string;
  onChange: (patch: Partial<WorkflowStep>) => void;
  onClose?: () => void;
  errors?: Record<string, string>;
  imageWarning?: string;
  dockerImages?: DockerImageInfo[];
  catalogEntries?: ImageCatalogEntryView[];
  transitions?: WorkflowDefinition['transitions'];
  onTransitionsChange?: (next: WorkflowDefinition['transitions']) => void;
  /** The files this workflow carries: a Dockerfile among them is an image
   *  source the step can build from. */
  workflowArtifacts?: WorkflowDefinition['artifacts'];
  /** Decides which catalog Skills the step may add (ADR-0027). */
  workflowVisibility?: WorkflowDefinition['visibility'];
  /** A preamble changes every agent the workflow runs (ADR-0029 D8). */
  workflowPreamble?: string;
  /** The step's validation as saved; a verdict of its own outranks its agent's. */
  savedValidation?: StepValidation['status'];
}) {
  const isNewStep = step.id.startsWith('new-step-');
  const { plugins } = usePlugins();
  const pinnedDefaultModel = usePinnedDefaultModel();
  const selectedPluginMetadata = plugins.find((p) => p.name === step.plugin)?.metadata;
  const selectedPluginDefaultModel = selectedPluginMetadata?.foundationModel;
  // The plugin declares its own io contract; prefer it over the authored
  // fallback so the panel never drifts from what the runtime actually does.
  const selectedPluginIo = selectedPluginMetadata?.inputDescription && selectedPluginMetadata?.outputDescription
    ? { inputDescription: selectedPluginMetadata.inputDescription, outputDescription: selectedPluginMetadata.outputDescription }
    : undefined;
  const { user } = useAuth();
  const { handle } = useParams<{ handle: string }>();
  const [secretKeys, setSecretKeys] = useState<string[]>([]);

  const uid = user?.id;
  useEffect(() => {
    if (handle && workflowName && uid) {
      mediforce.secrets
        .list({ namespace: handle, workflow: workflowName })
        .then(({ keys }) => setSecretKeys(keys))
        .catch((err) => console.error('Failed to load secret keys:', err));
    }
  }, [handle, workflowName, uid]);

  const otherSteps = allSteps.filter((s) => s.id !== step.id);
  const isAgent  = step.executor === 'agent'  && step.type !== 'terminal';
  const isHuman  = step.executor === 'human'  && step.type !== 'terminal';
  const isScript = step.executor === 'script' && step.type !== 'terminal';
  const isCowork = step.executor === 'cowork';
  const isAction = step.executor === 'action';
  const isReview = step.type === 'review';
  const hasHumanReviewer = isHuman || (isAgent && (step.autonomyLevel ?? 'L2') === 'L3');
  const isDecision = step.type === 'decision';
  const hasVerdicts = isReview || isDecision;
  const isTerminal = step.type === 'terminal';
  const outgoingTransitions = transitions.filter((t) => t.from === step.id);
  const hasRoutingConfigured = Object.keys(step.verdicts ?? {}).length > 0 || outgoingTransitions.some((t) => t.when);
  const [agentDefinitions, setAgentDefinitions] = useState<AgentDefinition[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!isAgent) {
      setAgentDefinitions([]);
      setAgentsLoading(false);
      setAgentsError(null);
      return () => { cancelled = true; };
    }

    setAgentsLoading(true);
    setAgentsError(null);
    mediforce.agents.list({ namespace: handle })
      .then(({ agents }) => {
        if (!cancelled) setAgentDefinitions(agents);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setAgentsError(error instanceof Error ? error.message : 'Failed to load agents');
        }
      })
      .finally(() => {
        if (!cancelled) setAgentsLoading(false);
      });

    return () => { cancelled = true; };
  }, [handle, isAgent]);

  // What a blank `agent.model` actually resolves to at run time: the named
  // agent's foundationModel, or the plugin's own default when the step names
  // no agent. Mirrors the fallback in `execute-agent-step`.
  const selectedAgentDefaultModel =
    agentDefinitions.find((agent) => agent.id === step.agentId)?.foundationModel
    ?? selectedPluginDefaultModel;

  // The workspace vocabulary and roster behind the two human-step role
  // controls. `workflowName` scopes the "who can actually act here" question:
  // a grant narrowed to another workflow does not let its holder claim this
  // task, so it must not silence the unheld-role warning (#1252).
  const { roles: workspaceRoles, heldRoles } = useWorkspaceRoles(handle, {
    enabled: hasHumanReviewer,
    workflowName,
  });
  const { members } = useNamespaceMembers(handle);

  const httpAction    = step.action?.kind === 'http'    ? step.action : undefined;
  const reshapeAction = step.action?.kind === 'reshape' ? step.action : undefined;
  const emailAction   = step.action?.kind === 'email'   ? step.action : undefined;
  const spawnAction   = step.action?.kind === 'spawn'   ? step.action : undefined;
  const waitAction    = step.action?.kind === 'wait'    ? step.action : undefined;
  const collectAction = step.action?.kind === 'collect' ? step.action : undefined;
  const runWorkflowAction = step.action?.kind === 'run-workflow' ? step.action : undefined;

  // `targets` is one target or a list; the editor always works on a list and
  // writes back a bare object when there is exactly one, so a hand-authored
  // single-target definition round-trips unchanged.
  const spawnTargets = spawnAction === undefined
    ? []
    : Array.isArray(spawnAction.config.targets) ? spawnAction.config.targets : [spawnAction.config.targets];

  const writeSpawnTargets = (targets: SpawnTargetConfig[]): void => {
    if (spawnAction === undefined) return;
    onChange({
      action: {
        ...spawnAction,
        config: { ...spawnAction.config, targets: targets.length === 1 ? targets[0] : targets },
      },
    });
  };

  const selMin = typeof step.selection === 'number' ? step.selection : step.selection?.min;
  const selMax = typeof step.selection === 'number' ? step.selection : step.selection?.max;

  // The picker's options come from the namespace's image catalog: name and
  // intent instead of a bare `repo:tag`, grouped by what each was built on, and
  // filtered to what the step can actually run — an agent step is not offered
  // an image a probe proved carries no agent CLI, which is the `exec: "claude":
  // executable file not found` class of run-time failure. It curates, it does
  // not gate: the field beside the select still saves any string, and a step
  // pinning an image no entry covers keeps it (ADR-0022 decision 5).
  //
  // A catalog with nothing to say — empty, or a daemon nobody could reach —
  // degrades to the daemon listing the picker offered before it existed, so an
  // author never faces an empty picker (AGENTS.md §13).
  // What decides a step's image source: the files the workflow carries, and
  // the handle whose catalog names a build must not land on.
  const imageSourceDefinition = useMemo(
    () => ({ artifacts: workflowArtifacts, namespace: handle }),
    [workflowArtifacts, handle],
  );

  // The MCP servers the step's agent binds run inside the step's image. An
  // image is only probeable once it exists, so a step that builds its own has
  // nothing to ask about; one that names none runs in the default image.
  const toolCatalog = useToolCatalogEntries(isAgent ? handle : undefined);
  const selectedAgent = agentDefinitions.find((agent) => agent.id === step.agentId);
  const selectedAgentVersions = useAgentVersions(selectedAgent?.id);
  const selectedAgentImages = [selectedAgent ?? {}, ...(selectedAgentVersions.data?.versions ?? []).map((version) => version.config)]
    .map(agentImageOf);
  // A step that runs a validated agent as it is shares its validation; one
  // that changes it needs a validation of its own (ADR-0029 D8).
  const agentQualification = useStepQualification(
    selectedAgent !== undefined && isEvaluableAgent(selectedAgent)
      ? { kind: 'agent', namespace: selectedAgent.namespace, agentId: selectedAgent.id }
      : null,
  );
  const agentValidationStatuses = useAgentValidationStatuses(
    agentDefinitions.filter(isEvaluableAgent).map((agent) => ({ namespace: agent.namespace, agentId: agent.id })),
  );
  const agentValidated = agentQualification.data?.validation.status === 'passed';
  const agentChangeContext = { ...imageSourceDefinition, preamble: workflowPreamble };
  const agentChanges = selectedAgent === undefined ? [] : agentStepChanges(step, selectedAgent, agentChangeContext);
  const hasOwnVerdict = savedValidation === 'failed' || savedValidation === 'awaiting_approval';
  // A patch to apply once confirmed, or an edit to a field that commits on
  // blur — asked about when the edit starts, while the step is still selected.
  const [pendingAgentChange, setPendingAgentChange] = useState<
    { patch: Partial<WorkflowStep> } | { edit: AgentStepChange } | null
  >(null);
  const [outputSchemaRevision, setOutputSchemaRevision] = useState(0);
  const acknowledgedStepIds = useRef(new Set<string>());
  const asksBeforeModifyingAgent = agentValidated
    && selectedAgent !== undefined
    && agentChanges.length === 0
    && acknowledgedStepIds.current.has(step.id) === false;

  function onChange(patch: Partial<WorkflowStep>) {
    const next = { ...step, ...patch };
    const modifiesValidatedAgent = asksBeforeModifyingAgent
      && selectedAgent !== undefined
      && next.agentId === step.agentId
      && agentStepChanges(next, selectedAgent, agentChangeContext).length > 0;
    if (modifiesValidatedAgent) {
      setPendingAgentChange({ patch });
      return;
    }
    applyChange(patch);
  }
  const mcpServerCommands = useMemo(
    () => stdioServerCommands(selectedAgent?.mcpServers ?? {}, toolCatalog, step.mcpRestrictions),
    [selectedAgent, toolCatalog, step.mcpRestrictions],
  );
  const stepBuildsItsImage = stepHasBuildSource(step.agent, imageSourceDefinition);
  // Leaving agent.image blank is not "unset" — registration fills in the image
  // of the step's agent, or the golden one. Only a step whose source is a ready
  // image reaches the picker at all; one that builds its own never shows it, so
  // the blank option has one meaning.
  const defaultStepImage = selectedAgent === undefined ? DEFAULT_AGENT_IMAGE : agentImageOf(selectedAgent);
  const agentBlankOptionLabel = `Default — ${defaultStepImage}`;
  const stepImage = step.agent?.image !== undefined && step.agent.image !== '' ? step.agent.image : defaultStepImage;

  const agentImagePicker = useMemo(
    () => buildImagePicker({ catalogEntries, dockerImages: dockerImages ?? [], executor: 'agent' }),
    [catalogEntries, dockerImages],
  );
  const scriptRuntime = requiredRuntimeFor(step);
  const scriptImagePicker = useMemo(
    () => buildImagePicker({
      catalogEntries,
      dockerImages: dockerImages ?? [],
      executor: 'script',
      requiredRuntime: scriptRuntime,
    }),
    [catalogEntries, dockerImages, scriptRuntime],
  );

  function updateAgent(patch: Partial<NonNullable<WorkflowStep['agent']>>) {
    onChange({ agent: { ...step.agent, ...patch } });
  }
  function updateScript(patch: Partial<NonNullable<WorkflowStep['script']>>) {
    onChange({ script: { ...step.script, ...patch } });
  }
  function handlePluginChange(nextPlugin: string | undefined) {
    const expectedKey = scriptConfigKeyForPlugin(nextPlugin);
    onChange({
      plugin: nextPlugin,
      script: expectedKey === 'script' ? step.script : undefined,
      databricks: expectedKey === 'databricks' ? step.databricks : undefined,
      databricksSql: expectedKey === 'databricksSql' ? step.databricksSql : undefined,
    });
  }
  function updateDatabricks(patch: Partial<NonNullable<WorkflowStep['databricks']>>) {
    onChange({ databricks: { ...(step.databricks ?? { jobId: 0 }), ...patch } });
  }
  function updateDatabricksParams(
    field: 'notebookParams' | 'jobParameters',
    mutate: (params: Record<string, string>) => Record<string, string>,
  ) {
    const next = mutate({ ...(step.databricks?.[field] ?? {}) });
    updateDatabricks({ [field]: Object.keys(next).length > 0 ? next : undefined });
  }
  function updateDatabricksSql(patch: Partial<NonNullable<WorkflowStep['databricksSql']>>) {
    onChange({ databricksSql: { ...(step.databricksSql ?? { warehouseId: '', statement: '' }), ...patch } });
  }
  function updateDatabricksSqlParameters(
    mutate: (params: Record<string, string>) => Record<string, string>,
  ) {
    const next = mutate({ ...(step.databricksSql?.parameters ?? {}) });
    updateDatabricksSql({ parameters: Object.keys(next).length > 0 ? next : undefined });
  }
  function updateReview(patch: Partial<NonNullable<WorkflowStep['review']>>) {
    onChange({ review: { ...step.review, ...patch } });
  }

  function updateSelection(newMin: number | undefined, newMax: number | undefined) {
    if (newMin === undefined && newMax === undefined) { onChange({ selection: undefined }); return; }
    onChange({ selection: { min: newMin ?? 1, max: newMax ?? 1 } });
  }

  const execBaseStyle = EXECUTOR_ICON[step.executor] ?? EXECUTOR_ICON.human;
  // Only a script step's plugin selects a Databricks config key — an agent
  // step's own "Plugin" field (the agent runtime) can hold the same string
  // without meaning the same thing.
  const execStyle = (step.executor === 'script' && step.plugin !== undefined ? PLUGIN_ICON[step.plugin] : undefined) ?? execBaseStyle;
  const ExecIcon = execStyle.icon;
  const typeStyle = STEP_TYPE_ICON[step.type] ?? STEP_TYPE_ICON.creation;
  const TypeIcon = typeStyle.icon;

  // ── Accordion sections ─────────────────────────────────────────────────
  const hasPrimarySection = isAgent || isScript || isHuman || isAction || isReview || isCowork;
  const paramsInPrimary = isHuman;
  const paramsInAdvanced = !isTerminal && !isHuman;

  const primaryTitle = isAgent
    ? 'Prompt & model'
    : isScript
      ? execStyle.label
      : isCowork
        ? 'Collaboration'
        : isAction
          ? 'Action'
          : isHuman
            ? 'Task setup'
            : isReview
              ? 'Review'
              : 'Configuration';

  // Default open: Basics + Primary; Routing + Advanced closed. Any combination
  // of cards may be open — toggling one never closes the others.
  // Card ids + their default open state live here once; the reset effect and
  // toggle derive from this rather than re-typing the literal.
  const defaultOpenCards: Record<string, boolean> = { basics: true, primary: false, routing: hasRoutingConfigured, advanced: false };
  const [openCards, setOpenCards] = useState<Record<string, boolean>>(defaultOpenCards);
  useEffect(() => {
    setOpenCards(defaultOpenCards);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.id, step.executor, isDecision, hasPrimarySection]);
  // Single-open: opening a card closes the others; clicking the open one collapses it.
  const toggleCard = (id: string) => setOpenCards((prev) => {
    const allClosed = Object.fromEntries(Object.keys(defaultOpenCards).map((k) => [k, false]));
    return { ...allClosed, [id]: !prev[id] };
  });

  const stepParamNameCounts = paramNameCounts(step.params ?? []);

  function commitNewStepId() {
    if (!isNewStep) return;
    const generatedId = uniqueSlug(step.name, allSteps.map((workflowStep) => workflowStep.id), step.id);
    if (generatedId !== step.id) onChange({ id: generatedId });
  }

  const parametersSection = !isTerminal ? (
        <Section title="Parameters">
          {/* Only the human-executor branch of the engine copies step.params
              onto a task, so they are inert anywhere else — say so rather than
              letting an author configure a form nobody is ever shown. */}
          {paramsInAdvanced && (
            <p className="text-[11px] leading-relaxed text-muted-foreground mb-3">
              Parameters are only collected on human steps — the assignee fills them in on the task form.
              This step takes its input from previous step outputs instead.
            </p>
          )}
          <div className="space-y-3">
            {(step.params ?? []).map((param, idx) => {
              const paramNameError = param.name.trim() === ''
                ? 'This field cannot be empty.'
                : (stepParamNameCounts.get(param.name.trim()) ?? 0) > 1
                  ? 'Duplicate parameter name.'
                  : undefined;
              return (
              <div key={idx} className="rounded-xl border border-border/60 p-3 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">Parameter {idx + 1}</span>
                  <button
                    onClick={() => {
                      const next = (step.params ?? []).filter((_, i) => i !== idx);
                      onChange({ params: next.length > 0 ? next : undefined });
                    }}
                    className="rounded-md p-0.5 text-muted-foreground/50 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                    aria-label="Remove parameter"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <FieldGroup>
                <FieldRow label="name" tooltip={TIP.paramName} error={paramNameError}>
                  <input
                    value={param.name}
                    onChange={(e) => {
                      const next = [...(step.params ?? [])];
                      next[idx] = { ...next[idx], name: e.target.value };
                      onChange({ params: next });
                    }}
                    className={cn(riMono, paramNameError && 'border border-red-400 focus:border-red-500')}
                  />
                </FieldRow>
                <FieldRow label="type" tooltip={TIP.paramType}>
                  <select
                    value={param.type ?? 'string'}
                    onChange={(e) => {
                      const next = [...(step.params ?? [])];
                      next[idx] = { ...next[idx], type: e.target.value as 'string' | 'number' | 'boolean' | 'date' };
                      onChange({ params: next });
                    }}
                    className={rs}
                  >
                    {(['string', 'number', 'boolean', 'date'] as const).map((t) => (
                      <option key={t} value={t}>{humanizeToken(t)}</option>
                    ))}
                  </select>
                </FieldRow>
                <FieldRow label="required" tooltip={TIP.paramRequired}>
                  <input
                    type="checkbox"
                    checked={param.required ?? false}
                    onChange={(e) => {
                      const next = [...(step.params ?? [])];
                      next[idx] = { ...next[idx], required: e.target.checked };
                      onChange({ params: next });
                    }}
                    className="w-3.5 h-3.5 accent-primary cursor-pointer"
                  />
                </FieldRow>
                <FieldRow label="requiredForVerdicts" tooltip={TIP.paramRequiredForVerdicts}>
                  <div className="flex flex-wrap items-center gap-2">
                    {Object.keys(step.verdicts ?? {}).map((verdictKey) => (
                      <label key={verdictKey} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={param.requiredForVerdicts?.includes(verdictKey) === true}
                          onChange={(e) => {
                            const current = param.requiredForVerdicts ?? [];
                            const keys = e.target.checked
                              ? [...current, verdictKey]
                              : current.filter((k) => k !== verdictKey);
                            const next = [...(step.params ?? [])];
                            next[idx] = { ...next[idx], requiredForVerdicts: keys.length > 0 ? keys : undefined };
                            onChange({ params: next });
                          }}
                          className="h-3.5 w-3.5 accent-primary cursor-pointer"
                        />
                        {verdictKey}
                      </label>
                    ))}
                    {Object.keys(step.verdicts ?? {}).length === 0 && (
                      <span className="text-[11px] italic text-muted-foreground/40">Define verdicts to make this conditional</span>
                    )}
                  </div>
                </FieldRow>
                <FieldRow label="description" tooltip={TIP.paramDescription}>
                  <input
                    value={param.description ?? ''}
                    onChange={(e) => {
                      const next = [...(step.params ?? [])];
                      next[idx] = { ...next[idx], description: e.target.value || undefined };
                      onChange({ params: next });
                    }}
                    className={ri}
                  />
                </FieldRow>
                <FieldRow label="default" tooltip={TIP.paramDefault}>
                  <input
                    value={param.default !== undefined ? String(param.default) : ''}
                    onChange={(e) => {
                      const next = [...(step.params ?? [])];
                      next[idx] = { ...next[idx], default: e.target.value || undefined };
                      onChange({ params: next });
                    }}
                    className={riMono}
                  />
                </FieldRow>
                <FieldRow label="options" tooltip={TIP.paramOptions}>
                  <input
                    value={param.options?.join(', ') ?? ''}
                    onChange={(e) => {
                      const opts = e.target.value.split(',').map((o) => o.trim()).filter(Boolean);
                      const next = [...(step.params ?? [])];
                      next[idx] = { ...next[idx], options: opts.length > 0 ? opts : undefined };
                      onChange({ params: next });
                    }}
                    className={ri}
                  />
                </FieldRow>
                </FieldGroup>
              </div>
              );
            })}
          </div>
          <button
            onClick={() => onChange({ params: [...(step.params ?? []), { name: '', type: 'string', required: false }] })}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >+ Add parameter</button>
        </Section>
  ) : null;

  return (
    <div className="flex flex-col gap-3 h-full min-h-0" data-testid="step-editor" data-tour="step-editor">
      {selectedAgent !== undefined && (
        <ModifyValidatedAgentDialog
          agentName={selectedAgent.name}
          changes={
            pendingAgentChange === null ? []
              : 'edit' in pendingAgentChange ? [pendingAgentChange.edit]
                : agentStepChanges({ ...step, ...pendingAgentChange.patch }, selectedAgent, agentChangeContext)
          }
          open={pendingAgentChange !== null}
          onCancel={() => {
            if (pendingAgentChange !== null && 'edit' in pendingAgentChange) setOutputSchemaRevision((revision) => revision + 1);
            setPendingAgentChange(null);
          }}
          onConfirm={() => {
            if (pendingAgentChange === null) return;
            acknowledgedStepIds.current.add(step.id);
            if ('patch' in pendingAgentChange) applyChange(pendingAgentChange.patch);
            setPendingAgentChange(null);
          }}
        />
      )}

      {/* ── Basics (carries the step identity header) ────────────── */}
      <CollapsibleCard
        open={openCards.basics}
        onToggle={() => toggleCard('basics')}
        headerAction={onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close step editor"
            className="shrink-0 rounded-md p-1 text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        ) : undefined}
        titleNode={
          <div className="flex flex-1 min-w-0 items-center gap-3">
            <div className={cn('flex items-center justify-center h-9 w-9 rounded-lg shrink-0', execStyle.bg)}>
              <ExecIcon className={cn('h-5 w-5', execStyle.color)} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight truncate">{step.name || 'Unnamed step'}</p>
              {/* executor · type, matching the canvas node badge order (type last). */}
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[10px] text-muted-foreground">{execStyle.label}</span>
                <span className="text-[10px] text-muted-foreground/30">·</span>
                <TypeIcon className={cn('h-3 w-3 shrink-0', typeStyle.color)} strokeWidth={1.5} />
                <span className="text-[10px] text-muted-foreground">{typeStyle.label}</span>
              </div>
            </div>
          </div>
        }
      >
      {step.type === 'review' && (
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <strong>Review steps are deprecated.</strong> They will be replaced by Decision steps — where a human explicitly decides if the previous work is satisfactory. You can continue using this step; it will keep working. To migrate, replace it with a Decision step.
        </div>
      )}
      <FieldGroup>
        <FieldRow label="name" tooltip={TIP.name} error={errors?.name ? friendlyFieldError(errors.name) : undefined}>
          <input
            value={step.name}
            onChange={(e) => {
              onChange({ name: e.target.value });
            }}
            onBlur={commitNewStepId}
            className={cn(ri, errors?.name && 'border-red-400 focus:border-red-500')}
          />
        </FieldRow>

        <FieldRow label="description" tooltip={TIP.description} alignStart>
          <textarea
            value={step.description ?? ''}
            onChange={(e) => onChange({ description: e.target.value || undefined })}
            placeholder="Add description…"
            rows={2}
            className={cn(rt, 'text-muted-foreground placeholder:italic placeholder:text-muted-foreground/40')}
          />
        </FieldRow>

        {/* Executor before type, matching the block picker / canvas node order
            (executor -> type) so the two panels read consistently. */}
        <FieldRow label="executor" tooltip={TIP.executor}>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground py-0.5" title="executor is set at creation. To change, remove this step and add a new one.">
            <Lock className="h-3 w-3 text-muted-foreground/30 shrink-0" />
            <span>{execStyle.label}</span>
          </span>
        </FieldRow>

        <FieldRow label="type" tooltip={TIP.type}>
          <span
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground py-0.5"
            title="Step type is set at creation. To change, remove this step and add a new one."
          >
            <Lock className="h-3 w-3 text-muted-foreground/30 shrink-0" />
            {STEP_TYPE_LABELS[step.type] ?? step.type}
          </span>
        </FieldRow>
      </FieldGroup>
      </CollapsibleCard>

      {/* ── Primary config ───────────────────────────────────────── */}
      {hasPrimarySection && (
        <CollapsibleCard title={primaryTitle} open={openCards.primary} onToggle={() => toggleCard('primary')}>

      <StepDataFlow step={step} pluginIo={selectedPluginIo} hasVerdicts={hasVerdicts} />

      {/* ── Agent config ─────────────────────────────────────────── */}
      {isAgent && (<>
        <FieldGroup>
          <FieldRow label="autonomy level" tooltip="Assist: agent draft, human approves. Human review: explicit approval required. Autonomous agent: executes without review.">
            <PillToggle
              value={step.autonomyLevel ?? 'L3'}
              onChange={(v) => onChange(
                v === 'L3'
                  ? { autonomyLevel: 'L3' }
                  : { autonomyLevel: v as WorkflowStep['autonomyLevel'], allowedRoles: undefined, assignedTo: undefined },
              )}
              options={[
                { value: 'L2', label: 'Assist', icon: Bot, activeClassName: 'border-lime-400 bg-lime-50 text-lime-700 dark:bg-lime-950/30 dark:text-lime-400' },
                { value: 'L3', label: 'Human Review', icon: Users, activeClassName: 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400' },
                { value: 'L4', label: 'Autonomous', icon: Bot, activeClassName: 'border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-400' },
              ]}
            />
          </FieldRow>

          <FieldRow label="Agent" tooltip={TIP.agentId}>
            <select
              aria-label="Agent"
              value={step.agentId ?? ''}
              onChange={(e) => onChange(selectAgentPatch(
                step,
                e.target.value === '' ? undefined : agentDefinitions.find((agent) => agent.id === e.target.value) ?? { id: e.target.value, kind: 'plugin' },
                pinnedDefaultModel,
                { currentAgentImages: selectedAgentImages, artifacts: workflowArtifacts },
              ))}
              className={rs}
            >
              <option value="">{agentsLoading ? 'Loading agents…' : 'No agent selected'}</option>
              {step.agentId && !agentDefinitions.some((agent) => agent.id === step.agentId) && (
                <option value={step.agentId}>{step.agentId} (current)</option>
              )}
              {[...agentDefinitions]
                .sort((firstAgent, secondAgent) => firstAgent.name.localeCompare(secondAgent.name))
                .map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} ({agent.id}){agentValidationStatuses.get(agent.id) === 'passed' ? ' — ✅ Verified' : ''}
                  </option>
                ))}
            </select>
            {selectedAgent !== undefined && (
              <p className="text-xs text-muted-foreground">
                {agentSummary(selectedAgent)}
                {' · '}
                <Link href={routes.agentDefinition(handle, selectedAgent.id)} className="underline">Edit agent</Link>
              </p>
            )}
            {selectedAgent !== undefined && agentValidated && (hasOwnVerdict ? (
              <p data-testid="agent-validation" data-status="own-verdict" className="text-xs text-muted-foreground">
                {selectedAgent.name} is validated, but this step has an Eval Run verdict of its own, which stands
                {workflowName === undefined ? '.' : (
                  <> — see the <Link href={routes.workflowEvaluation(handle, workflowName, { step: step.id })} className="underline">Evaluation tab</Link>.</>
                )}
              </p>
            ) : agentChanges.length === 0 ? (
              <p
                data-testid="agent-validation"
                data-status="validated"
                title={agentQualification.data?.validation.reason}
                className="inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400"
              >
                <CircleCheck className="h-3.5 w-3.5" aria-hidden />
                Validated agent v{agentQualification.data?.agentVersion} — this step runs it as it was validated
              </p>
            ) : (
              <p data-testid="agent-validation" data-status="modified" className="text-xs text-amber-700 dark:text-amber-300">
                {selectedAgent.name} is validated, but this step changes its {agentChanges.join(', ')}, so the step needs a
                validation of its own
                {workflowName === undefined ? '.' : (
                  <> on the <Link href={routes.workflowEvaluation(handle, workflowName, { step: step.id })} className="underline">Evaluation tab</Link>.</>
                )}
              </p>
            ))}
            {agentsError && <p className="text-xs text-amber-600">Agent list unavailable: {agentsError}</p>}
          </FieldRow>

          <FieldRow label="Plugin" tooltip={TIP.plugin}>
            <select
              aria-label="Plugin"
              value={step.plugin ?? ''}
              onChange={(e) => onChange({ plugin: e.target.value || undefined })}
              className={rs}
            >
              <option value="">None</option>
              {plugins.map((p) => <option key={p.name} value={p.name}>{humanizeToken(p.name)}</option>)}
              {step.plugin && !plugins.some((p) => p.name === step.plugin) && (
                <option value={step.plugin}>{humanizeToken(step.plugin)}</option>
              )}
            </select>
          </FieldRow>

          <FieldRow label="Model" tooltip={TIP.agentModel}>
            <ModelPicker
              value={step.agent?.model}
              onChange={(model) => updateAgent({ model })}
              defaultModel={selectedAgentDefaultModel}
              defaultLabel={selectedAgent === undefined ? 'Plugin default' : `Use ${selectedAgent.name}'s model`}
              providers={selectedPluginMetadata?.modelProviders}
              ariaLabel="Model"
              className={rs}
            />
          </FieldRow>
        </FieldGroup>

        <FieldGroup>
          <Section title="This step adds">
            <p className="px-0.5 text-xs text-muted-foreground">
              Added to {selectedAgent === undefined ? 'the agent' : selectedAgent.name}&apos;s prompt and skills
              for this step only. A step skill with the same id as one of the agent&apos;s replaces it.
            </p>
          </Section>

          <FieldRow label="Step prompt" tooltip={TIP.agentPrompt} alignStart>
            <textarea
              aria-label="Step prompt"
              value={step.agent?.prompt ?? ''}
              onChange={(e) => updateAgent({ prompt: e.target.value || undefined })}
              rows={3}
              placeholder="Instructions for the agent…"
              className={cn(rt, 'placeholder:italic placeholder:text-muted-foreground/40')}
            />
          </FieldRow>

          <FieldRow label="Skills" tooltip={TIP.agentSkills} alignStart>
            <StepSkillsField
              namespace={handle}
              workflowVisibility={workflowVisibility}
              runtimeId={step.plugin}
              agentName={selectedAgent?.name}
              agentSkills={selectedAgent?.skills ?? []}
              selected={step.agent?.skills ?? []}
              onChange={(skills) => updateAgent({ skills: skills.length > 0 ? skills : undefined })}
            />
            {step.agent?.retiredFileSkill !== undefined && (
              <div
                role="alert"
                className="mt-2 flex items-start justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-300"
              >
                <span className="min-w-0">
                  This step used the workflow-file skill{' '}
                  <span className="font-mono">{step.agent.retiredFileSkill}</span>, which no longer runs. Import it on
                  the Skills page, pick it above, then remove this to save.
                </span>
                <button
                  type="button"
                  aria-label="Remove retired file skill"
                  onClick={() => updateAgent({ retiredFileSkill: undefined })}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </FieldRow>

          <StepTimeoutField value={step.agent?.timeoutMinutes} onChange={(timeoutMinutes) => updateAgent({ timeoutMinutes })} />

          <FieldRow label="agent.outputSchema" tooltip={TIP.agentOutputSchema} alignStart>
            <OutputSchemaEditor
              key={`agent-output-schema-${step.id}-${outputSchemaRevision}`}
              value={step.agent?.outputSchema}
              onChange={(outputSchema) => updateAgent({ outputSchema })}
              onEdit={asksBeforeModifyingAgent ? () => setPendingAgentChange({ edit: 'output schema' }) : undefined}
              schema={AgentOutputSchemaSchema}
              inherited={selectedAgent?.outputSchema === undefined ? undefined : { schema: selectedAgent.outputSchema, from: selectedAgent.name }}
            />
          </FieldRow>

        </FieldGroup>

        <FieldGroup>
          <ImageSourceFields
            // Remounted per step, so a source chosen for one step is not still
            // selected when another is opened in the same panel.
            key={`agent-${step.id}`}
            prefix="agent"
            config={step.agent}
            definition={imageSourceDefinition}
            picker={agentImagePicker}
            onChange={updateAgent}
            blankOptionLabel={agentBlankOptionLabel}
            imageWarning={imageWarning}
            pickerValue={pickerImageValue}
          />
          {stepBuildsItsImage === false && mcpServerCommands.length > 0 && (
            <McpCommandWarnings
              namespace={handle}
              image={stepImage}
              servers={mcpServerCommands}
              remedy="Pick an image that provides it, or build one."
            />
          )}
        </FieldGroup>
      </>)}

      {/* ── Script config ────────────────────────────────────────── */}
      {isScript && (<>
        <FieldGroup>
          {step.plugin === 'databricks-job' || step.plugin === 'databricks-sql' ? (
            <FieldRow label="databricks" tooltip={TIP.databricksKind}>
              <select
                aria-label="databricks"
                value={step.plugin}
                onChange={(e) => handlePluginChange(e.target.value)}
                className={rs}
              >
                {plugins
                  .filter((p) => p.name === 'databricks-job' || p.name === 'databricks-sql')
                  .map((p) => (
                    <option key={p.name} value={p.name}>{p.name === 'databricks-job' ? 'Job' : 'SQL'}</option>
                  ))}
              </select>
            </FieldRow>
          ) : (
            <FieldRow label="plugin" tooltip={TIP.pluginScript}>
              <select
                aria-label="plugin"
                value={step.plugin ?? ''}
                onChange={(e) => handlePluginChange(e.target.value || undefined)}
                className={rs}
              >
                <option value="">None</option>
                {plugins
                  .filter((p) => scriptConfigKeyForPlugin(p.name) !== undefined && p.name !== 'databricks-job' && p.name !== 'databricks-sql')
                  .map((p) => (
                    <option key={p.name} value={p.name}>{humanizeToken(p.name)}</option>
                  ))}
                {step.plugin && scriptConfigKeyForPlugin(step.plugin) === undefined && (
                  <option value={step.plugin}>{humanizeToken(step.plugin)}</option>
                )}
              </select>
            </FieldRow>
          )}

          {step.plugin !== 'databricks-job' && step.plugin !== 'databricks-sql' && (<>
          <FieldRow label="script.runtime" tooltip={TIP.scriptRuntime}>
            <select
              value={step.script?.runtime ?? ''}
              onChange={(e) => updateScript({ runtime: (e.target.value || undefined) as 'javascript' | 'python' | 'r' | 'bash' | undefined })}
              className={rs}
            >
              {RUNTIME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </FieldRow>

          <FieldRow label="script.command" tooltip={TIP.scriptCommand}>
            <input
              value={step.script?.command ?? ''}
              onChange={(e) => updateScript({ command: e.target.value || undefined })}
              className={riMono}
            />
          </FieldRow>

          <FieldRow label="script.inlineScript" tooltip={TIP.scriptInlineScript} alignStart>
            <textarea
              value={step.script?.inlineScript ?? ''}
              onChange={(e) => updateScript({ inlineScript: e.target.value || undefined })}
              rows={3}
              placeholder="Script code…"
              className={cn(rt, 'font-mono text-[11px] placeholder:italic placeholder:text-muted-foreground/40')}
            />
          </FieldRow>

          <StepTimeoutField value={step.script?.timeoutMinutes} onChange={(timeoutMinutes) => updateScript({ timeoutMinutes })} />
          </>)}

          {step.plugin === 'databricks-job' && (<>
          <FieldRow label="databricks.jobId" tooltip={TIP.databricksJobId}>
            <input
              value={step.databricks?.jobId !== undefined ? String(step.databricks.jobId) : ''}
              onChange={(e) => updateDatabricks({ jobId: /^\d+$/.test(e.target.value) ? Number(e.target.value) : e.target.value })}
              className={riMono}
            />
          </FieldRow>
          <FieldRow label="databricks.pollIntervalMs" tooltip={TIP.databricksPollIntervalMs}>
            <input
              type="number"
              value={step.databricks?.pollIntervalMs ?? ''}
              onChange={(e) => updateDatabricks({ pollIntervalMs: e.target.value ? Number(e.target.value) : undefined })}
              className={riMono}
            />
          </FieldRow>
          <StepTimeoutField value={step.databricks?.timeoutMinutes} onChange={(timeoutMinutes) => updateDatabricks({ timeoutMinutes })} />
          {(['notebookParams', 'jobParameters'] as const).map((field) => (
            <div key={field} className="px-3 py-1.5 border-b border-border/30 last:border-0">
              <div
                className="text-xs font-medium text-muted-foreground mb-1"
                title={field === 'notebookParams' ? TIP.databricksNotebookParams : TIP.databricksJobParameters}
              >{humanizeToken(`databricks.${field}`)}</div>
              {Object.entries(step.databricks?.[field] ?? {}).map(([key, val], idx) => (
                <div key={idx} className="grid grid-cols-[1fr_1fr_auto] gap-x-2 py-1 items-center">
                  <input
                    value={key}
                    onChange={(e) => updateDatabricksParams(field, (params) => {
                      const renamed: Record<string, string> = {};
                      for (const [k, v] of Object.entries(params)) renamed[k === key ? e.target.value : k] = v;
                      return renamed;
                    })}
                    className={cn(riMono, 'text-muted-foreground/70')}
                  />
                  <input
                    value={val}
                    onChange={(e) => updateDatabricksParams(field, (params) => ({ ...params, [key]: e.target.value }))}
                    className={riMono}
                  />
                  <button
                    onClick={() => updateDatabricksParams(field, (params) => {
                      delete params[key];
                      return params;
                    })}
                    className="text-[10px] text-muted-foreground/30 hover:text-red-500 transition-colors"
                  >×</button>
                </div>
              ))}
              <button
                onClick={() => updateDatabricksParams(field, (params) => ({ ...params, param: '' }))}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >+ Add parameter</button>
            </div>
          ))}
          </>)}

          {step.plugin === 'databricks-sql' && (<>
          <FieldRow label="databricksSql.warehouseId" tooltip={TIP.databricksSqlWarehouseId}>
            <input
              value={step.databricksSql?.warehouseId ?? ''}
              onChange={(e) => updateDatabricksSql({ warehouseId: e.target.value })}
              className={riMono}
            />
          </FieldRow>
          <FieldRow label="databricksSql.statement" tooltip={TIP.databricksSqlStatement} alignStart>
            <textarea
              value={step.databricksSql?.statement ?? ''}
              onChange={(e) => updateDatabricksSql({ statement: e.target.value })}
              rows={3}
              placeholder="SELECT * FROM my_table WHERE id = :record_id"
              className={cn(rt, 'font-mono text-[11px] placeholder:italic placeholder:text-muted-foreground/40')}
            />
          </FieldRow>
          <FieldRow label="databricksSql.pollIntervalMs" tooltip={TIP.databricksSqlPollIntervalMs}>
            <input
              type="number"
              value={step.databricksSql?.pollIntervalMs ?? ''}
              onChange={(e) => updateDatabricksSql({ pollIntervalMs: e.target.value ? Number(e.target.value) : undefined })}
              className={riMono}
            />
          </FieldRow>
          <StepTimeoutField value={step.databricksSql?.timeoutMinutes} onChange={(timeoutMinutes) => updateDatabricksSql({ timeoutMinutes })} />
          <div className="px-3 py-1.5 border-b border-border/30 last:border-0">
            <div className="text-xs font-medium text-muted-foreground mb-1" title={TIP.databricksSqlParameters}>
              {humanizeToken('databricksSql.parameters')}
            </div>
            {Object.entries(step.databricksSql?.parameters ?? {}).map(([key, val], idx) => (
              <div key={idx} className="grid grid-cols-[1fr_1fr_auto] gap-x-2 py-1 items-center">
                <input
                  value={key}
                  onChange={(e) => updateDatabricksSqlParameters((params) => {
                    const renamed: Record<string, string> = {};
                    for (const [paramKey, paramValue] of Object.entries(params)) {
                      renamed[paramKey === key ? e.target.value : paramKey] = paramValue;
                    }
                    return renamed;
                  })}
                  className={cn(riMono, 'text-muted-foreground/70')}
                />
                <input
                  value={val}
                  onChange={(e) => updateDatabricksSqlParameters((params) => ({ ...params, [key]: e.target.value }))}
                  className={riMono}
                />
                <button
                  onClick={() => updateDatabricksSqlParameters((params) => {
                    delete params[key];
                    return params;
                  })}
                  className="text-[10px] text-muted-foreground/30 hover:text-red-500 transition-colors"
                >×</button>
              </div>
            ))}
            <button
              onClick={() => updateDatabricksSqlParameters((params) => ({ ...params, param: '' }))}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >+ Add parameter</button>
          </div>
          </>)}
        </FieldGroup>

        {step.plugin !== 'databricks-job' && step.plugin !== 'databricks-sql' && (
          <FieldGroup>
            <ImageSourceFields
              key={`script-${step.id}`}
              prefix="script"
              config={step.script}
              definition={imageSourceDefinition}
              picker={scriptImagePicker}
              onChange={updateScript}
              blankOptionLabel="Select image…"
              imageWarning={imageWarning}
              pickerValue={identityImageValue}
            />
          </FieldGroup>
        )}
      </>)}

      {/* ── Task UI (custom body) ────────────────────────────────── */}
      {isHuman && <StepUiConfigSection step={step} onChange={onChange} />}

      {/* ── Review config ────────────────────────────────────────── */}
      {isReview && (
        <FieldGroup>
          <FieldRow label="review.type" tooltip={TIP.reviewType}>
            <select
              value={step.review?.type ?? ''}
              onChange={(e) => updateReview({ type: (e.target.value || undefined) as 'human' | 'agent' | 'none' | undefined })}
              className={rs}
            >
              <option value="">Default</option>
              <option value="human">Human</option>
              <option value="agent">Agent</option>
              <option value="none">None</option>
            </select>
          </FieldRow>

          <FieldRow label="review.plugin" tooltip={TIP.reviewPlugin}>
            <input
              value={step.review?.plugin ?? ''}
              onChange={(e) => updateReview({ plugin: e.target.value || undefined })}
              className={riMono}
            />
          </FieldRow>

          <FieldRow label="review.maxIterations" tooltip={TIP.reviewMaxIterations}>
            <input
              type="number"
              value={step.review?.maxIterations ?? ''}
              onChange={(e) => updateReview({ maxIterations: e.target.value ? Number(e.target.value) : undefined })}
              className={ri}
            />
          </FieldRow>

          <FieldRow label="review.timeBoxDays" tooltip={TIP.reviewTimeBoxDays}>
            <input
              type="number"
              value={step.review?.timeBoxDays ?? ''}
              onChange={(e) => updateReview({ timeBoxDays: e.target.value ? Number(e.target.value) : undefined })}
              className={ri}
            />
          </FieldRow>

          <FieldRow label="selection.min" tooltip={TIP.selectionMin}>
            <input
              type="number"
              min="1"
              value={selMin ?? ''}
              onChange={(e) => updateSelection(e.target.value ? Number(e.target.value) : undefined, selMax)}
              className={ri}
            />
          </FieldRow>

          <FieldRow label="selection.max" tooltip={TIP.selectionMax}>
            <input
              type="number"
              min="1"
              value={selMax ?? ''}
              onChange={(e) => updateSelection(selMin, e.target.value ? Number(e.target.value) : undefined)}
              className={ri}
            />
          </FieldRow>
        </FieldGroup>
      )}

      {/* ── Action config ────────────────────────────────────────── */}
      {isAction && (
        <FieldGroup>
          <FieldRow label="action.kind" tooltip={TIP.actionKind}>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground py-0.5"
              title="Action kind is set at creation.">
              <Lock className="h-3 w-3 text-muted-foreground/30 shrink-0" />
              {step.action?.kind ? humanizeToken(step.action.kind) : '—'}
            </span>
          </FieldRow>

          {httpAction && (
            <>
              <FieldRow label="action.method" tooltip={TIP.actionMethod}>
                <select
                  value={httpAction.config.method}
                  onChange={(e) => onChange({ action: { ...httpAction, config: { ...httpAction.config, method: e.target.value as HttpMethod } } })}
                  className={rs}
                >
                  {(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </FieldRow>

              <FieldRow label="action.url" tooltip={TIP.actionUrl}>
                <input
                  value={httpAction.config.url}
                  onChange={(e) => onChange({ action: { ...httpAction, config: { ...httpAction.config, url: e.target.value } } })}
                  className={riMono}
                />
              </FieldRow>

              <FieldRow label="action.body" tooltip={TIP.actionBody} alignStart>
                <textarea
                  value={httpAction.config.body !== undefined ? JSON.stringify(httpAction.config.body, null, 2) : ''}
                  onChange={(e) => {
                    try {
                      const parsed = e.target.value ? JSON.parse(e.target.value) : undefined;
                      onChange({ action: { ...httpAction, config: { ...httpAction.config, body: parsed } } });
                    } catch { /* invalid JSON, don't update */ }
                  }}
                  rows={3}
                  placeholder='{"key": "${variables.value}"}'
                  className={cn(rt, 'font-mono text-[11px] placeholder:italic placeholder:text-muted-foreground/40')}
                />
              </FieldRow>

              {/* action.headers key-value rows */}
              <div className="border-t border-border/30">
                {Object.entries(httpAction.config.headers ?? {}).map(([hKey, hVal], idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_1fr] gap-x-2 px-3 py-1.5 border-b border-border/30 last:border-0 items-center">
                    <input
                      value={hKey}
                      onChange={(e) => {
                        const next: Record<string, string> = {};
                        for (const [k, v] of Object.entries(httpAction.config.headers ?? {})) {
                          next[k === hKey ? e.target.value : k] = v;
                        }
                        onChange({ action: { ...httpAction, config: { ...httpAction.config, headers: next } } });
                      }}
                      className={cn(riMono, 'text-muted-foreground/70')}
                    />
                    <div className="flex items-center gap-1.5">
                      <input
                        value={hVal}
                        onChange={(e) => onChange({ action: { ...httpAction, config: { ...httpAction.config, headers: { ...httpAction.config.headers, [hKey]: e.target.value } } } })}
                        className={ri}
                      />
                      <button
                        onClick={() => {
                          const next = { ...httpAction.config.headers };
                          delete next[hKey];
                          onChange({ action: { ...httpAction, config: { ...httpAction.config, headers: Object.keys(next).length > 0 ? next : undefined } } });
                        }}
                        className="text-[10px] text-muted-foreground/30 hover:text-red-500 transition-colors shrink-0"
                      >×</button>
                    </div>
                  </div>
                ))}
                <div className="px-3 py-1.5">
                  <button
                    onClick={() => {
                      const header = uniqueName('X-Header', Object.keys(httpAction.config.headers ?? {}));
                      onChange({ action: { ...httpAction, config: { ...httpAction.config, headers: { ...httpAction.config.headers, [header]: '' } } } });
                    }}
                    className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >+ Add header</button>
                </div>
              </div>
            </>
          )}

          {reshapeAction && (
            <FieldRow label="action.values" tooltip={TIP.actionValues} alignStart>
              <textarea
                value={JSON.stringify(reshapeAction.config.values, null, 2)}
                onChange={(e) => {
                  try {
                    const parsed = JSON.parse(e.target.value);
                    onChange({ action: { ...reshapeAction, config: { values: parsed } } });
                  } catch { /* invalid JSON */ }
                }}
                rows={4}
                placeholder='{"field": "${variables.value}"}'
                className={cn(rt, 'font-mono text-[11px] placeholder:italic placeholder:text-muted-foreground/40')}
              />
            </FieldRow>
          )}

          {emailAction && (
            <>
              <FieldRow label="action.to" tooltip={TIP.actionTo}>
                <input
                  value={Array.isArray(emailAction.config.to) ? emailAction.config.to.join(', ') : emailAction.config.to}
                  onChange={(e) => {
                    const parts = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                    onChange({ action: { ...emailAction, config: { ...emailAction.config, to: parts.length === 1 ? parts[0] : parts } } });
                  }}
                  className={ri}
                />
              </FieldRow>

              <FieldRow label="action.cc" tooltip={TIP.actionCc}>
                <input
                  value={emailAction.config.cc?.join(', ') ?? ''}
                  onChange={(e) => {
                    const parts = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                    onChange({ action: { ...emailAction, config: { ...emailAction.config, cc: parts.length > 0 ? parts : undefined } } });
                  }}
                  className={ri}
                />
              </FieldRow>

              <FieldRow label="action.bcc" tooltip={TIP.actionBcc}>
                <input
                  value={emailAction.config.bcc?.join(', ') ?? ''}
                  onChange={(e) => {
                    const parts = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                    onChange({ action: { ...emailAction, config: { ...emailAction.config, bcc: parts.length > 0 ? parts : undefined } } });
                  }}
                  className={ri}
                />
              </FieldRow>

              <FieldRow label="action.from" tooltip={TIP.actionFrom}>
                <input
                  value={emailAction.config.from ?? ''}
                  onChange={(e) => onChange({ action: { ...emailAction, config: { ...emailAction.config, from: e.target.value || undefined } } })}
                  className={ri}
                />
              </FieldRow>

              <FieldRow label="action.replyTo" tooltip={TIP.actionReplyTo}>
                <input
                  value={emailAction.config.replyTo ?? ''}
                  onChange={(e) => onChange({ action: { ...emailAction, config: { ...emailAction.config, replyTo: e.target.value || undefined } } })}
                  className={ri}
                />
              </FieldRow>

              <FieldRow label="action.subject" tooltip={TIP.actionSubject}>
                <input
                  value={emailAction.config.subject}
                  onChange={(e) => onChange({ action: { ...emailAction, config: { ...emailAction.config, subject: e.target.value } } })}
                  className={ri}
                />
              </FieldRow>

              <FieldRow label="action.body" tooltip={TIP.actionEmailBody} alignStart>
                <textarea
                  value={emailAction.config.body}
                  onChange={(e) => onChange({ action: { ...emailAction, config: { ...emailAction.config, body: e.target.value } } })}
                  rows={3}
                  placeholder="Plain text email body…"
                  className={cn(rt, 'placeholder:italic placeholder:text-muted-foreground/40')}
                />
              </FieldRow>

              <FieldRow label="action.html" tooltip={TIP.actionHtml} alignStart>
                <textarea
                  value={emailAction.config.html ?? ''}
                  onChange={(e) => onChange({ action: { ...emailAction, config: { ...emailAction.config, html: e.target.value || undefined } } })}
                  rows={3}
                  placeholder="<p>HTML email body…</p>"
                  className={cn(rt, 'font-mono text-[11px] placeholder:italic placeholder:text-muted-foreground/40')}
                />
              </FieldRow>
            </>
          )}

          {spawnAction && (
            <>
              <FieldRow label="action.targets" tooltip={TIP.actionTargets} alignStart>
                <div className="space-y-1.5">
                  {spawnTargets.map((target, idx) => (
                    <div key={idx} className="flex items-center gap-1.5">
                      <WorkflowTargetInputs
                        target={target}
                        onChange={(patch) => writeSpawnTargets(
                          spawnTargets.map((t, i) => (i === idx ? { ...t, ...patch } : t)),
                        )}
                      />
                      <button
                        type="button"
                        aria-label={`Remove target ${idx + 1}`}
                        onClick={() => writeSpawnTargets(spawnTargets.filter((_, i) => i !== idx))}
                        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => writeSpawnTargets([...spawnTargets, { definitionName: '' }])}
                    className="text-[11px] font-medium text-primary hover:underline"
                  >
                    + Add workflow
                  </button>
                </div>
              </FieldRow>

              <FieldRow label="action.forEach" tooltip={TIP.actionForEach}>
                <input
                  value={spawnAction.config.forEach ?? ''}
                  placeholder="${steps.split.items}"
                  onChange={(e) => onChange({ action: { ...spawnAction, config: { ...spawnAction.config, forEach: e.target.value || undefined } } })}
                  className={cn(riMono, 'placeholder:italic placeholder:text-muted-foreground/40')}
                />
              </FieldRow>

              <FieldRow label="action.continueOnSpawnError" tooltip={TIP.actionContinueOnSpawnError}>
                <input
                  type="checkbox"
                  checked={spawnAction.config.continueOnSpawnError !== false}
                  onChange={(e) => onChange({ action: { ...spawnAction, config: { ...spawnAction.config, continueOnSpawnError: e.target.checked } } })}
                  className="h-3.5 w-3.5 accent-primary"
                />
              </FieldRow>
            </>
          )}

          {waitAction && (
            <>
              <FieldRow label="action.duration" tooltip={TIP.actionWaitDuration}>
                <div className="flex items-center gap-1.5">
                  {(['hours', 'minutes', 'seconds'] as const).map((unit) => (
                    <label key={unit} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <input
                        type="number"
                        min={0}
                        value={waitAction.config.duration?.[unit] ?? ''}
                        onChange={(e) => {
                          const next = { ...waitAction.config.duration, [unit]: e.target.value ? Number(e.target.value) : undefined };
                          const empty = Object.values(next).every((v) => v === undefined);
                          onChange({ action: { ...waitAction, config: { ...waitAction.config, duration: empty ? undefined : next } } });
                        }}
                        className={cn(ri, 'w-16')}
                      />
                      {unit}
                    </label>
                  ))}
                </div>
              </FieldRow>

              <FieldRow label="action.deadline" tooltip={TIP.actionWaitDeadline}>
                <input
                  value={waitAction.config.deadline ?? ''}
                  placeholder="2026-01-01T00:00:00Z"
                  onChange={(e) => onChange({ action: { ...waitAction, config: { ...waitAction.config, deadline: e.target.value || undefined } } })}
                  className={cn(riMono, 'placeholder:italic placeholder:text-muted-foreground/40')}
                />
              </FieldRow>

              <FieldRow label="action.condition" tooltip={TIP.actionWaitCondition}>
                <input
                  value={waitAction.config.condition ?? ''}
                  placeholder="steps.poll.ready == true"
                  onChange={(e) => onChange({ action: { ...waitAction, config: { ...waitAction.config, condition: e.target.value || undefined } } })}
                  className={cn(riMono, 'placeholder:italic placeholder:text-muted-foreground/40')}
                />
              </FieldRow>
            </>
          )}

          {collectAction && (
            <FieldRow label="action.step" tooltip={TIP.actionCollectStep}>
              <input
                value={collectAction.config.step ?? ''}
                placeholder="provide_perspective"
                onChange={(e) => onChange({ action: { ...collectAction, config: { ...collectAction.config, step: e.target.value || undefined } } })}
                className={cn(riMono, 'placeholder:italic placeholder:text-muted-foreground/40')}
              />
            </FieldRow>
          )}

          {runWorkflowAction && (
            <>
              <FieldRow label="action.definitionName" tooltip={TIP.actionRunWorkflowName}>
                <div className="flex items-center gap-1.5">
                  <WorkflowTargetInputs
                    target={runWorkflowAction.config}
                    onChange={(patch) => onChange({ action: { ...runWorkflowAction, config: { ...runWorkflowAction.config, ...patch } } })}
                  />
                </div>
              </FieldRow>

              <JsonObjectPayloadField
                key={`run-workflow-payload-${step.id}`}
                label="action.payload"
                tooltip={TIP.actionRunWorkflowPayload}
                placeholder='{"case": "${steps.intake.case}"}'
                value={runWorkflowAction.config.payload}
                onChange={(payload) => onChange({ action: { ...runWorkflowAction, config: { ...runWorkflowAction.config, payload } } })}
              />

              <FieldRow label="action.timeout" tooltip={TIP.actionRunWorkflowTimeout}>
                <input
                  value={runWorkflowAction.config.timeout}
                  placeholder="P14D"
                  onChange={(e) => onChange({ action: { ...runWorkflowAction, config: { ...runWorkflowAction.config, timeout: e.target.value } } })}
                  className={cn(riMono, 'placeholder:italic placeholder:text-muted-foreground/40')}
                />
              </FieldRow>

              <FieldRow label="action.step" tooltip={TIP.actionRunWorkflowStep}>
                <input
                  value={runWorkflowAction.config.step ?? ''}
                  placeholder="return_result"
                  onChange={(e) => onChange({ action: { ...runWorkflowAction, config: { ...runWorkflowAction.config, step: e.target.value || undefined } } })}
                  className={cn(riMono, 'placeholder:italic placeholder:text-muted-foreground/40')}
                />
              </FieldRow>
            </>
          )}
        </FieldGroup>
      )}

      {/* ── Cowork ───────────────────────────────────────────────── */}
      {isCowork && <CoworkSection step={step} onChange={onChange} isNewStep={isNewStep} />}

      {/* ── Parameters (human task setup) ────────────────────────── */}
      {paramsInPrimary && parametersSection}

        </CollapsibleCard>
      )}

      {/* ── Routing ──────────────────────────────────────────────── */}
      {!isTerminal && (
        <CollapsibleCard title="Routing" open={openCards.routing} onToggle={() => toggleCard('routing')}>
      {hasVerdicts && (
      <>
      {/* ── Verdicts ─────────────────────────────────────────────── */}
        <Section title="Verdicts">
          <FieldGroup>
            {Object.entries(step.verdicts ?? {}).map(([verdictName, verdict], index) => (
              // Keyed by position, not name: a name-keyed row remounts on every
              // keystroke and the input loses focus mid-rename.
              <FieldRow key={index} label="Verdict" tooltip={TIP.verdictName}>
                <div className="flex items-center gap-1.5">
                  <input
                    value={verdictName}
                    onChange={(e) => {
                      const next: NonNullable<WorkflowStep['verdicts']> = {};
                      for (const [k, v] of Object.entries(step.verdicts ?? {})) {
                        next[k === verdictName ? e.target.value : k] = v;
                      }
                      onChange({ verdicts: next });
                    }}
                    className="bg-card text-xs font-medium rounded border border-border/60 hover:border-border focus:border-primary/60 focus:ring-1 focus:ring-primary/20 focus:outline-none px-2 py-1 transition-colors w-24 shrink-0"
                  />
                  <span className="text-xs text-muted-foreground/50 shrink-0">→</span>
                  <select
                    value={verdict.target}
                    onChange={(e) => onChange({ verdicts: { ...step.verdicts, [verdictName]: { ...verdict, target: e.target.value } } })}
                    className={cn(rs, 'flex-1')}
                    title={TIP.verdictTarget}
                  >
                    <option value="">Select step…</option>
                    {otherSteps.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.id})</option>)}
                  </select>
                  <button
                    onClick={() => {
                      const next = { ...step.verdicts };
                      delete next[verdictName];
                      onChange({ verdicts: Object.keys(next).length > 0 ? next : undefined });
                    }}
                    className="text-[10px] text-muted-foreground/30 hover:text-red-500 transition-colors shrink-0"
                  >×</button>
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <input
                    value={verdict.label ?? ''}
                    placeholder={defaultVerdictLabel(verdictName)}
                    title={TIP.verdictLabel}
                    onChange={(e) => onChange({ verdicts: { ...step.verdicts, [verdictName]: { ...verdict, label: e.target.value || undefined } } })}
                    className={cn(ri, 'flex-1 placeholder:italic placeholder:text-muted-foreground/40')}
                  />
                  <select
                    value={verdict.intent ?? ''}
                    title={TIP.verdictIntent}
                    onChange={(e) => onChange({ verdicts: { ...step.verdicts, [verdictName]: { ...verdict, intent: (e.target.value || undefined) as typeof verdict.intent } } })}
                    className={cn(rs, 'w-24 shrink-0')}
                  >
                    <option value="">Default</option>
                    <option value="success">Success</option>
                    <option value="danger">Danger</option>
                    <option value="warning">Warning</option>
                    <option value="neutral">Neutral</option>
                  </select>
                  <label className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground" title={TIP.verdictRequiresComment}>
                    <input
                      type="checkbox"
                      checked={verdict.requiresComment === true}
                      onChange={(e) => onChange({ verdicts: { ...step.verdicts, [verdictName]: { ...verdict, requiresComment: e.target.checked ? true : undefined } } })}
                      className="h-3.5 w-3.5 accent-primary"
                    />
                    comment
                  </label>
                </div>
              </FieldRow>
            ))}
            {Object.keys(step.verdicts ?? {}).length === 0 && (
              <div className="px-3 py-2 text-[11px] text-muted-foreground/40 italic">No verdicts defined</div>
            )}
          </FieldGroup>
          <button
            onClick={() => {
              const name = uniqueSlug('new-verdict', Object.keys(step.verdicts ?? {}));
              onChange({ verdicts: { ...step.verdicts, [name]: { target: '' } } });
            }}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >+ Add verdict</button>
        </Section>
      </>
      )}
        <Section title="Conditions">
          <FieldGroup>
            {outgoingTransitions.map((transition) => {
              const index = transitions.indexOf(transition);
              return (
                <FieldRow key={index} label="When" tooltip={TIP.transitionWhen}>
                  <div className="flex items-center gap-1.5">
                    <input
                      value={transition.when ?? ''}
                      placeholder="always"
                      onChange={(e) => onTransitionsChange(transitions.map((t, i) => (i === index ? { ...t, when: e.target.value || undefined } : t)))}
                      className={cn(ri, 'flex-1 placeholder:italic placeholder:text-muted-foreground/40')}
                    />
                    <span className="text-xs text-muted-foreground/50 shrink-0">→</span>
                    <select
                      value={transition.to}
                      onChange={(e) => onTransitionsChange(transitions.map((t, i) => (i === index ? { ...t, to: e.target.value } : t)))}
                      className={cn(rs, 'flex-1')}
                      title={TIP.transitionTarget}
                    >
                      <option value="">Select step…</option>
                      {otherSteps.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.id})</option>)}
                    </select>
                    <button
                      onClick={() => onTransitionsChange(transitions.filter((_, i) => i !== index))}
                      className="text-[10px] text-muted-foreground/30 hover:text-red-500 transition-colors shrink-0"
                    >×</button>
                  </div>
                </FieldRow>
              );
            })}
            {outgoingTransitions.length === 0 && (
              <div className="px-3 py-2 text-[11px] text-muted-foreground/40 italic">No outgoing transitions</div>
            )}
          </FieldGroup>
          <button
            onClick={() => onTransitionsChange([...transitions, { from: step.id, to: otherSteps[0]?.id ?? '' }])}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >+ Add transition</button>
        </Section>
        </CollapsibleCard>
      )}

      {/* ── Advanced ─────────────────────────────────────────────── */}
      <CollapsibleCard title="Advanced" open={openCards.advanced} onToggle={() => toggleCard('advanced')}>

      {/* ── Identity & failure handling ──────────────────────────── */}
      <FieldGroup>
        <FieldRow label="id" tooltip={TIP.id} error={errors?.id ? friendlyFieldError(errors.id) : undefined}>
          <StepIdField currentId={step.id} onChange={(v) => onChange({ id: v })} error={errors?.id} />
        </FieldRow>
        {!isTerminal && (
          <FieldRow label="continueOnError" tooltip={TIP.continueOnError}>
            <label className="inline-flex items-center gap-2 text-xs text-muted-foreground py-0.5 cursor-pointer">
              <input
                type="checkbox"
                checked={step.continueOnError ?? false}
                onChange={(e) => onChange({ continueOnError: e.target.checked || undefined })}
              />
              Advance the run even if this step fails
            </label>
          </FieldRow>
        )}
      </FieldGroup>

      {/* ── Human roles ──────────────────────────────────────────── */}
      {hasHumanReviewer && (
        <FieldGroup>
          <FieldRow label="allowedRoles" tooltip={TIP.allowedRoles}>
            <AllowedRolesField
              value={step.allowedRoles ?? []}
              vocabulary={workspaceRoles}
              heldRoles={heldRoles}
              onChange={(roles) => onChange({ allowedRoles: roles.length > 0 ? roles : undefined })}
            />
          </FieldRow>
          <FieldRow label="assignedTo" tooltip={TIP.assignedTo}>
            <AssignedToField
              value={step.assignedTo ?? ''}
              members={members}
              onChange={(assignedTo) => onChange({ assignedTo: assignedTo || undefined })}
            />
          </FieldRow>
        </FieldGroup>
      )}

      {/* ── Parameters (non-human) ───────────────────────────────── */}
      {paramsInAdvanced && parametersSection}

      {/* ── MCP restrictions ─────────────────────────────────────── */}
      {isAgent && step.agentId !== undefined && step.agentId !== '' && (
        <McpRestrictionsSection
          agentId={step.agentId}
          restrictions={step.mcpRestrictions}
          onChange={(next) => onChange({ mcpRestrictions: next })}
        />
      )}

      {/* ── Environment ──────────────────────────────────────────── */}
      {!isTerminal && (
        <Section title="Environment">
          <FieldGroup>
            {Object.entries(step.env ?? {}).map(([key, val], idx) => (
              <div key={idx} className="grid grid-cols-[1fr_1fr] gap-x-2 px-3 py-1.5 border-b border-border/30 last:border-0 items-center">
                <input
                  value={key}
                  onChange={(e) => {
                    const newEnv: Record<string, string> = {};
                    for (const [k, v] of Object.entries(step.env ?? {})) {
                      newEnv[k === key ? e.target.value : k] = v;
                    }
                    onChange({ env: newEnv });
                  }}
                  className={cn(riMono, 'text-muted-foreground/70')}
                  title="Environment variable name injected into the agent or script container."
                />
                <div className="relative flex items-center gap-1.5 group">
                  <input
                    value={val}
                    onChange={(e) => onChange({ env: { ...step.env, [key]: e.target.value } })}
                    className={cn(riMono, 'flex-1')}
                    title="Variable value. Use {{secret-name}} to reference a workflow secret."
                  />
                  {secretKeys.length > 0 && !val.startsWith('{{') && (
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) onChange({ env: { ...step.env, [key]: `{{${e.target.value}}}` } });
                      }}
                      className="absolute right-5 top-0 h-full opacity-0 group-hover:opacity-100 focus:opacity-100 bg-transparent text-xs cursor-pointer transition-opacity w-5"
                      title="Insert secret reference"
                    >
                      <option value="">🔑</option>
                      {secretKeys.map((sk) => <option key={sk} value={sk}>{sk}</option>)}
                    </select>
                  )}
                  <button
                    onClick={() => {
                      const newEnv = { ...step.env };
                      delete newEnv[key];
                      onChange({ env: Object.keys(newEnv).length > 0 ? newEnv : undefined });
                    }}
                    className="text-[10px] text-muted-foreground/30 hover:text-red-500 transition-colors shrink-0"
                  >×</button>
                </div>
              </div>
            ))}
            {Object.keys(step.env ?? {}).length === 0 && (
              <div className="px-3 py-2 text-[11px] text-muted-foreground/40 italic">No variables defined</div>
            )}
          </FieldGroup>
          <button
            onClick={() => {
              const variable = uniqueName('NEW_VAR', Object.keys(step.env ?? {}), '_');
              onChange({ env: { ...step.env, [variable]: '' } });
            }}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >+ Add variable</button>
        </Section>
      )}

      </CollapsibleCard>

    </div>
  );
}
