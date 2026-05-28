'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Bot, User, CheckCircle2, Loader2 } from 'lucide-react';
import type { StepExecution, WorkflowStep, HumanTask } from '@mediforce/platform-core';
import { ACTIONABLE_STATUSES } from '@mediforce/platform-api/contract';
import { useSubcollection, useProcessInstance } from '@/hooks/use-process-instances';
import { ApiError, mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { cn } from '@/lib/utils';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import { routes } from '@/lib/routes';

interface NextStepCardProps {
  processInstanceId: string;
  stepId: string;
}

/** Format a stepId into a human-readable title. */
function formatStepName(stepId: string): string {
  return stepId
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function NextStepCard({ processInstanceId, stepId }: NextStepCardProps) {
  const handle = useHandleFromPath();
  // Step executions still live in Firestore (PR2 scope migrates the agent /
  // step-execution domain). Keep Firestore-backed here.
  const { data: executions, loading: execLoading } = useSubcollection<StepExecution & { id: string }>(
    processInstanceId ? `processInstances/${processInstanceId}` : '',
    'stepExecutions',
  );

  const { data: instance, loading: instanceLoading } = useProcessInstance(processInstanceId);

  const stepExecution = React.useMemo(() => {
    if (executions.length === 0) return null;
    const matching = executions
      .filter((ex) => ex.stepId === stepId && ex.status === 'completed')
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    return matching[0] ?? null;
  }, [executions, stepId]);

  const nextStepId = stepExecution?.gateResult?.next ?? null;

  const definitionVersion = instance ? Number.parseInt(instance.definitionVersion, 10) : NaN;
  const definitionName = instance?.definitionName ?? '';
  const defQuery = useQuery({
    queryKey: [
      'workflow',
      handle,
      definitionName,
      Number.isFinite(definitionVersion) ? definitionVersion : 'latest',
    ] as const,
    queryFn: () =>
      mediforce.workflows.get({
        name: definitionName,
        namespace: handle,
        ...(Number.isFinite(definitionVersion) ? { version: definitionVersion } : {}),
      }),
    enabled: instance !== null && definitionName.length > 0,
    retry: (failureCount, err) => {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false;
      return failureCount < 2;
    },
  });
  const definition = defQuery.data?.definition ?? null;
  const defLoading = defQuery.isLoading && instance !== null;

  const nextTasksQuery = useQuery({
    queryKey: queryKeys.tasks.byInstance(processInstanceId, {
      stepId: nextStepId ?? undefined,
      status: [...ACTIONABLE_STATUSES, 'completed'],
    }),
    queryFn: async () => {
      const result = await mediforce.tasks.list({
        instanceId: processInstanceId,
        stepId: nextStepId as string,
        status: [...ACTIONABLE_STATUSES, 'completed'],
      });
      return result.tasks;
    },
    enabled: nextStepId !== null && processInstanceId.length > 0,
  });
  const nextHumanTask: HumanTask | null = nextTasksQuery.data?.[0] ?? null;

  const loading = execLoading || instanceLoading || defLoading;

  if (loading) {
    return (
      <div className="rounded-lg border border-dashed p-4 flex items-center gap-3">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading next step info...</span>
      </div>
    );
  }

  if (!stepExecution || !nextStepId) return null;

  const nextStep = definition?.steps.find((s) => s.id === nextStepId) as WorkflowStep | undefined;
  const isTerminal = nextStep?.type === 'terminal';
  const executorType = nextStep?.executor ?? null;
  const processCompleted = instance?.status === 'completed';

  const runHref = instance
    ? routes.workflowRun(handle, instance.definitionName, processInstanceId)
    : null;

  return (
    <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
        <ArrowRight className="h-3.5 w-3.5" />
        What happened next
      </div>

      <div className="flex items-center gap-3">
        <StepIcon isTerminal={isTerminal} processCompleted={processCompleted} executorType={executorType} />

        <div className="flex-1 min-w-0">
          {isTerminal || processCompleted ? (
            <>
              <p className="text-sm font-medium">Process completed</p>
              {stepExecution.gateResult?.reason && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {stepExecution.gateResult.reason}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-sm font-medium">
                {nextStep ? formatStepName(nextStep.id) : formatStepName(nextStepId)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                <StepDescription
                  executorType={executorType}
                  nextHumanTask={nextHumanTask}
                  reason={stepExecution.gateResult?.reason}
                />
              </p>
            </>
          )}
        </div>

        <StepLink
          isTerminal={isTerminal}
          processCompleted={processCompleted}
          executorType={executorType}
          nextHumanTask={nextHumanTask}
          runHref={runHref}
          handle={handle}
        />
      </div>
    </div>
  );
}

function StepIcon({
  isTerminal,
  processCompleted,
  executorType,
}: {
  isTerminal: boolean;
  processCompleted: boolean;
  executorType: string | null;
}) {
  if (isTerminal || processCompleted) {
    return (
      <div className="rounded-full bg-green-100 p-1.5 dark:bg-green-900/30">
        <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
      </div>
    );
  }
  if (executorType === 'agent') {
    return (
      <div className="rounded-full bg-purple-100 p-1.5 dark:bg-purple-900/30">
        <Bot className="h-4 w-4 text-purple-600 dark:text-purple-400" />
      </div>
    );
  }
  return (
    <div className="rounded-full bg-blue-100 p-1.5 dark:bg-blue-900/30">
      <User className="h-4 w-4 text-blue-600 dark:text-blue-400" />
    </div>
  );
}

function StepDescription({
  executorType,
  nextHumanTask,
  reason,
}: {
  executorType: string | null;
  nextHumanTask: HumanTask | null;
  reason: string | undefined;
}) {
  const parts: string[] = [];

  if (executorType === 'agent') {
    parts.push('Running via agent');
  } else if (nextHumanTask) {
    const roleLabel = nextHumanTask.assignedRole;
    if (nextHumanTask.status === 'completed') {
      parts.push(`Completed by ${roleLabel}`);
    } else if (nextHumanTask.status === 'claimed') {
      parts.push(`Claimed -- assigned to ${roleLabel}`);
    } else {
      parts.push(`Waiting for ${roleLabel}`);
    }
  } else if (executorType === 'human') {
    parts.push('Assigned to human');
  }

  if (reason) {
    parts.push(reason);
  }

  return <>{parts.join(' -- ')}</>;
}

function StepLink({
  isTerminal,
  processCompleted,
  executorType,
  nextHumanTask,
  runHref,
  handle,
}: {
  isTerminal: boolean;
  processCompleted: boolean;
  executorType: string | null;
  nextHumanTask: HumanTask | null;
  runHref: string | null;
  handle: string;
}) {
  if (!isTerminal && !processCompleted && executorType === 'human' && nextHumanTask) {
    return (
      <Link
        href={routes.task(handle, nextHumanTask.id)}
        className={cn(
          'shrink-0 inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium',
          'bg-primary/10 text-primary hover:bg-primary/20 transition-colors',
        )}
      >
        View Task
        <ArrowRight className="h-3 w-3" />
      </Link>
    );
  }

  if (runHref) {
    return (
      <Link
        href={runHref}
        className={cn(
          'shrink-0 inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium',
          'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors',
        )}
      >
        View Run
        <ArrowRight className="h-3 w-3" />
      </Link>
    );
  }

  return null;
}
