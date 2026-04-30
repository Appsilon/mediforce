'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, Bot, User, CheckCircle2, Loader2 } from 'lucide-react';
import type { StepExecution, WorkflowDefinition, WorkflowStep } from '@mediforce/platform-core';
import { useSubcollection, useProcessInstance } from '@/hooks/use-process-instances';
import { useCollection } from '@/hooks/use-collection';
import { where } from 'firebase/firestore';
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

type WorkflowDefinitionDoc = WorkflowDefinition & { id: string };

export function NextStepCard({ processInstanceId, stepId }: NextStepCardProps) {
  const handle = useHandleFromPath();
  const { data: executions, loading: execLoading } = useSubcollection<StepExecution & { id: string }>(
    processInstanceId ? `processInstances/${processInstanceId}` : '',
    'stepExecutions',
  );

  const { data: instance, loading: instanceLoading } = useProcessInstance(processInstanceId);

  // Find the step execution for this task's step that has completed
  const stepExecution = React.useMemo(() => {
    if (executions.length === 0) return null;
    const matching = executions
      .filter((ex) => ex.stepId === stepId && ex.status === 'completed')
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    return matching[0] ?? null;
  }, [executions, stepId]);

  const nextStepId = stepExecution?.gateResult?.next ?? null;

  // Fetch workflow definition to get step metadata
  const definitionConstraints = React.useMemo(
    () =>
      instance
        ? [
            where('name', '==', instance.definitionName),
          ]
        : [],
    [instance?.definitionName], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const { data: definitions, loading: defLoading } = useCollection<WorkflowDefinitionDoc>(
    instance ? 'workflowDefinitions' : '',
    definitionConstraints,
  );

  // Find the matching version, or fall back to latest
  const definition = React.useMemo(() => {
    if (definitions.length === 0 || !instance) return null;
    const versionNum = parseInt(instance.definitionVersion, 10);
    if (!isNaN(versionNum)) {
      const match = definitions.find((d) => d.version === versionNum);
      if (match) return match;
    }
    // Fall back to latest version
    return [...definitions].sort((a, b) => b.version - a.version)[0] ?? null;
  }, [definitions, instance]);

  // Find next human task (if one was created for the next step)
  const nextTaskConstraints = React.useMemo(
    () =>
      nextStepId
        ? [
            where('processInstanceId', '==', processInstanceId),
            where('stepId', '==', nextStepId),
          ]
        : [],
    [processInstanceId, nextStepId],
  );
  const { data: nextTasks } = useCollection<{ id: string; status: string; assignedRole: string }>(
    nextStepId ? 'humanTasks' : '',
    nextTaskConstraints,
  );
  const nextHumanTask = nextTasks[0] ?? null;

  const loading = execLoading || instanceLoading || defLoading;

  if (loading) {
    return (
      <div className="rounded-lg border border-dashed p-4 flex items-center gap-3">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading next step info...</span>
      </div>
    );
  }

  // No step execution found or no gate result -- nothing to show
  if (!stepExecution || !nextStepId) return null;

  const nextStep = definition?.steps.find((s) => s.id === nextStepId) as WorkflowStep | undefined;
  const isTerminal = nextStep?.type === 'terminal';
  const executorType = nextStep?.executor ?? null;
  const processCompleted = instance?.status === 'completed';

  // Build the run link
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
  nextHumanTask: { assignedRole: string; status: string } | null;
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
  nextHumanTask: { id: string } | null;
  runHref: string | null;
  handle: string;
}) {
  // Human step with a task -> link to the task
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

  // Agent step or terminal -> link to the run view
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
