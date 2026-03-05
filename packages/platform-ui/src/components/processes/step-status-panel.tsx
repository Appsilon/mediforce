'use client';

import { CheckCircle2, Clock, XCircle, Circle, Pause, User, Bot, Cog } from 'lucide-react';
import type { ProcessInstance, StepExecution, Step } from '@mediforce/platform-core';
import { AutonomyBadge } from '../agents/autonomy-badge';
import { cn } from '@/lib/utils';

interface AgentEventItem {
  id: string;
  stepId: string;
  type: string;
  payload: unknown;
  sequence: number;
}

interface ProgressPayload {
  current: number;
  total: number;
  label?: string;
}

interface StepStatusPanelProps {
  instance: ProcessInstance;
  definitionSteps: Step[];
  stepExecutions: StepExecution[];
  agentEvents?: AgentEventItem[];
  onStepClick?: (stepId: string) => void;
  stepConfigMap?: Map<string, { autonomyLevel?: string; executorType?: string }>;
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
    // Treat 'pending' execution status same as 'running' visually
    if (exec.status === 'running' || exec.status === 'pending') return 'running';
    if (exec.status === 'completed') return 'completed';
    if (exec.status === 'failed') return 'failed';
  }

  // No execution record yet — derive from instance state
  if (instance.currentStepId === step.id) {
    if (instance.status === 'paused' && instance.pauseReason === 'waiting_for_human') {
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

  // Latest status message (plain text)
  const statusEvents = stepEvents.filter((e) => e.type === 'status');
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
}: StepStatusPanelProps) {
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

          return (
            <li
              key={step.id}
              className={cn(
                'flex gap-3 py-2 pl-3 rounded-md transition-colors',
                getLeftBorderClass(status),
                status === 'completed' && 'opacity-60 hover:opacity-100 transition-opacity',
                'hover:bg-muted/50',
                onStepClick && 'cursor-pointer',
              )}
              onClick={onStepClick ? () => onStepClick(step.id) : undefined}
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
                  <span className="text-sm font-medium">{step.name}</span>
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
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
