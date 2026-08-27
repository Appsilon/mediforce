'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Lock, User, Bot, Terminal, Users, PenLine, Search, GitBranch, Flag, AlertTriangle, X } from 'lucide-react';
import { useParams } from 'next/navigation';
import { usePlugins } from '@/hooks/use-plugins';
import { useAuth } from '@/contexts/auth-context';
import { mediforce } from '@/lib/mediforce';
import { cn } from '@/lib/utils';
import { paramNameCounts } from '@/lib/workflow-save-utils';

import { DEFAULT_AGENT_IMAGE, uniqueSlug } from '@mediforce/platform-core';
import type { WorkflowDefinition, WorkflowStep, HttpMethod, ActionConfig } from '@mediforce/platform-core';
import type { DockerImageInfo } from '@mediforce/platform-api/contract';
import { ModelPicker } from './model-picker';
import {
  STEP_TYPE_LABELS,
  FALLBACK_OPTIONS,
  RUNTIME_OPTIONS,
} from './constants';
import { CoworkSection } from './cowork-section';
import { StepDataFlow } from './step-data-flow';
import { FieldRow, FieldGroup, Section, PillToggle, inputBase, inputBaseMono, selectBase, textareaBase, humanizeToken } from './step-editor-fields';
import { McpRestrictionsSection } from './mcp-restrictions-section';
import { CollapsibleCard } from './collapsible-card';

function friendlyFieldError(message: string): string {
  if (/too small|>=1|at least 1/i.test(message)) return 'This field cannot be empty.';
  return message;
}

export function buildExecutorChangePatch(step: WorkflowStep, targetExecutor: WorkflowStep['executor']): Partial<WorkflowStep> {
  const SHARED_CONTAINER_KEYS = ['image', 'dockerfile', 'repo', 'commit', 'repoAuth'] as const;
  const base: Partial<WorkflowStep> = { executor: targetExecutor };

  if (targetExecutor === 'human') {
    return { ...base, plugin: undefined, agent: undefined, script: undefined, databricks: undefined, cowork: undefined };
  }
  if (targetExecutor === 'agent') {
    const carriedFromScript = step.script
      ? Object.fromEntries(Object.entries(step.script).filter(([k]) => SHARED_CONTAINER_KEYS.includes(k as typeof SHARED_CONTAINER_KEYS[number])))
      : undefined;
    const agent = step.agent ?? (Object.keys(carriedFromScript ?? {}).length > 0 ? carriedFromScript as WorkflowStep['agent'] : undefined);
    return {
      ...base, allowedRoles: undefined, cowork: undefined, script: undefined, databricks: undefined,
      plugin: step.plugin === 'script-container' || step.plugin === 'databricks-job' ? 'opencode-agent' : step.plugin ?? 'opencode-agent',
      agent,
    };
  }
  if (targetExecutor === 'script') {
    const carriedFromAgent = step.agent
      ? Object.fromEntries(Object.entries(step.agent).filter(([k]) => SHARED_CONTAINER_KEYS.includes(k as typeof SHARED_CONTAINER_KEYS[number])))
      : undefined;
    const script = step.script ?? (Object.keys(carriedFromAgent ?? {}).length > 0 ? carriedFromAgent as WorkflowStep['script'] : undefined);
    return {
      ...base, allowedRoles: undefined, autonomyLevel: undefined, cowork: undefined, agent: undefined,
      plugin: step.plugin ?? 'script-container',
      script,
    };
  }
  return {
    ...base, plugin: undefined, autonomyLevel: undefined, allowedRoles: undefined,
    agent: undefined, script: undefined, databricks: undefined, cowork: step.cowork ?? { agent: 'chat' },
  };
}

const ri = inputBase;
const riMono = inputBaseMono;
const rs = selectBase;
const rt = textareaBase;

function imageRef(img: DockerImageInfo): string {
  return img.tag && img.tag !== '<none>' ? `${img.repository}:${img.tag}` : img.repository;
}

function pickerImageValue(image: string): string {
  return image === `${DEFAULT_AGENT_IMAGE}:latest` ? DEFAULT_AGENT_IMAGE : image;
}

/**
 * Agent images sorted with the golden image first — it is the one image
 * guaranteed to carry an agent CLI, and every other discovered image (a bare
 * `alpine`, a language runtime) fails at container start for an agent step.
 */
function agentImageOptions(images: DockerImageInfo[]): Array<{ img: DockerImageInfo; label: string }> {
  return images
    .map((img) => {
      const value = pickerImageValue(imageRef(img));
      const recommended = value === DEFAULT_AGENT_IMAGE;
      return { img, recommended, label: recommended ? `★ ${imageRef(img)}` : imageRef(img) };
    })
    .sort((a, b) => Number(b.recommended) - Number(a.recommended));
}

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
  plugin:                  'Agent plugin to invoke (e.g. opencode-agent, claude-code-agent). Must be registered in the platform.',
  pluginScript:            'Plugin that runs the script (usually script-container). Must be registered in the platform.',
  agentId:                 'Slug of a saved agent definition. Loads its base model, skills, and MCP server bindings for this step.',
  agentModel:              'LLM model for this step. Overrides the agent definition\'s default. Use provider/model format.',
  agentSkill:              'Skill file name to load at runtime. Skills provide specialised instructions and tools for a specific task.',
  agentSkillsDir:          'Repo-relative path to the directory containing skill files. Overrides the agent definition\'s setting.',
  agentTimeoutMinutes:     'Maximum minutes the agent may run before the step is escalated.',
  agentTimeoutMs:          'Maximum run time in milliseconds. Takes precedence over timeoutMinutes if both are set.',
  agentConfidence:         'Minimum confidence (0–1) the agent must self-report before output is accepted. Below this, the step escalates.',
  agentFallback:           'What to do if the agent fails or is below the confidence threshold: escalate to human, retry, or skip.',
  agentAllowedTools:       'Tools the agent may call, comma-separated. Leave empty to allow all available tools.',
  agentPrompt:             'Additional instructions appended to the agent\'s system prompt for this step only.',
  agentImage:              'Docker image for the agent container (e.g. python:3.11-slim). Required for deployed execution.',
  agentDockerfile:         'Path to a Dockerfile in agent.repo. When set, the container is built from this file instead of agent.image.',
  agentRepo:               'Git repository URL to clone into the container before running the agent.',
  agentCommit:             'Commit SHA or branch to check out from agent.repo. Defaults to the repo\'s default branch.',
  agentRepoAuth:           'Name of a workflow secret holding the auth token for cloning a private repository.',

  scriptRuntime:           'Language runtime for the inline script: javascript, python, r, or bash.',
  scriptCommand:           'Shell command to run in the container, typically to invoke a file from script.repo.',
  scriptImage:             'Docker base image for the container (e.g. python:3.11-slim).',
  scriptDockerfile:        'Path to a Dockerfile in script.repo. When set, the container is built from this file instead of script.image.',
  scriptRepo:              'Git repository URL to clone into the container before running the command.',
  scriptCommit:            'Commit SHA or branch to check out from script.repo. Defaults to the repo\'s default branch.',
  scriptRepoAuth:          'Name of a workflow secret holding the auth token for cloning a private repository.',
  scriptInlineScript:      'Script source code to run directly in the container. Set the language via script.runtime.',

  databricksJobId:         'ID of an existing Databricks job to trigger. Supports ${steps.*} interpolation when given as a string.',
  databricksNotebookParams:'notebook_params for run-now as JSON object of string values. Values support ${steps.*} interpolation.',
  databricksJobParameters: 'job_parameters for run-now (jobs with job-level parameters) as JSON object of string values.',
  databricksPollIntervalMs:'How often to poll the run state, in milliseconds. Default 10000.',
  databricksTimeoutMinutes:'Step timeout in minutes — the run is cancelled when exceeded. Default 30.',

  allowedRoles:            'Roles that can claim and complete this task, comma-separated. Enforced: a member holding none of them is refused, and a role nobody in the workspace holds makes the step unclaimable. Leave empty to allow any workspace member.',
  assignedTo:              'Pre-assign this human task to a specific user. Accepts a user id or an interpolated value like ${triggerPayload.userId}. Human steps only.',
  continueOnError:         'When on, a failure of this step is logged as a warning and the workflow advances anyway instead of failing the whole run. Use for non-critical side-effects (e.g. a notification), never for a step later steps depend on.',
  uiComponent:             'Custom task body. "File upload" collects files; "Assignment table" and "Table editor" render their own views (configure their columns in the source editor). Default is the params form.',
  uiAcceptedTypes:         'Accepted file types, comma-separated — MIME types and/or extensions (e.g. text/csv, .csv, application/pdf). If empty, only PDFs are accepted.',
  uiMinFiles:              'Minimum number of files the user must upload to complete the task.',
  uiMaxFiles:              'Maximum number of files the user can upload.',

  reviewType:              'Who performs the review: human (creates a task), agent (auto-evaluates), or none (skips review).',
  reviewPlugin:            'Plugin used when review.type is agent.',
  reviewMaxIterations:     'Maximum revision cycles before the review is auto-escalated. Prevents infinite feedback loops.',
  reviewTimeBoxDays:       'Calendar days before an unresolved review is automatically escalated.',
  selectionMin:            'Minimum number of reviewers required to reach a binding verdict.',
  selectionMax:            'Maximum number of reviewers who may participate in this review step.',

  actionKind:              'Action type: http (outbound API call), reshape (update workflow variables), or email. Fixed at creation.',
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
      value={draft}
      onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
      className={cn(riMono, error && 'border-red-400 focus:border-red-500')}
    />
  );
}

// ---------------------------------------------------------------------------
// StepEditor
// ---------------------------------------------------------------------------

export function StepEditor({
  step,
  allSteps,
  workflowName,
  onChange,
  onClose,
  errors,
  imageWarning,
  dockerImages,
  workflowExternalSkillsRepo,
}: {
  step: WorkflowStep;
  allSteps: WorkflowStep[];
  workflowName?: string;
  onChange: (patch: Partial<WorkflowStep>) => void;
  onClose?: () => void;
  errors?: Record<string, string>;
  imageWarning?: string;
  dockerImages?: DockerImageInfo[];
  workflowExternalSkillsRepo?: WorkflowDefinition['externalSkillsRepo'];
}) {
  const isNewStep = step.id.startsWith('new-step-');
  const { plugins } = usePlugins();
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
  const isDecision = step.type === 'decision';
  const hasVerdicts = isReview || isDecision;
  const isTerminal = step.type === 'terminal';

  const httpAction    = step.action?.kind === 'http'    ? step.action : undefined;
  const reshapeAction = step.action?.kind === 'reshape' ? step.action : undefined;
  const emailAction   = step.action?.kind === 'email'   ? step.action : undefined;

  const selMin = typeof step.selection === 'number' ? step.selection : step.selection?.min;
  const selMax = typeof step.selection === 'number' ? step.selection : step.selection?.max;

  // Leaving agent.image blank is not "unset" — registration fills in the golden
  // image, unless the step builds its own from repo + commit. Say which, so the
  // picker and the saved definition agree.
  const agentBuildsOwnImage =
    typeof step.agent?.repo === 'string' && step.agent.repo.length > 0
    && typeof step.agent?.commit === 'string' && step.agent.commit.length > 0;
  const agentBuildsFromWorkflowSource =
    typeof step.agent?.dockerfile === 'string' && step.agent.dockerfile.length > 0
    && typeof workflowExternalSkillsRepo?.url === 'string' && workflowExternalSkillsRepo.url.length > 0
    && typeof workflowExternalSkillsRepo.commit === 'string' && workflowExternalSkillsRepo.commit.length > 0;
  const agentBlankOptionLabel = agentBuildsOwnImage
    ? 'Built from agent.repo'
    : agentBuildsFromWorkflowSource
      ? 'Built from workflow source'
      : `Default — ${DEFAULT_AGENT_IMAGE}`;

  function updateAgent(patch: Partial<NonNullable<WorkflowStep['agent']>>) {
    onChange({ agent: { ...step.agent, ...patch } });
  }
  function updateScript(patch: Partial<NonNullable<WorkflowStep['script']>>) {
    onChange({ script: { ...step.script, ...patch } });
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
  function updateReview(patch: Partial<NonNullable<WorkflowStep['review']>>) {
    onChange({ review: { ...step.review, ...patch } });
  }
  function setUiComponent(component: string) {
    if (!component) { onChange({ ui: undefined }); return; }
    onChange({ ui: { ...step.ui, component } });
  }
  function updateUiConfig(key: string, value: unknown) {
    const component = step.ui?.component ?? 'file-upload';
    const config = { ...step.ui?.config, [key]: value };
    if (value === undefined) delete config[key];
    onChange({ ui: { component, config: Object.keys(config).length > 0 ? config : undefined } });
  }
  function updateSelection(newMin: number | undefined, newMax: number | undefined) {
    if (newMin === undefined && newMax === undefined) { onChange({ selection: undefined }); return; }
    onChange({ selection: { min: newMin ?? 1, max: newMax ?? 1 } });
  }

  const execStyle = EXECUTOR_ICON[step.executor] ?? EXECUTOR_ICON.human;
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
      ? 'Script'
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
  const defaultOpenCards: Record<string, boolean> = { basics: true, primary: false, routing: false, advanced: false };
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
    <div className="flex flex-col gap-3 h-full min-h-0" data-testid="step-editor">

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
              onChange={(v) => onChange({ autonomyLevel: v as WorkflowStep['autonomyLevel'] })}
              options={[
                { value: 'L2', label: 'Assist', icon: Bot, activeClassName: 'border-lime-400 bg-lime-50 text-lime-700 dark:bg-lime-950/30 dark:text-lime-400' },
                { value: 'L3', label: 'Human Review', icon: Users, activeClassName: 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400' },
                { value: 'L4', label: 'Autonomous', icon: Bot, activeClassName: 'border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-400' },
              ]}
            />
          </FieldRow>

          <FieldRow label="plugin" tooltip={TIP.plugin}>
            <select
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

          <FieldRow label="agentId" tooltip={TIP.agentId}>
            <input
              value={step.agentId ?? ''}
              onChange={(e) => onChange({ agentId: e.target.value || undefined })}
              className={riMono}
            />
          </FieldRow>

          <FieldRow label="agent.model" tooltip={TIP.agentModel}>
            <ModelPicker
              value={step.agent?.model}
              onChange={(model) => updateAgent({ model })}
              defaultModel={selectedPluginDefaultModel}
              className={rs}
            />
          </FieldRow>

          <FieldRow label="agent.skill" tooltip={TIP.agentSkill}>
            <input
              value={step.agent?.skill ?? ''}
              onChange={(e) => updateAgent({ skill: e.target.value || undefined })}
              className={riMono}
            />
          </FieldRow>

          <FieldRow label="agent.skillsDir" tooltip={TIP.agentSkillsDir}>
            <input
              value={step.agent?.skillsDir ?? ''}
              onChange={(e) => updateAgent({ skillsDir: e.target.value || undefined })}
              className={riMono}
            />
          </FieldRow>

          <FieldRow label="agent.timeoutMinutes" tooltip={TIP.agentTimeoutMinutes}>
            <input
              type="number"
              value={step.agent?.timeoutMinutes ?? ''}
              onChange={(e) => updateAgent({ timeoutMinutes: e.target.value ? Number(e.target.value) : undefined })}
              className={ri}
            />
          </FieldRow>

          <FieldRow label="agent.timeoutMs" tooltip={TIP.agentTimeoutMs}>
            <input
              type="number"
              value={step.agent?.timeoutMs ?? ''}
              onChange={(e) => updateAgent({ timeoutMs: e.target.value ? Number(e.target.value) : undefined })}
              className={ri}
            />
          </FieldRow>

          <FieldRow label="agent.confidenceThreshold" tooltip={TIP.agentConfidence}>
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={step.agent?.confidenceThreshold ?? ''}
              onChange={(e) => updateAgent({ confidenceThreshold: e.target.value ? Number(e.target.value) : undefined })}
              className={ri}
            />
          </FieldRow>

          <FieldRow label="agent.fallbackBehavior" tooltip={TIP.agentFallback}>
            <select
              value={step.agent?.fallbackBehavior ?? ''}
              onChange={(e) => updateAgent({ fallbackBehavior: (e.target.value || undefined) as WorkflowStep['agent'] extends { fallbackBehavior?: infer F } ? F : never })}
              className={rs}
            >
              {FALLBACK_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </FieldRow>

          <FieldRow label="agent.allowedTools" tooltip={TIP.agentAllowedTools}>
            <input
              value={step.agent?.allowedTools?.join(', ') ?? ''}
              onChange={(e) => updateAgent({
                allowedTools: e.target.value ? e.target.value.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
              })}
              className={ri}
            />
          </FieldRow>

          <FieldRow label="agent.prompt" tooltip={TIP.agentPrompt} alignStart>
            <textarea
              value={step.agent?.prompt ?? ''}
              onChange={(e) => updateAgent({ prompt: e.target.value || undefined })}
              rows={3}
              placeholder="Instructions for the agent…"
              className={cn(rt, 'placeholder:italic placeholder:text-muted-foreground/40')}
            />
          </FieldRow>
        </FieldGroup>

        <FieldGroup>
          <FieldRow label="agent.image" tooltip={TIP.agentImage}>
            {dockerImages && dockerImages.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <select
                  aria-label="Known Docker image"
                  value={pickerImageValue(step.agent?.image ?? '')}
                  onChange={(e) => updateAgent({ image: e.target.value || undefined })}
                  className={rs}
                >
                  <option value="">{agentBlankOptionLabel}</option>
                  {agentImageOptions(dockerImages).map(({ img, label }) => (
                    <option key={img.id} value={pickerImageValue(imageRef(img))}>{label}</option>
                  ))}
                  {step.agent?.image && !dockerImages.some(
                    (img) => pickerImageValue(imageRef(img)) === pickerImageValue(step.agent?.image ?? ''),
                  ) && (
                    <option value={step.agent.image}>{step.agent.image}</option>
                  )}
                </select>
                <input
                  aria-label="Custom Docker image"
                  value={step.agent?.image ?? ''}
                  onChange={(e) => updateAgent({ image: e.target.value || undefined })}
                  className={riMono}
                />
              </div>
            ) : (
              <input
                aria-label="Custom Docker image"
                value={step.agent?.image ?? ''}
                onChange={(e) => updateAgent({ image: e.target.value || undefined })}
                className={riMono}
              />
            )}
          </FieldRow>
          {imageWarning && (
            <div className="flex items-center gap-1.5 px-3 -mt-1">
              <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" strokeWidth={2} />
              <span className="text-[11px] text-amber-600 dark:text-amber-400">{imageWarning}</span>
            </div>
          )}

          <FieldRow label="agent.dockerfile" tooltip={TIP.agentDockerfile}>
            <input
              value={step.agent?.dockerfile ?? ''}
              onChange={(e) => updateAgent({ dockerfile: e.target.value || undefined })}
              className={riMono}
            />
          </FieldRow>

          <FieldRow label="agent.repo" tooltip={TIP.agentRepo}>
            <input
              value={step.agent?.repo ?? ''}
              onChange={(e) => updateAgent({ repo: e.target.value || undefined })}
              className={riMono}
            />
          </FieldRow>

          <FieldRow label="agent.commit" tooltip={TIP.agentCommit}>
            <input
              value={step.agent?.commit ?? ''}
              onChange={(e) => updateAgent({ commit: e.target.value || undefined })}
              className={riMono}
            />
          </FieldRow>

          <FieldRow label="agent.repoAuth" tooltip={TIP.agentRepoAuth}>
            <input
              value={step.agent?.repoAuth ?? ''}
              onChange={(e) => updateAgent({ repoAuth: e.target.value || undefined })}
              className={riMono}
            />
          </FieldRow>
        </FieldGroup>
      </>)}

      {/* ── Script config ────────────────────────────────────────── */}
      {isScript && (<>
        <FieldGroup>
          <FieldRow label="plugin" tooltip={TIP.pluginScript}>
            <input
              value={step.plugin ?? ''}
              onChange={(e) => onChange({ plugin: e.target.value || undefined })}
              className={riMono}
            />
          </FieldRow>

          {step.plugin !== 'databricks-job' && (<>
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
          <FieldRow label="databricks.timeoutMinutes" tooltip={TIP.databricksTimeoutMinutes}>
            <input
              type="number"
              value={step.databricks?.timeoutMinutes ?? ''}
              onChange={(e) => updateDatabricks({ timeoutMinutes: e.target.value ? Number(e.target.value) : undefined })}
              className={riMono}
            />
          </FieldRow>
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
        </FieldGroup>

        {step.plugin !== 'databricks-job' && (
          <FieldGroup>
            <FieldRow label="script.image" tooltip={TIP.scriptImage}>
              {dockerImages && dockerImages.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <select
                    aria-label="Known Docker image"
                    value={step.script?.image ?? ''}
                    onChange={(e) => updateScript({ image: e.target.value || undefined })}
                    className={rs}
                  >
                    <option value="">Select image…</option>
                    {dockerImages.map((img) => {
                      const ref = imageRef(img);
                      return <option key={img.id} value={ref}>{ref}</option>;
                    })}
                    {step.script?.image && !dockerImages.some((img) => imageRef(img) === step.script?.image) && (
                      <option value={step.script.image}>{step.script.image}</option>
                    )}
                  </select>
                  <input
                    aria-label="Custom Docker image"
                    value={step.script?.image ?? ''}
                    onChange={(e) => updateScript({ image: e.target.value || undefined })}
                    className={riMono}
                  />
                </div>
              ) : (
                <input
                  aria-label="Custom Docker image"
                  value={step.script?.image ?? ''}
                  onChange={(e) => updateScript({ image: e.target.value || undefined })}
                  className={riMono}
                />
              )}
            </FieldRow>
            {imageWarning && (
              <div className="flex items-center gap-1.5 px-3 -mt-1">
                <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" strokeWidth={2} />
                <span className="text-[11px] text-amber-600 dark:text-amber-400">{imageWarning}</span>
              </div>
            )}

            <FieldRow label="script.dockerfile" tooltip={TIP.scriptDockerfile}>
              <input
                value={step.script?.dockerfile ?? ''}
                onChange={(e) => updateScript({ dockerfile: e.target.value || undefined })}
                className={riMono}
              />
            </FieldRow>

            <FieldRow label="script.repo" tooltip={TIP.scriptRepo}>
              <input
                value={step.script?.repo ?? ''}
                onChange={(e) => updateScript({ repo: e.target.value || undefined })}
                className={riMono}
              />
            </FieldRow>

            <FieldRow label="script.commit" tooltip={TIP.scriptCommit}>
              <input
                value={step.script?.commit ?? ''}
                onChange={(e) => updateScript({ commit: e.target.value || undefined })}
                className={riMono}
              />
            </FieldRow>

            <FieldRow label="script.repoAuth" tooltip={TIP.scriptRepoAuth}>
              <input
                value={step.script?.repoAuth ?? ''}
                onChange={(e) => updateScript({ repoAuth: e.target.value || undefined })}
                className={riMono}
              />
            </FieldRow>
          </FieldGroup>
        )}
      </>)}

      {/* ── Task UI (custom body) ────────────────────────────────── */}
      {isHuman && (
        <Section title="Task UI">
          <FieldGroup>
            <FieldRow label="component" tooltip={TIP.uiComponent}>
              <select
                value={step.ui?.component ?? ''}
                onChange={(e) => setUiComponent(e.target.value)}
                className={rs}
              >
                <option value="">Params form (default)</option>
                <option value="file-upload">File upload</option>
                <option value="assignment-table">Assignment table</option>
                <option value="table-editor">Table editor</option>
              </select>
            </FieldRow>
            {step.ui?.component === 'file-upload' && (<>
              <FieldRow label="acceptedTypes" tooltip={TIP.uiAcceptedTypes}>
                <input
                  value={(step.ui.config?.acceptedTypes as string[] | undefined)?.join(', ') ?? ''}
                  onChange={(e) => {
                    const list = e.target.value.split(',').map((t) => t.trim()).filter(Boolean);
                    updateUiConfig('acceptedTypes', list.length > 0 ? list : undefined);
                  }}
                  placeholder="text/csv, .csv, application/pdf"
                  className={riMono}
                />
              </FieldRow>
              <FieldRow label="minFiles" tooltip={TIP.uiMinFiles}>
                <input
                  type="number"
                  min={0}
                  value={(step.ui.config?.minFiles as number | undefined) ?? ''}
                  onChange={(e) => updateUiConfig('minFiles', e.target.value === '' ? undefined : Number(e.target.value))}
                  className={ri}
                />
              </FieldRow>
              <FieldRow label="maxFiles" tooltip={TIP.uiMaxFiles}>
                <input
                  type="number"
                  min={1}
                  value={(step.ui.config?.maxFiles as number | undefined) ?? ''}
                  onChange={(e) => updateUiConfig('maxFiles', e.target.value === '' ? undefined : Number(e.target.value))}
                  className={ri}
                />
              </FieldRow>
            </>)}
            {(step.ui?.component === 'assignment-table' || step.ui?.component === 'table-editor') && (
              <p className="text-xs text-muted-foreground px-0.5">Configure this component&apos;s columns in the source editor.</p>
            )}
          </FieldGroup>
        </Section>
      )}

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
                    onClick={() => onChange({ action: { ...httpAction, config: { ...httpAction.config, headers: { ...httpAction.config.headers, 'X-Header': '' } } } })}
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
        </FieldGroup>
      )}

      {/* ── Cowork ───────────────────────────────────────────────── */}
      {isCowork && <CoworkSection step={step} onChange={onChange} isNewStep={isNewStep} />}

      {/* ── Parameters (human task setup) ────────────────────────── */}
      {paramsInPrimary && parametersSection}

        </CollapsibleCard>
      )}

      {/* ── Routing ──────────────────────────────────────────────── */}
      {hasVerdicts && (
        <CollapsibleCard title="Routing" open={openCards.routing} onToggle={() => toggleCard('routing')}>
      {/* ── Verdicts ─────────────────────────────────────────────── */}
        <Section title="Verdicts">
          <FieldGroup>
            {Object.entries(step.verdicts ?? {}).map(([verdictName, verdict]) => (
              <FieldRow key={verdictName} label={verdictName} tooltip={TIP.verdictName}>
                <div className="flex items-center gap-1.5">
                  <input
                    value={verdictName}
                    onChange={(e) => {
                      const next: Record<string, { target: string }> = {};
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
              </FieldRow>
            ))}
            {Object.keys(step.verdicts ?? {}).length === 0 && (
              <div className="px-3 py-2 text-[11px] text-muted-foreground/40 italic">No verdicts defined</div>
            )}
          </FieldGroup>
          <button
            onClick={() => onChange({ verdicts: { ...step.verdicts, 'new-verdict': { target: '' } } })}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >+ Add verdict</button>
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
      {isHuman && (
        <FieldGroup>
          <FieldRow label="allowedRoles" tooltip={TIP.allowedRoles}>
            <input
              value={step.allowedRoles?.join(', ') ?? ''}
              onChange={(e) => onChange({
                allowedRoles: e.target.value ? e.target.value.split(',').map((r) => r.trim()).filter(Boolean) : undefined,
              })}
              className={ri}
            />
          </FieldRow>
          <FieldRow label="assignedTo" tooltip={TIP.assignedTo}>
            <input
              value={step.assignedTo ?? ''}
              onChange={(e) => onChange({ assignedTo: e.target.value || undefined })}
              placeholder="user id or ${triggerPayload.userId}"
              className={riMono}
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
            onClick={() => onChange({ env: { ...step.env, NEW_VAR: '' } })}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >+ Add variable</button>
        </Section>
      )}

      </CollapsibleCard>

    </div>
  );
}
