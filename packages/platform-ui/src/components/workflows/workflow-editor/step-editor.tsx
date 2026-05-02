'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Lock, User, Bot, Terminal, Users, PenLine, Search, GitBranch, Flag } from 'lucide-react';
import { useParams } from 'next/navigation';
import { usePlugins } from '@/hooks/use-plugins';
import { useAuth } from '@/contexts/auth-context';
import { getWorkflowSecretKeys } from '@/app/actions/workflow-secrets';
import { cn } from '@/lib/utils';
import type { WorkflowStep, HttpMethod, ActionConfig } from '@mediforce/platform-core';
import {
  AUTONOMY_LEVELS,
  STEP_TYPE_LABELS,
  FALLBACK_OPTIONS,
  KNOWN_MODELS,
  RUNTIME_OPTIONS,
} from './constants';
import { CoworkSection } from './cowork-section';
import { FieldRow, FieldGroup, Section, inputBase, inputBaseMono, selectBase, textareaBase } from './step-editor-fields';
import { McpRestrictionsSection } from './mcp-restrictions-section';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function friendlyFieldError(message: string): string {
  if (/too small|>=1|at least 1/i.test(message)) return 'This field cannot be empty.';
  return message;
}

export function buildExecutorChangePatch(step: WorkflowStep, targetExecutor: WorkflowStep['executor']): Partial<WorkflowStep> {
  const AGENT_ONLY = ['model', 'skill', 'prompt', 'skillsDir', 'timeoutMs', 'timeoutMinutes', 'confidenceThreshold', 'fallbackBehavior'] as const;
  const SCRIPT_ONLY = ['command', 'inlineScript', 'runtime', 'image', 'dockerfile', 'repo', 'commit', 'repoAuth'] as const;
  const base: Partial<WorkflowStep> = { executor: targetExecutor };

  if (targetExecutor === 'human') {
    return { ...base, plugin: undefined, agent: undefined, cowork: undefined };
  }
  if (targetExecutor === 'agent') {
    const cleanedAgent = step.agent
      ? Object.fromEntries(Object.entries(step.agent).filter(([k]) => !SCRIPT_ONLY.includes(k as typeof SCRIPT_ONLY[number])))
      : undefined;
    return {
      ...base, allowedRoles: undefined, cowork: undefined,
      plugin: step.plugin ?? 'opencode-agent',
      agent: Object.keys(cleanedAgent ?? {}).length > 0 ? cleanedAgent as WorkflowStep['agent'] : undefined,
    };
  }
  if (targetExecutor === 'script') {
    const cleanedAgent = step.agent
      ? Object.fromEntries(Object.entries(step.agent).filter(([k]) => !AGENT_ONLY.includes(k as typeof AGENT_ONLY[number])))
      : undefined;
    return {
      ...base, allowedRoles: undefined, autonomyLevel: undefined, cowork: undefined,
      plugin: step.plugin ?? 'script-container',
      agent: Object.keys(cleanedAgent ?? {}).length > 0 ? cleanedAgent as WorkflowStep['agent'] : undefined,
    };
  }
  return {
    ...base, plugin: undefined, autonomyLevel: undefined, allowedRoles: undefined,
    agent: undefined, cowork: step.cowork ?? { agent: 'chat' },
  };
}

const ri = inputBase;
const riMono = inputBaseMono;
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
  id:                      'Unique slug identifier used in transition targets and API references. Auto-derived from the name.',
  description:             'Optional notes for collaborators explaining what this step does and why it exists.',
  type:                    'Structural role in the workflow: creation, review, decision, or terminal. Fixed at step creation.',
  executor:                'Who performs this step: human, agent, script, cowork, or action. Fixed at step creation.',

  autonomyLevel:           'How much authority the agent has. L0 = human-only, L2 = human approves output, L4 = fully autonomous.',
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

  agentRuntime:            'Language runtime for the inline script: javascript, python, r, or bash.',
  agentCommand:            'Shell command to run in the container, typically to invoke a file from agent.repo.',
  agentImage:              'Docker base image for the container (e.g. python:3.11-slim).',
  agentDockerfile:         'Path to a Dockerfile in agent.repo. When set, the container is built from this file instead of agent.image.',
  agentRepo:               'Git repository URL to clone into the container before running the command.',
  agentCommit:             'Commit SHA or branch to check out from agent.repo. Defaults to the repo\'s default branch.',
  agentRepoAuth:           'Name of a workflow secret holding the auth token for cloning a private repository.',
  agentInlineScript:       'Script source code to run directly in the container. Set the language via agent.runtime.',

  allowedRoles:            'Roles that can claim this task, comma-separated. Leave empty to allow any signed-in user.',

  reviewType:              'Who performs the review: human (creates a task), agent (auto-evaluates), or none (skips review).',
  reviewPlugin:            'Plugin used when review.type is agent.',
  reviewMaxIterations:     'Maximum revision cycles before the review is auto-escalated. Prevents infinite feedback loops.',
  reviewTimeBoxDays:       'Calendar days before an unresolved review is automatically escalated.',
  selectionMin:            'Minimum number of reviewers required to reach a binding verdict.',
  selectionMax:            'Maximum number of reviewers who may participate in this review step.',

  actionKind:              'Action type: http (outbound API call), reshape (update workflow variables), or email. Fixed at creation.',
  actionMethod:            'HTTP method for the outbound request.',
  actionUrl:               'Target URL. Supports ${variables.field} and ${params.field} interpolation.',
  actionBody:              'JSON body sent with the request. Supports ${variables.field} interpolation.',
  actionValues:            'Key-value pairs to write into workflow variables. Values support ${variables.field} interpolation.',
  actionTo:                'Recipient email address(es), comma-separated.',
  actionCc:                'CC recipients, comma-separated.',
  actionBcc:               'BCC recipients, comma-separated. Not visible to other recipients.',
  actionFrom:              'Sender address. Must be an authorised SendGrid verified sender.',
  actionReplyTo:           'Reply-to address. Replies from recipients go here instead of action.from.',
  actionSubject:           'Email subject line. Supports ${variables.field} interpolation.',
  actionEmailBody:         'Plain-text email body. Displayed by clients that do not support HTML.',
  actionHtml:              'HTML email body. HTML-capable clients show this instead of the plain-text body.',

  verdictName:             'Verdict label (e.g. "approve", "reject"). Referenced in downstream transition conditions.',
  verdictTarget:           'The step to route to when this verdict is selected.',

  paramName:               'Identifier for this parameter. Reference it as ${params.name} in prompts and expressions.',
  paramType:               'Data type: string, number, boolean, or date. Controls validation and the input widget shown to users.',
  paramRequired:           'When checked, the workflow cannot start until this parameter is provided.',
  paramDescription:        'Hint text shown to users when filling in this parameter on the workflow start form.',
  paramDefault:            'Value used when the parameter is not explicitly provided at workflow start.',
  paramOptions:            'Fixed list of allowed values, comma-separated. Shown as a dropdown to users instead of a free-text input.',
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
  errors,
}: {
  step: WorkflowStep;
  allSteps: WorkflowStep[];
  workflowName?: string;
  onChange: (patch: Partial<WorkflowStep>) => void;
  errors?: Record<string, string>;
}) {
  const isNewStep = step.id.startsWith('new-step-');
  const { plugins } = usePlugins();
  const { firebaseUser } = useAuth();
  const { handle } = useParams<{ handle: string }>();
  const [secretKeys, setSecretKeys] = useState<string[]>([]);

  useEffect(() => {
    if (handle && workflowName && firebaseUser) {
      getWorkflowSecretKeys(handle, workflowName, firebaseUser.uid)
        .then(setSecretKeys)
        .catch((err) => console.error('Failed to load secret keys:', err));
    }
  }, [handle, workflowName, firebaseUser]);

  const otherSteps = allSteps.filter((s) => s.id !== step.id);
  const isAgent  = step.executor === 'agent'  && step.type !== 'terminal';
  const isHuman  = step.executor === 'human'  && step.type !== 'terminal';
  const isScript = step.executor === 'script' && step.type !== 'terminal';
  const isCowork = step.executor === 'cowork';
  const isAction = step.executor === 'action';
  const isReview = step.type === 'review';
  const isTerminal = step.type === 'terminal';

  const httpAction    = step.action?.kind === 'http'    ? step.action : undefined;
  const reshapeAction = step.action?.kind === 'reshape' ? step.action : undefined;
  const emailAction   = step.action?.kind === 'email'   ? step.action : undefined;

  const selMin = typeof step.selection === 'number' ? step.selection : step.selection?.min;
  const selMax = typeof step.selection === 'number' ? step.selection : step.selection?.max;

  function updateAgent(patch: Partial<NonNullable<WorkflowStep['agent']>>) {
    onChange({ agent: { ...step.agent, ...patch } });
  }
  function updateReview(patch: Partial<NonNullable<WorkflowStep['review']>>) {
    onChange({ review: { ...step.review, ...patch } });
  }
  function updateSelection(newMin: number | undefined, newMax: number | undefined) {
    if (newMin === undefined && newMax === undefined) { onChange({ selection: undefined }); return; }
    onChange({ selection: { min: newMin ?? 1, max: newMax ?? 1 } });
  }

  const execStyle = EXECUTOR_ICON[step.executor] ?? EXECUTOR_ICON.human;
  const ExecIcon = execStyle.icon;
  const typeStyle = STEP_TYPE_ICON[step.type] ?? STEP_TYPE_ICON.creation;
  const TypeIcon = typeStyle.icon;

  return (
    <div className="space-y-4" data-testid="step-editor">

      {/* ── Step type header ─────────────────────────────────────── */}
      <div className="flex items-center gap-3 pb-3 border-b border-border/40">
        <div className={cn('flex items-center justify-center h-9 w-9 rounded-lg shrink-0', execStyle.bg)}>
          <ExecIcon className={cn('h-5 w-5', execStyle.color)} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight truncate">{step.name || 'Unnamed step'}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <TypeIcon className={cn('h-3 w-3 shrink-0', typeStyle.color)} strokeWidth={1.5} />
            <span className="text-[10px] text-muted-foreground">{typeStyle.label}</span>
            <span className="text-[10px] text-muted-foreground/30">·</span>
            <span className="text-[10px] text-muted-foreground">{execStyle.label}</span>
          </div>
        </div>
      </div>

      {/* ── Identity ─────────────────────────────────────────────── */}
      <FieldGroup>
        <FieldRow label="name" tooltip={TIP.name} error={errors?.name ? friendlyFieldError(errors.name) : undefined}>
          <input
            value={step.name}
            onChange={(e) => {
              const patch: Partial<WorkflowStep> = { name: e.target.value };
              if (isNewStep) patch.id = toSlug(e.target.value) || step.id;
              onChange(patch);
            }}
            className={cn(ri, errors?.name && 'border-red-400 focus:border-red-500')}
          />
        </FieldRow>

        <FieldRow label="id" tooltip={TIP.id} error={errors?.id ? friendlyFieldError(errors.id) : undefined}>
          <StepIdField currentId={step.id} onChange={(v) => onChange({ id: v })} error={errors?.id} />
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

        <FieldRow label="type" tooltip={TIP.type}>
          <span
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground py-0.5"
            title="Step type is set at creation. To change, remove this step and add a new one."
          >
            <Lock className="h-3 w-3 text-muted-foreground/30 shrink-0" />
            {STEP_TYPE_LABELS[step.type] ?? step.type}
          </span>
        </FieldRow>

        <FieldRow label="executor" tooltip={TIP.executor}>
          <span
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground py-0.5"
            title="Executor is set at creation. To change, remove this step and add a new one."
          >
            <Lock className="h-3 w-3 text-muted-foreground/30 shrink-0" />
            {step.executor}
          </span>
        </FieldRow>
      </FieldGroup>

      {/* ── Agent config ─────────────────────────────────────────── */}
      {isAgent && (
        <FieldGroup>
          <FieldRow label="autonomyLevel" tooltip={TIP.autonomyLevel}>
            <select
              value={step.autonomyLevel ?? ''}
              onChange={(e) => onChange({ autonomyLevel: (e.target.value || undefined) as WorkflowStep['autonomyLevel'] })}
              className={rs}
            >
              <option value="">Default</option>
              {AUTONOMY_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </FieldRow>

          <FieldRow label="plugin" tooltip={TIP.plugin}>
            <select
              value={step.plugin ?? ''}
              onChange={(e) => onChange({ plugin: e.target.value || undefined })}
              className={rs}
            >
              <option value="">None</option>
              {plugins.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
              {step.plugin && !plugins.some((p) => p.name === step.plugin) && (
                <option value={step.plugin}>{step.plugin}</option>
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
            <select
              value={step.agent?.model ?? ''}
              onChange={(e) => updateAgent({ model: e.target.value || undefined })}
              className={rs}
            >
              {KNOWN_MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              {step.agent?.model && !KNOWN_MODELS.some((m) => m.value === step.agent?.model) && (
                <option value={step.agent.model}>{step.agent.model}</option>
              )}
            </select>
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
      )}

      {/* ── Script config ────────────────────────────────────────── */}
      {isScript && (
        <FieldGroup>
          <FieldRow label="plugin" tooltip={TIP.pluginScript}>
            <input
              value={step.plugin ?? ''}
              onChange={(e) => onChange({ plugin: e.target.value || undefined })}
              className={riMono}
            />
          </FieldRow>

          <FieldRow label="agent.runtime" tooltip={TIP.agentRuntime}>
            <select
              value={step.agent?.runtime ?? ''}
              onChange={(e) => updateAgent({ runtime: (e.target.value || undefined) as 'javascript' | 'python' | 'r' | 'bash' | undefined })}
              className={rs}
            >
              {RUNTIME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </FieldRow>

          <FieldRow label="agent.command" tooltip={TIP.agentCommand}>
            <input
              value={step.agent?.command ?? ''}
              onChange={(e) => updateAgent({ command: e.target.value || undefined })}
              className={riMono}
            />
          </FieldRow>

          <FieldRow label="agent.image" tooltip={TIP.agentImage}>
            <input
              value={step.agent?.image ?? ''}
              onChange={(e) => updateAgent({ image: e.target.value || undefined })}
              className={riMono}
            />
          </FieldRow>

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

          <FieldRow label="agent.inlineScript" tooltip={TIP.agentInlineScript} alignStart>
            <textarea
              value={step.agent?.inlineScript ?? ''}
              onChange={(e) => updateAgent({ inlineScript: e.target.value || undefined })}
              rows={3}
              placeholder="Script code…"
              className={cn(rt, 'font-mono text-[11px] placeholder:italic placeholder:text-muted-foreground/40')}
            />
          </FieldRow>
        </FieldGroup>
      )}

      {/* ── Human config ─────────────────────────────────────────── */}
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
        </FieldGroup>
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
              <option value="human">human</option>
              <option value="agent">agent</option>
              <option value="none">none</option>
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
              {step.action?.kind ?? '—'}
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
                  <div key={idx} className="grid grid-cols-[184px_1fr] gap-x-3 px-3 py-1.5 border-b border-border/30 last:border-0 items-center">
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

      {/* ── Verdicts ─────────────────────────────────────────────── */}
      {isReview && (
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
      )}

      {/* ── Parameters ───────────────────────────────────────────── */}
      {!isTerminal && (
        <Section title="Parameters">
          <div className="space-y-2">
            {(step.params ?? []).map((param, idx) => (
              <FieldGroup key={idx}>
                <FieldRow label="name" tooltip={TIP.paramName}>
                  <div className="flex items-center gap-2">
                    <input
                      value={param.name}
                      onChange={(e) => {
                        const next = [...(step.params ?? [])];
                        next[idx] = { ...next[idx], name: e.target.value };
                        onChange({ params: next });
                      }}
                      className={cn(riMono, 'flex-1')}
                    />
                    <button
                      onClick={() => {
                        const next = (step.params ?? []).filter((_, i) => i !== idx);
                        onChange({ params: next.length > 0 ? next : undefined });
                      }}
                      className="text-[10px] text-muted-foreground/30 hover:text-red-500 transition-colors shrink-0"
                    >×</button>
                  </div>
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
                      <option key={t} value={t}>{t}</option>
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
            ))}
          </div>
          <button
            onClick={() => onChange({ params: [...(step.params ?? []), { name: '', type: 'string', required: false }] })}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >+ Add parameter</button>
        </Section>
      )}

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
              <div key={idx} className="grid grid-cols-[184px_1fr] gap-x-3 px-3 py-1.5 border-b border-border/30 last:border-0 items-center">
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

    </div>
  );
}
