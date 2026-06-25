'use client';

import * as React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { CheckCircle2, Clock, XCircle, Circle, Pause, ChevronDown, ChevronRight, User, Bot, Terminal, Zap, Search, FileText, Paperclip } from 'lucide-react';
import type { ProcessInstance, StepExecution, Step, HumanTask } from '@mediforce/platform-core';
import type { RunOutputFileEntry } from '@mediforce/platform-api/contract';
import { getControlMode, CONTROL_MODE_LABELS } from '@/lib/control-mode';
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
      execution: StepExecution;
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
  const sorted = [...stepExecutions].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
  );

  const items: HistoryItem[] = sorted.map((execution) => {
    const step = definitionSteps.find((s) => s.id === execution.stepId) ?? null;
    const isCurrent =
      execution.stepId === instance.currentStepId && ACTIVE_STATUSES.has(execution.status);
    return { kind: 'executed', execution, step, isCurrent };
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

// Executor chip — icon + label, matching the icon compositions from workflow-diagram.tsx.
function ExecutorChip({ executorType, autonomyLevel, plugin, runtime }: {
  executorType?: string;
  autonomyLevel?: string;
  plugin?: string;
  runtime?: string;
}) {
  const mode = getControlMode(executorType, autonomyLevel);

  type Chip = { icon: React.ReactNode; label: string; className: string };
  let chip: Chip;

  if (executorType === 'script') {
    const rt = runtime ? (RUNTIME_LABELS[runtime] ?? (runtime.charAt(0).toUpperCase() + runtime.slice(1))) : null;
    chip = { icon: <Terminal className="h-3 w-3 shrink-0" />, label: rt ? `${rt} script` : 'Script', className: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/20 dark:text-yellow-300 dark:border-yellow-800' };
  } else if (executorType === 'action') {
    const actionLabel = plugin ? plugin.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : 'Action';
    chip = { icon: <Zap className="h-3 w-3 shrink-0" />, label: actionLabel, className: 'bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-950/20 dark:text-pink-300 dark:border-pink-800' };
  } else if (executorType === 'cowork') {
    chip = {
      icon: <span className="inline-flex items-center gap-0.5"><User className="h-3 w-3 shrink-0" /><Bot className="h-3 w-3 shrink-0" /></span>,
      label: 'Cowork',
      className: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-900/20 dark:text-teal-300 dark:border-teal-800',
    };
  } else if (executorType === 'agent') {
    if (mode === 'human-review') {
      chip = {
        icon: (
          <span className="inline-flex items-center gap-0.5">
            <Bot className="h-3 w-3 shrink-0" />
            <span className="relative inline-flex shrink-0 mr-2">
              <User className="h-3 w-3" />
              <Search className="absolute -bottom-0.5 -right-1.5 h-1.5 w-1.5" strokeWidth={2.5} />
            </span>
          </span>
        ),
        label: 'Human review',
        className: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/20 dark:text-indigo-300 dark:border-indigo-800',
      };
    } else if (mode === 'autonomous-agent') {
      chip = { icon: <Bot className="h-3 w-3 shrink-0" />, label: 'Autonomous agent', className: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/20 dark:text-violet-300 dark:border-violet-800' };
    } else {
      chip = { icon: <Bot className="h-3 w-3 shrink-0" />, label: CONTROL_MODE_LABELS[mode], className: 'bg-lime-50 text-lime-700 border-lime-200 dark:bg-lime-950/20 dark:text-lime-300 dark:border-lime-800' };
    }
  } else {
    chip = { icon: <User className="h-3 w-3 shrink-0" />, label: 'Human', className: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/20 dark:text-orange-300 dark:border-orange-800' };
  }

  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-md py-0.5 px-2 text-xs font-semibold border', chip.className)}>
      {chip.icon}
      {chip.label}
    </span>
  );
}

const RUNTIME_LABELS: Record<string, string> = { python: 'Python', javascript: 'JavaScript', r: 'R', bash: 'Bash' };

// Returns "Executor: {label}" — used in the metadata row of each history entry.
// For scripts: shows runtime name ("Python script").
// For actions: formats the plugin slug ("send-email" → "Send email").
// For agents: shows plugin id.
// For humans: shows display name from user directory.
function ExecutorText({ executedBy = '', executorType, plugin, runtime }: {
  executedBy?: string;
  executorType?: string;
  plugin?: string;
  runtime?: string;
}) {
  const userNames = useUserDisplayNames(useHandleFromPath());

  let label: string;
  if (executorType === 'agent') {
    label = plugin ? `agent:${plugin}` : 'agent';
  } else if (executorType === 'script') {
    const rt = runtime ? (RUNTIME_LABELS[runtime] ?? (runtime.charAt(0).toUpperCase() + runtime.slice(1))) : null;
    label = rt ? `${rt} script` : 'Script';
  } else if (executorType === 'cowork') {
    label = 'Cowork';
  } else if (executorType === 'action') {
    label = plugin
      ? plugin.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
      : 'Action';
  } else if (SYSTEM_ACTOR_IDS.has(executedBy)) {
    label = 'System';
  } else if (executedBy) {
    label = userNames.get(executedBy) ?? executedBy;
  } else {
    label = 'Human';
  }

  return (
    <span className="text-xs text-muted-foreground">
      <span className="text-muted-foreground/60 mr-1">Executor</span>
      {label}
    </span>
  );
}

function VirtualRowMeta({
  stepId,
  currentTask,
  stepConfigMap,
}: {
  stepId: string;
  currentTask?: HumanTask | null;
  stepConfigMap?: Map<string, StepConfigInfo>;
}) {
  const taskForStep = currentTask?.stepId === stepId ? currentTask : undefined;
  const cfg = stepConfigMap?.get(stepId);
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
            <span className="text-muted-foreground/60 mr-1">Duration</span>
            <ElapsedTimer startedAt={taskForStep.createdAt} />
          </span>
          <span className="text-muted-foreground/40">·</span>
        </>
      )}
      <ExecutorText
        executedBy={taskForStep?.assignedUserId ?? ''}
        executorType={cfg?.executorType}
        plugin={cfg?.plugin}
        runtime={cfg?.agentConfig?.runtime}
      />
    </div>
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

// formatDuration from @/lib/format covers seconds/minutes but not days or hours.
// This live-updating timer adds those tiers and re-renders every second.
function ElapsedTimer({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = React.useState(() => Date.now() - new Date(startedAt).getTime());

  React.useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - new Date(startedAt).getTime()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const totalSeconds = Math.floor(Math.max(0, elapsed) / 1000);
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

function getStatusClasses(status: EffectiveStatus): string {
  switch (status) {
    case 'running': return 'border-l-4 border-blue-500';
    case 'waiting': return 'border-l-4 border-amber-500';
    default:        return 'border-l-4 border-transparent';
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

  if (history.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <h3 className="text-sm font-medium mb-3">Execution History</h3>
        <p className="text-xs text-muted-foreground">No steps started yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-1">
      <h3 className="text-sm font-medium mb-3">Execution History</h3>
      <ol>
        {history.map((item, i) => {
          const isLast = i === history.length - 1;

          if (item.kind === 'virtual') {
            const status = getVirtualEffectiveStatus(instance);
            return (
              <li key={`virtual-${item.stepId}`} className={cn('flex gap-3 py-2 pl-3 rounded-md', getStatusClasses(status))}>
                <div className="flex flex-col items-center">
                  <div className="mt-0.5"><StatusIcon status={status} /></div>
                  {!isLast && <div className="mt-1 w-px flex-1 bg-border min-h-[16px]" />}
                </div>
                <div className="pb-1 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {stepDetailBaseHref ? (
                      <Link
                        href={`${stepDetailBaseHref}/steps/${encodeURIComponent(item.stepId)}`}
                        className="text-sm font-medium text-primary"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {item.step?.name ?? item.stepId}
                      </Link>
                    ) : (
                      <span className="text-sm font-medium">{item.step?.name ?? item.stepId}</span>
                    )}
                    <ExecutorChip
                      executorType={stepConfigMap?.get(item.stepId)?.executorType}
                      autonomyLevel={stepConfigMap?.get(item.stepId)?.autonomyLevel}
                      plugin={stepConfigMap?.get(item.stepId)?.plugin}
                      runtime={stepConfigMap?.get(item.stepId)?.agentConfig?.runtime}
                    />
                    {status === 'waiting' && (
                      <span className="text-xs text-amber-700 dark:text-amber-300">Waiting for action</span>
                    )}
                    {wfStatus.isRetryable && instance.currentStepId === item.stepId && (
                      <RetryStepButton instanceId={instance.id} stepId={item.stepId} />
                    )}
                  </div>
                  <VirtualRowMeta
                    stepId={item.stepId}
                    currentTask={currentTask}
                    stepConfigMap={stepConfigMap}
                  />
                </div>
              </li>
            );
          }

          const { execution, step, isCurrent } = item;
          const execId = execution.id;
          const stepId = execution.stepId;
          const status = getExecEffectiveStatus(execution, instance);
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
          const takenVerdict = execution.status === 'completed' ? execution.verdict : undefined;
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
                'flex gap-3 py-2 pl-3 rounded-md',
                getStatusClasses(status),
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
                      href={`${stepDetailBaseHref}/steps/${encodeURIComponent(stepId)}?executionId=${encodeURIComponent(execId)}`}
                      className="text-sm font-medium text-primary"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {step?.name ?? stepId}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium">{step?.name ?? stepId}</span>
                  )}
                  <ExecutorChip
                    executorType={stepConfig?.executorType}
                    autonomyLevel={stepConfig?.autonomyLevel}
                    plugin={stepConfig?.plugin}
                    runtime={stepConfig?.agentConfig?.runtime}
                  />
                  {status === 'waiting' && (
                    <span className="text-xs text-amber-700 dark:text-amber-300">Waiting for action</span>
                  )}
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
                    {format(new Date(execution.startedAt), 'MMM d, HH:mm')}
                  </span>
                  {!execution.completedAt && (
                    <>
                      <span className="text-muted-foreground/40">·</span>
                      <span className="text-xs text-muted-foreground">
                        <span className="text-muted-foreground/60 mr-1">Duration</span>
                        <ElapsedTimer startedAt={execution.startedAt} />
                      </span>
                    </>
                  )}
                  {execution.completedAt && (
                    <>
                      <span className="text-muted-foreground/40">·</span>
                      <span className="text-xs text-muted-foreground">
                        <span className="text-muted-foreground/60 mr-1">Completed</span>
                        {format(new Date(execution.completedAt), 'MMM d, HH:mm')}
                      </span>
                      <span className="text-muted-foreground/40">·</span>
                      <span className="text-xs text-muted-foreground">
                        <span className="text-muted-foreground/60 mr-1">Duration</span>
                        {formatDuration(new Date(execution.completedAt).getTime() - new Date(execution.startedAt).getTime())}
                      </span>
                      {execution.agentOutput?.estimatedCostUsd != null && (
                        <>
                          <span className="text-muted-foreground/40">·</span>
                          <span className="text-xs text-muted-foreground">
                            <span className="text-muted-foreground/60 mr-1">Cost</span>
                            {formatCostUsd(execution.agentOutput.estimatedCostUsd)}
                          </span>
                        </>
                      )}
                    </>
                  )}
                  <span className="text-muted-foreground/40">·</span>
                  <ExecutorText
                    executedBy={execution.executedBy}
                    executorType={stepConfig?.executorType}
                    plugin={stepConfig?.plugin}
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
