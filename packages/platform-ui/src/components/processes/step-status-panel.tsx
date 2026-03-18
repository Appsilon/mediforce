'use client';

import * as React from 'react';
import Link from 'next/link';
import { CheckCircle2, Clock, XCircle, Circle, Pause, User, Bot, Cog, ChevronDown, ChevronRight, FileText } from 'lucide-react';
import type { ProcessInstance, StepExecution, Step } from '@mediforce/platform-core';
import { AutonomyBadge } from '../agents/autonomy-badge';
import { cn } from '@/lib/utils';

interface AgentEventItem {
  id: string;
  stepId: string;
  type: string;
  payload: unknown;
  sequence: number;
  timestamp?: string;
}

interface ProgressPayload {
  current: number;
  total: number;
  label?: string;
}

interface StepConfigInfo {
  executorType?: string;
  autonomyLevel?: string;
  plugin?: string;
  model?: string;
  confidenceThreshold?: number;
  fallbackBehavior?: string;
  timeoutMinutes?: number;
  reviewerType?: string;
  agentConfig?: { skill?: string; prompt?: string; model?: string; skillsDir?: string };
}

interface StepStatusPanelProps {
  instance: ProcessInstance;
  definitionSteps: Step[];
  stepExecutions: StepExecution[];
  agentEvents?: AgentEventItem[];
  onStepClick?: (stepId: string) => void;
  stepConfigMap?: Map<string, StepConfigInfo>;
  onAgentLogClick?: (stepId: string) => void;
  /** Base href for step detail links, e.g. "/workflows/foo/runs/abc". Steps link to `{base}/steps/{stepId}`. */
  stepDetailBaseHref?: string;
}

type EffectiveStatus = 'pending' | 'running' | 'completed' | 'failed' | 'waiting';

function getEffectiveStatus(
  step: Step,
  instance: ProcessInstance,
  stepExecutions: StepExecution[],
): EffectiveStatus {
  // Find the latest execution for this step (by startedAt if multiple)
  const execs = stepExecutions
    .filter((e) => e.stepId === step.id)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

  const exec = execs[0];

  if (exec) {
    if (exec.status === 'running' || exec.status === 'pending') {
      // If instance is paused on this step, show 'waiting' instead of 'running'
      // (e.g. L3 agent step paused for human review — execution record stays 'running')
      if (
        instance.currentStepId === step.id
        && instance.status === 'paused'
        && (instance.pauseReason === 'waiting_for_human' || instance.pauseReason === 'awaiting_agent_approval')
      ) {
        return 'waiting';
      }
      return 'running';
    }
    if (exec.status === 'completed') return 'completed';
    if (exec.status === 'failed') return 'failed';
  }

  // No execution record yet — derive from instance state
  if (instance.currentStepId === step.id) {
    if (instance.status === 'paused' && (
      instance.pauseReason === 'waiting_for_human'
      || instance.pauseReason === 'awaiting_agent_approval'
    )) {
      return 'waiting';
    }
    if (instance.status === 'running') {
      return 'running';
    }
  }

  return 'pending';
}

function StatusIcon({ status }: { status: EffectiveStatus }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
    case 'running':
      return <Clock className="h-4 w-4 text-blue-500 animate-spin shrink-0" />;
    case 'failed':
      return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
    case 'waiting':
      return <Pause className="h-4 w-4 text-amber-500 shrink-0" />;
    case 'pending':
    default:
      return <Circle className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
}

function StatusLabel({ status }: { status: EffectiveStatus }) {
  const styles: Record<EffectiveStatus, string> = {
    completed: 'text-green-700 dark:text-green-300',
    running: 'text-blue-700 dark:text-blue-300',
    failed: 'text-red-700 dark:text-red-300',
    waiting: 'text-amber-700 dark:text-amber-300',
    pending: 'text-muted-foreground',
  };
  const labels: Record<EffectiveStatus, string> = {
    completed: 'Completed',
    running: 'Running',
    failed: 'Failed',
    waiting: 'Waiting',
    pending: 'Pending',
  };
  return (
    <span className={cn('text-xs', styles[status])}>
      {labels[status]}
    </span>
  );
}

function TypeBadge({ type, executorType }: { type: Step['type']; executorType?: string }) {
  // Show executor identity badge based on config executorType
  if (executorType === 'agent') {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 rounded-full px-1.5 py-0.5">
        <Bot className="h-3 w-3" />
        agent
      </span>
    );
  }
  if (executorType === 'human') {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 rounded-full px-1.5 py-0.5">
        <User className="h-3 w-3" />
        human
      </span>
    );
  }
  // Fallback: show the behavioral step type
  if (type === 'review') {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 rounded-full px-1.5 py-0.5">
        <User className="h-3 w-3" />
        review
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-xs bg-muted text-muted-foreground rounded-full px-1.5 py-0.5">
      <Cog className="h-3 w-3" />
      {type}
    </span>
  );
}

function StepProgress({ stepId, agentEvents }: { stepId: string; agentEvents: AgentEventItem[] }) {
  const stepEvents = agentEvents
    .filter((e) => e.stepId === stepId)
    .sort((a, b) => a.sequence - b.sequence);

  // Latest status message (plain text) — filter out internal log paths
  const statusEvents = stepEvents.filter(
    (e) => e.type === 'status' && !String(e.payload).startsWith('agent activity log:'),
  );
  const latestStatus = statusEvents.length > 0
    ? String((statusEvents[statusEvents.length - 1] as AgentEventItem).payload)
    : null;

  // Latest progress bar (current/total)
  const progressEvents = stepEvents.filter((e) => e.type === 'progress');
  const latestProgress = progressEvents.length > 0
    ? (progressEvents[progressEvents.length - 1] as AgentEventItem & { payload: ProgressPayload }).payload as ProgressPayload
    : null;

  if (!latestStatus && !latestProgress) return null;

  const pct = latestProgress && latestProgress.total > 0
    ? Math.round((latestProgress.current / latestProgress.total) * 100)
    : 0;

  return (
    <div className="mt-1.5 space-y-1">
      {latestStatus && (
        <p className="text-xs text-muted-foreground">{latestStatus}</p>
      )}
      {latestProgress && (
        <>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{latestProgress.label ? `${latestProgress.label}` : `${latestProgress.current} of ${latestProgress.total}`}</span>
            <span>{latestProgress.current}/{latestProgress.total} · {pct}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </>
      )}
    </div>
  );
}

function StepConfigDetail({
  stepId,
  config,
  hasAgentLog,
  onAgentLogClick,
  assembledPrompt,
}: {
  stepId: string;
  config: StepConfigInfo;
  hasAgentLog: boolean;
  onAgentLogClick?: (stepId: string) => void;
  assembledPrompt?: string;
}) {
  const entries: Array<{ label: string; value: string }> = [];

  if (config.plugin) entries.push({ label: 'Plugin', value: config.plugin });
  const model = config.agentConfig?.model ?? config.model;
  if (model) entries.push({ label: 'Model', value: model });
  if (config.agentConfig?.skill) entries.push({ label: 'Skill', value: config.agentConfig.skill });
  if (config.confidenceThreshold !== undefined) entries.push({ label: 'Confidence threshold', value: `${config.confidenceThreshold}` });
  if (config.fallbackBehavior) entries.push({ label: 'Fallback', value: config.fallbackBehavior.replace(/_/g, ' ') });
  if (config.timeoutMinutes) entries.push({ label: 'Timeout', value: `${config.timeoutMinutes} min` });
  if (config.reviewerType && config.reviewerType !== 'none') entries.push({ label: 'Reviewer', value: config.reviewerType });

  if (entries.length === 0 && !assembledPrompt && !config.agentConfig?.prompt && !hasAgentLog) return null;

  return (
    <div className="mt-2 rounded-md bg-muted/50 border px-3 py-2 space-y-2" onClick={(e) => e.stopPropagation()}>
      {entries.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {entries.map(({ label, value }) => (
            <React.Fragment key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-mono">{value}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
      {assembledPrompt && (
        <details className="text-xs">
          <summary className="text-muted-foreground cursor-pointer hover:text-foreground font-medium">
            View Full Prompt
          </summary>
          <pre className="mt-1 rounded bg-muted p-2 whitespace-pre-wrap break-words max-h-96 overflow-auto text-xs leading-relaxed">
            {assembledPrompt}
          </pre>
        </details>
      )}
      {!assembledPrompt && config.agentConfig?.prompt && (
        <details className="text-xs">
          <summary className="text-muted-foreground cursor-pointer hover:text-foreground">
            Prompt
          </summary>
          <pre className="mt-1 rounded bg-muted p-2 whitespace-pre-wrap break-words max-h-40 overflow-auto text-xs">
            {config.agentConfig.prompt}
          </pre>
        </details>
      )}
      {hasAgentLog && onAgentLogClick && (
        <button
          onClick={() => onAgentLogClick(stepId)}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <FileText className="h-3 w-3" />
          View Agent Log
        </button>
      )}
    </div>
  );
}

/** Resolve a step ID to its name from the definition steps list. */
function resolveStepName(stepId: string, allSteps: Step[]): string {
  const found = allSteps.find((s) => s.id === stepId);
  return found ? found.name : stepId;
}

/** Get the left border class based on effective status (Notion-style accent). */
function getLeftBorderClass(status: EffectiveStatus): string {
  switch (status) {
    case 'running':
      return 'border-l-4 border-blue-500';
    case 'waiting':
      return 'border-l-4 border-amber-500';
    default:
      return 'border-l-4 border-transparent';
  }
}

export function StepStatusPanel({
  instance,
  definitionSteps,
  stepExecutions,
  agentEvents = [],
  onStepClick,
  stepConfigMap,
  onAgentLogClick,
  stepDetailBaseHref,
}: StepStatusPanelProps) {
  const [expandedStepId, setExpandedStepId] = React.useState<string | null>(null);

  // Filter out terminal steps — they aren't meaningful to display
  const visibleSteps = definitionSteps.filter((s) => s.type !== 'terminal');

  if (visibleSteps.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-1">
      <h3 className="text-sm font-medium mb-3">Step Status</h3>
      <ol>
        {visibleSteps.map((step, i) => {
          const status = getEffectiveStatus(step, instance, stepExecutions);
          const isLast = i === visibleSteps.length - 1;

          // Revisit counter: how many executions exist for this step
          const execCount = stepExecutions.filter((e) => e.stepId === step.id).length;

          // Verdict branches for steps with verdicts (review steps)
          const verdicts = step.verdicts;
          const hasVerdicts = verdicts && Object.keys(verdicts).length > 0;

          // Find the taken verdict for this step (from completed executions)
          const takenVerdict = stepExecutions.find(
            (e) => e.stepId === step.id && e.status === 'completed' && e.verdict,
          )?.verdict;

          const stepConfig = stepConfigMap?.get(step.id);
          const isExpanded = expandedStepId === step.id;
          const hasConfig = stepConfig && stepConfig.executorType === 'agent';
          const hasAgentLog = agentEvents.some(
            (e) => e.stepId === step.id && e.type === 'status' && String(e.payload).startsWith('agent activity log:'),
          );
          const promptEvent = agentEvents.find(
            (e) => e.stepId === step.id && e.type === 'prompt',
          );
          const assembledPrompt = promptEvent ? String(promptEvent.payload) : undefined;

          return (
            <li
              key={step.id}
              className={cn(
                'flex gap-3 py-2 pl-3 rounded-md transition-colors',
                getLeftBorderClass(status),
                status === 'completed' && 'opacity-60 hover:opacity-100 transition-opacity',
                'hover:bg-muted/50',
                'cursor-pointer',
              )}
              onClick={() => {
                if (hasConfig) {
                  setExpandedStepId(isExpanded ? null : step.id);
                } else if (onStepClick) {
                  onStepClick(step.id);
                }
              }}
            >
              {/* Icon + connector line */}
              <div className="flex flex-col items-center">
                <div className="mt-0.5">
                  <StatusIcon status={status} />
                </div>
                {!isLast && <div className="mt-1 w-px flex-1 bg-border min-h-[16px]" />}
              </div>

              {/* Step info */}
              <div className="pb-1 min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {stepDetailBaseHref && status !== 'pending' ? (
                    <Link
                      href={`${stepDetailBaseHref}/steps/${encodeURIComponent(step.id)}`}
                      className="text-sm font-medium text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {step.name}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium">{step.name}</span>
                  )}
                  {execCount > 1 && (
                    <span className="text-xs text-muted-foreground ml-1">
                      x{execCount}
                    </span>
                  )}
                  <TypeBadge type={step.type} executorType={stepConfigMap?.get(step.id)?.executorType} />
                  {stepConfigMap?.get(step.id)?.executorType === 'agent' && stepConfigMap?.get(step.id)?.autonomyLevel && (
                    <AutonomyBadge level={stepConfigMap.get(step.id)!.autonomyLevel!} />
                  )}
                  <StatusLabel status={status} />
                  {hasConfig && (
                    isExpanded
                      ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </div>
                <div className="text-xs font-mono text-muted-foreground mt-0.5">{step.id}</div>
                {status === 'running' && stepConfigMap?.get(step.id)?.executorType === 'agent' && (
                  <StepProgress stepId={step.id} agentEvents={agentEvents} />
                )}

                {/* Verdict branch sub-list */}
                {hasVerdicts && (
                  <div className="ml-4 mt-1.5 space-y-0.5">
                    {Object.entries(verdicts).map(([verdictName, verdictDef]) => {
                      const isTaken = takenVerdict === verdictName;
                      const targetName = resolveStepName(verdictDef.target, definitionSteps);
                      return (
                        <div
                          key={verdictName}
                          className={cn(
                            'text-xs flex items-center gap-1',
                            isTaken
                              ? 'font-medium text-blue-600 dark:text-blue-400'
                              : 'text-muted-foreground',
                          )}
                        >
                          <span>{verdictName}</span>
                          <span aria-hidden="true">{'\u2192'}</span>
                          <span>{targetName}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Expandable step config detail */}
                {isExpanded && stepConfig && (
                  <StepConfigDetail
                    stepId={step.id}
                    config={stepConfig}
                    hasAgentLog={hasAgentLog}
                    onAgentLogClick={onAgentLogClick}
                    assembledPrompt={assembledPrompt}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
