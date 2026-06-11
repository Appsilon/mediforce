'use client';

import * as React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { CheckCircle2, Clock, XCircle, Circle, Pause, User, Bot, Cog, ChevronDown, ChevronRight, FileText, FileCode, Paperclip, RotateCcw } from 'lucide-react';
import type { ProcessInstance, StepExecution, Step, HumanTask } from '@mediforce/platform-core';
import type { RunOutputFileEntry } from '@mediforce/platform-api/contract';
import { AutonomyBadge } from '../agents/autonomy-badge';
import { RetryStepButton } from './retry-step-button';
import { OutputFileRow } from './run-output-files-panel';
import { cn } from '@/lib/utils';
import { getWorkflowStatus } from '@/lib/workflow-status';
import { formatDuration, formatCostUsd } from '@/lib/format';
import { useUserDisplayNames } from '@/hooks/use-users';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';

const SYSTEM_ACTOR_IDS = new Set(['auto-runner', 'api-user', 'system']);

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
  agentConfig?: { skill?: string; prompt?: string; model?: string; skillsDir?: string; runtime?: string; mcpServers?: Array<{ name: string }> };
}

interface StepStatusPanelProps {
  instance: ProcessInstance;
  definitionSteps: Step[];
  stepExecutions: StepExecution[];
  agentEvents?: AgentEventItem[];
  stepConfigMap?: Map<string, StepConfigInfo>;
  outputFiles?: RunOutputFileEntry[];
  onAgentLogClick?: (stepId: string) => void;
  stepDetailBaseHref?: string;
  /** Active human task for the current step — provides createdAt and assignedUserId for virtual rows. */
  currentTask?: HumanTask | null;
}

/** One entry in the execution history. */
type HistoryItem =
  | {
      kind: 'executed';
      /** First attempt of this visit (iterationNumber === 0). */
      anchor: StepExecution;
      /** Subsequent retries within this visit (iterationNumber > 0). */
      retries: StepExecution[];
      /** Most recent execution in this visit — the one whose metadata we display. */
      latestExec: StepExecution;
      step: Step | null;
      isCurrent: boolean;
    }
  | {
      /** Current step that has no execution record yet (run just started). */
      kind: 'virtual';
      stepId: string;
      step: Step | null;
    };

const ACTIVE_STATUSES = new Set<string>(['running', 'pending', 'paused', 'escalated']);

function buildHistory(
  stepExecutions: StepExecution[],
  instance: ProcessInstance,
  definitionSteps: Step[],
): HistoryItem[] {
  // Chronological order — anchors (iterationNumber===0) establish visit order.
  const sorted = [...stepExecutions].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
  );

  const anchors = sorted.filter((e) => e.iterationNumber === 0);

  const items: HistoryItem[] = anchors.map((anchor, idx) => {
    // Retries belong to this visit if they come after the anchor but before
    // the next anchor for the same stepId (which would be a new loop visit).
    const nextSameStep = anchors.slice(idx + 1).find((a) => a.stepId === anchor.stepId);
    const retries = sorted.filter(
      (e) =>
        e.stepId === anchor.stepId &&
        e.iterationNumber > 0 &&
        new Date(e.startedAt) > new Date(anchor.startedAt) &&
        (nextSameStep === undefined ||
          new Date(e.startedAt) < new Date(nextSameStep.startedAt)),
    );

    const latestExec = retries.length > 0 ? retries[retries.length - 1]! : anchor;
    const step = definitionSteps.find((s) => s.id === anchor.stepId) ?? null;
    const isCurrent =
      anchor.stepId === instance.currentStepId && ACTIVE_STATUSES.has(latestExec.status);

    return { kind: 'executed', anchor, retries, latestExec, step, isCurrent };
  });

  // If the current step has no execution record yet (run just started or
  // engine dispatched it but didn't persist an exec yet), add a virtual row.
  const isTerminal = instance.status === 'completed' || instance.status === 'failed';
  const hasCurrentRow = items.some((i) => i.kind === 'executed' && i.isCurrent);
  if (instance.currentStepId && !isTerminal && !hasCurrentRow) {
    const step = definitionSteps.find((s) => s.id === instance.currentStepId) ?? null;
    items.push({ kind: 'virtual', stepId: instance.currentStepId, step });
  }

  return items;
}

type EffectiveStatus = 'pending' | 'running' | 'completed' | 'failed' | 'waiting';

function getExecEffectiveStatus(exec: StepExecution, instance: ProcessInstance): EffectiveStatus {
  if (exec.status === 'completed') return 'completed';
  if (exec.status === 'failed') return 'failed';
  if (exec.status === 'running' || exec.status === 'pending') {
    if (
      instance.currentStepId === exec.stepId &&
      getWorkflowStatus(instance).displayStatus === 'waiting_for_human'
    ) return 'waiting';
    return 'running';
  }
  if (exec.status === 'escalated' || exec.status === 'paused') return 'waiting';
  return 'running';
}

function getVirtualEffectiveStatus(instance: ProcessInstance): EffectiveStatus {
  if (getWorkflowStatus(instance).displayStatus === 'waiting_for_human') return 'waiting';
  return 'running';
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
  return <span className={cn('text-xs', styles[status])}>{labels[status]}</span>;
}

function TypeBadge({ type, executorType }: { type: Step['type']; executorType?: string }) {
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

function formatRuntime(runtime: string): string {
  return `${runtime.charAt(0).toUpperCase()}${runtime.slice(1)} script`;
}

function ExecutedBy({ executedBy, executorType, plugin, autonomyLevel, runtime }: {
  executedBy: string;
  executorType?: string;
  plugin?: string;
  autonomyLevel?: string;
  runtime?: string;
}) {
  const userNames = useUserDisplayNames(useHandleFromPath());
  if (executorType === 'agent') {
    const agentLabel = plugin ? `agent:${plugin}` : 'Agent unknown';
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Bot className="h-3 w-3 shrink-0" />
        <span>{agentLabel}</span>
        {autonomyLevel && <AutonomyBadge level={autonomyLevel} />}
      </span>
    );
  }
  if (executorType === 'script') {
    const label = runtime ? formatRuntime(runtime) : 'Script';
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <FileCode className="h-3 w-3 shrink-0" />
        {label}
      </span>
    );
  }
  if (SYSTEM_ACTOR_IDS.has(executedBy)) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Cog className="h-3 w-3 shrink-0" />
        System
      </span>
    );
  }
  const displayName = userNames.get(executedBy) ?? executedBy ?? 'Unknown user';
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <User className="h-3 w-3 shrink-0" />
      {displayName}
    </span>
  );
}

function StepProgress({ stepId, agentEvents }: { stepId: string; agentEvents: AgentEventItem[] }) {
  const stepEvents = agentEvents
    .filter((e) => e.stepId === stepId)
    .sort((a, b) => a.sequence - b.sequence);

  const statusEvents = stepEvents.filter(
    (e) => e.type === 'status' && !String(e.payload).startsWith('agent activity log:'),
  );
  const latestStatus = statusEvents.length > 0
    ? String(statusEvents[statusEvents.length - 1]!.payload)
    : null;

  const progressEvents = stepEvents.filter((e) => e.type === 'progress');
  const latestProgress = progressEvents.length > 0
    ? (progressEvents[progressEvents.length - 1] as AgentEventItem & { payload: ProgressPayload }).payload
    : null;

  if (!latestStatus && !latestProgress) return null;

  const pct = latestProgress && latestProgress.total > 0
    ? Math.round((latestProgress.current / latestProgress.total) * 100)
    : 0;

  return (
    <div className="mt-1.5 space-y-1">
      {latestStatus && <p className="text-xs text-muted-foreground">{latestStatus}</p>}
      {latestProgress && (
        <>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{latestProgress.label ?? `${latestProgress.current} of ${latestProgress.total}`}</span>
            <span>{latestProgress.current}/{latestProgress.total} · {pct}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-blue-500 transition-all duration-500" style={{ width: `${pct}%` }} />
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
  if (config.executorType !== 'script') {
    const model = config.agentConfig?.model ?? config.model;
    if (model) entries.push({ label: 'Model', value: model });
  }
  if (config.agentConfig?.skill) entries.push({ label: 'Skill', value: config.agentConfig.skill });
  if (config.executorType !== 'script' && config.confidenceThreshold !== undefined)
    entries.push({ label: 'Confidence threshold', value: `${config.confidenceThreshold}` });
  if (config.fallbackBehavior) entries.push({ label: 'Fallback', value: config.fallbackBehavior.replace(/_/g, ' ') });
  if (config.timeoutMinutes) entries.push({ label: 'Timeout', value: `${config.timeoutMinutes} min` });
  if (config.reviewerType && config.reviewerType !== 'none') entries.push({ label: 'Reviewer', value: config.reviewerType });
  if (config.agentConfig?.mcpServers?.length)
    entries.push({ label: 'MCP Tools', value: config.agentConfig.mcpServers.map((s) => s.name).join(', ') });

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
          <summary className="text-muted-foreground cursor-pointer hover:text-foreground font-medium">View Full Prompt</summary>
          <pre className="mt-1 rounded bg-muted p-2 whitespace-pre-wrap break-words max-h-96 overflow-auto text-xs leading-relaxed">{assembledPrompt}</pre>
        </details>
      )}
      {!assembledPrompt && config.agentConfig?.prompt && (
        <details className="text-xs">
          <summary className="text-muted-foreground cursor-pointer hover:text-foreground">Prompt</summary>
          <pre className="mt-1 rounded bg-muted p-2 whitespace-pre-wrap break-words max-h-40 overflow-auto text-xs">{config.agentConfig.prompt}</pre>
        </details>
      )}
      {hasAgentLog && onAgentLogClick && (
        <button onClick={() => onAgentLogClick(stepId)} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
          <FileText className="h-3 w-3" />
          View Agent Log
        </button>
      )}
    </div>
  );
}

function ElapsedTimer({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = React.useState(() => Date.now() - new Date(startedAt).getTime());

  React.useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - new Date(startedAt).getTime()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const totalSeconds = Math.floor(elapsed / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  let label: string;
  if (days > 0) label = `${days}d ${hours}h`;
  else if (hours > 0) label = `${hours}h ${minutes}m`;
  else if (minutes > 0) label = `${minutes}m ${seconds}s`;
  else label = `${seconds}s`;

  return <span className="tabular-nums">{label}</span>;
}

function getLeftBorderClass(status: EffectiveStatus): string {
  switch (status) {
    case 'running': return 'border-l-4 border-blue-500';
    case 'waiting': return 'border-l-4 border-amber-500';
    default: return 'border-l-4 border-transparent';
  }
}

export function StepStatusPanel({
  instance,
  definitionSteps,
  stepExecutions,
  agentEvents = [],
  stepConfigMap,
  outputFiles = [],
  onAgentLogClick,
  stepDetailBaseHref,
  currentTask,
}: StepStatusPanelProps) {
  // Key expanded state by execution ID so loop revisits of the same step each
  // have independent expand/collapse.
  const [expandedExecId, setExpandedExecId] = React.useState<string | null>(null);
  const [filesExpandedExecId, setFilesExpandedExecId] = React.useState<string | null>(null);
  const wfStatus = getWorkflowStatus(instance);

  const outputFilesByStep = React.useMemo(() => {
    const map = new Map<string, RunOutputFileEntry[]>();
    for (const file of outputFiles) {
      const existing = map.get(file.stepId);
      if (existing) existing.push(file);
      else map.set(file.stepId, [file]);
    }
    return map;
  }, [outputFiles]);

  const history = React.useMemo(
    () => buildHistory(stepExecutions, instance, definitionSteps),
    [stepExecutions, instance, definitionSteps],
  );

  if (history.length === 0) return null;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-1">
      <h3 className="text-sm font-medium mb-3">Execution History</h3>
      <ol>
        {history.map((item, i) => {
          const isLast = i === history.length - 1;

          if (item.kind === 'virtual') {
            const status = getVirtualEffectiveStatus(instance);
            return (
              <li key={`virtual-${item.stepId}`} className={cn('flex gap-3 py-2 pl-3 rounded-md', getLeftBorderClass(status))}>
                <div className="flex flex-col items-center">
                  <div className="mt-0.5"><StatusIcon status={status} /></div>
                  {!isLast && <div className="mt-1 w-px flex-1 bg-border min-h-[16px]" />}
                </div>
                <div className="pb-1 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{item.step?.name ?? item.stepId}</span>
                    {item.step && <TypeBadge type={item.step.type} executorType={stepConfigMap?.get(item.stepId)?.executorType} />}
                    <StatusLabel status={status} />
                    {wfStatus.isRetryable && instance.currentStepId === item.stepId && (
                      <RetryStepButton instanceId={instance.id} stepId={item.stepId} />
                    )}
                  </div>
                  {(() => {
                    const taskForStep = currentTask?.stepId === item.stepId ? currentTask : undefined;
                    const cfg = stepConfigMap?.get(item.stepId);
                    return (
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {taskForStep && (
                          <>
                            <span className="text-xs text-muted-foreground">
                              <span className="text-muted-foreground/60 mr-1">Started</span>
                              {format(new Date(taskForStep.createdAt), 'MMM d, HH:mm')}
                            </span>
                            <span className="text-muted-foreground/40">·</span>
                            <span className="text-xs text-muted-foreground">
                              <ElapsedTimer startedAt={taskForStep.createdAt} />
                            </span>
                            <span className="text-muted-foreground/40">·</span>
                          </>
                        )}
                        {taskForStep?.assignedUserId ? (
                          <ExecutedBy
                            executedBy={taskForStep.assignedUserId}
                            executorType={cfg?.executorType}
                            plugin={cfg?.plugin}
                            autonomyLevel={cfg?.autonomyLevel}
                            runtime={cfg?.agentConfig?.runtime}
                          />
                        ) : cfg?.executorType === 'agent' ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Bot className="h-3 w-3 shrink-0" />
                            {cfg.plugin ? `agent:${cfg.plugin}` : 'Agent'}
                            {cfg.autonomyLevel && <AutonomyBadge level={cfg.autonomyLevel} />}
                          </span>
                        ) : cfg?.executorType === 'script' ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <FileCode className="h-3 w-3 shrink-0" />
                            {cfg.agentConfig?.runtime ? formatRuntime(cfg.agentConfig.runtime) : 'Script'}
                          </span>
                        ) : cfg ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <User className="h-3 w-3 shrink-0" />
                            Human
                          </span>
                        ) : null}
                      </div>
                    );
                  })()}
                </div>
              </li>
            );
          }

          const { anchor, retries, latestExec, step, isCurrent } = item;
          const execId = anchor.id;
          const stepId = anchor.stepId;
          const status = getExecEffectiveStatus(latestExec, instance);
          const stepConfig = stepConfigMap?.get(stepId);
          const hasConfig = stepConfig?.executorType === 'agent';
          const isExpanded = expandedExecId === execId;
          const isFilesExpanded = filesExpandedExecId === execId;
          const stepOutputFiles = outputFilesByStep.get(stepId) ?? [];
          const hasAgentLog = agentEvents.some(
            (e) => e.stepId === stepId && e.type === 'status' && String(e.payload).startsWith('agent activity log:'),
          );
          const promptEvent = agentEvents.find((e) => e.stepId === stepId && e.type === 'prompt');
          const assembledPrompt = promptEvent ? String(promptEvent.payload) : undefined;

          // For review steps: show the verdict that was actually taken.
          const verdicts = step?.verdicts;
          const takenVerdict = latestExec.verdict;
          const takenVerdictTarget = takenVerdict && verdicts
            ? Object.entries(verdicts).find(([k]) => k === takenVerdict)?.[1]?.target
            : undefined;
          const takenVerdictTargetName = takenVerdictTarget
            ? (definitionSteps.find((s) => s.id === takenVerdictTarget)?.name ?? takenVerdictTarget)
            : undefined;

          return (
            <li
              key={execId}
              className={cn(
                'flex gap-3 py-2 pl-3 rounded-md transition-colors',
                getLeftBorderClass(status),
                status === 'completed' && !isCurrent && 'opacity-60 hover:opacity-100 transition-opacity',
                'hover:bg-muted/50',
                hasConfig && 'cursor-pointer',
              )}
              onClick={() => {
                if (hasConfig) setExpandedExecId(isExpanded ? null : execId);
              }}
            >
              <div className="flex flex-col items-center">
                <div className="mt-0.5"><StatusIcon status={status} /></div>
                {!isLast && <div className="mt-1 w-px flex-1 bg-border min-h-[16px]" />}
              </div>

              <div className="pb-1 min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {stepDetailBaseHref && status !== 'pending' ? (
                    <Link
                      href={`${stepDetailBaseHref}/steps/${encodeURIComponent(stepId)}`}
                      className="text-sm font-medium text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {step?.name ?? stepId}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium">{step?.name ?? stepId}</span>
                  )}
                  {step && (
                    <TypeBadge
                      type={step.type}
                      executorType={stepConfig?.executorType}
                    />
                  )}
                  {stepConfig?.executorType === 'agent' && stepConfig.autonomyLevel && (
                    <AutonomyBadge level={stepConfig.autonomyLevel} />
                  )}
                  {retries.length > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 rounded-full px-1.5 py-0.5">
                      <RotateCcw className="h-3 w-3" />
                      Retried ×{retries.length}
                    </span>
                  )}
                  <StatusLabel status={status} />
                  {stepOutputFiles.length > 0 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setFilesExpandedExecId(isFilesExpanded ? null : execId);
                      }}
                      title={`${stepOutputFiles.length} output file${stepOutputFiles.length === 1 ? '' : 's'}`}
                      className="inline-flex items-center gap-0.5 text-xs bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 hover:text-foreground transition-colors"
                    >
                      <Paperclip className="h-3 w-3" />
                      {stepOutputFiles.length}
                    </button>
                  )}
                  {hasConfig && (isExpanded
                    ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  {wfStatus.isRetryable && isCurrent && (
                    <RetryStepButton instanceId={instance.id} stepId={stepId} />
                  )}
                </div>

                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-xs text-muted-foreground">
                    <span className="text-muted-foreground/60 mr-1">Started</span>
                    {format(new Date(latestExec.startedAt), 'MMM d, HH:mm')}
                  </span>
                  {!latestExec.completedAt && (
                    <>
                      <span className="text-muted-foreground/40">·</span>
                      <span className="text-xs text-muted-foreground">
                        <ElapsedTimer startedAt={latestExec.startedAt} />
                      </span>
                    </>
                  )}
                  {latestExec.completedAt && (
                    <>
                      <span className="text-muted-foreground/40">·</span>
                      <span className="text-xs text-muted-foreground">
                        <span className="text-muted-foreground/60 mr-1">Completed</span>
                        {format(new Date(latestExec.completedAt), 'MMM d, HH:mm')}
                      </span>
                      <span className="text-muted-foreground/40">·</span>
                      <span className="text-xs text-muted-foreground">
                        {formatDuration(new Date(latestExec.completedAt).getTime() - new Date(latestExec.startedAt).getTime())}
                      </span>
                      {latestExec.agentOutput?.estimatedCostUsd != null && (
                        <>
                          <span className="text-muted-foreground/40">·</span>
                          <span className="text-xs text-muted-foreground">
                            {formatCostUsd(latestExec.agentOutput.estimatedCostUsd)}
                          </span>
                        </>
                      )}
                    </>
                  )}
                  <span className="text-muted-foreground/40">·</span>
                  <ExecutedBy
                    executedBy={latestExec.executedBy}
                    executorType={stepConfig?.executorType}
                    plugin={stepConfig?.plugin}
                    autonomyLevel={stepConfig?.autonomyLevel}
                    runtime={stepConfig?.agentConfig?.runtime}
                  />
                </div>

                {status === 'running' && stepConfig?.executorType === 'agent' && (
                  <StepProgress stepId={stepId} agentEvents={agentEvents} />
                )}

                {/* Taken verdict — only shown for completed review steps */}
                {takenVerdict && takenVerdictTargetName && (
                  <div className="ml-4 mt-1.5">
                    <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                      {takenVerdict}
                      <span className="mx-1 text-muted-foreground">{'→'}</span>
                      {takenVerdictTargetName}
                    </span>
                  </div>
                )}

                {isFilesExpanded && stepOutputFiles.length > 0 && (
                  <div className="mt-2 rounded-md bg-muted/50 border px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <ul className="space-y-1">
                      {stepOutputFiles.map((file) => (
                        <OutputFileRow key={file.path} runId={instance.id} file={file} />
                      ))}
                    </ul>
                  </div>
                )}

                {isExpanded && stepConfig && (
                  <StepConfigDetail
                    stepId={stepId}
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
