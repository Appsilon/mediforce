'use client';

import * as React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { ArrowLeft } from 'lucide-react';
import type { HumanTask, ProcessInstance } from '@mediforce/platform-core';
import { TaskContextPanel } from './task-context-panel';
import { AgentOutputReviewPanel } from './agent-output-review-panel';
import { NextStepCard } from './next-step-card';
import { resolveTaskBody } from './task-body-registry';
import { getTaskDisplayTitle, isAgentReviewTask, getAgentOutput, getAgentOutputFromSiblings } from './task-utils';
import { useMyActionableTasksByRole } from '@/hooks/use-tasks';
import { useInstanceTasks } from '@/hooks/use-instance-tasks';
import { useProcessInstance } from '@/hooks/use-process-instances';
import { cn } from '@/lib/utils';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import { useBackNavigation } from '@/hooks/use-back-navigation';
import { routes } from '@/lib/routes';

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  claimed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  cancelled: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
};

export function TaskDetail({
  task,
}: {
  task: HumanTask;
}) {
  const handle = useHandleFromPath();
  const { goBack } = useBackNavigation(`/${handle}/tasks`);
  const { data: processInstance } = useProcessInstance(task.processInstanceId);

  const { data: remainingTasks } = useMyActionableTasksByRole(task.assignedRole ?? undefined);
  const remainingTaskCount = remainingTasks.filter((t) => t.id !== task.id).length;

  const { tasks: siblingTasks } = useInstanceTasks(task.processInstanceId);

  const isCompleted = task.status === 'completed';

  const bodyEntry = resolveTaskBody(task);
  const BodyComponent = bodyEntry.Component;

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <button
        onClick={goBack}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div className="space-y-2">
        <div className="flex items-start gap-3">
          <h1 className="text-2xl font-headline font-semibold flex-1">
            {getTaskDisplayTitle(task, processInstance)}
          </h1>
          <span
            className={cn(
              'shrink-0 mt-1 inline-flex rounded-full px-2.5 py-1 text-xs font-medium capitalize',
              STATUS_STYLES[task.status] ?? STATUS_STYLES.pending,
            )}
          >
            {task.status}
          </span>
        </div>
      </div>

      <div className="rounded-lg border p-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Run
          </div>
          {processInstance ? (
            <Link
              href={`/${handle}/workflows/${encodeURIComponent(processInstance.definitionName)}/runs/${task.processInstanceId}`}
              className="text-primary hover:underline font-mono text-xs"
            >
              {task.processInstanceId.slice(0, 12)}&hellip;
            </Link>
          ) : (
            <span className="font-mono text-xs text-muted-foreground">
              {task.processInstanceId.slice(0, 12)}&hellip;
            </span>
          )}
        </div>
        {processInstance && (
          <div>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              Workflow
            </div>
            <Link
              href={`/${handle}/workflows/${encodeURIComponent(processInstance.definitionName)}`}
              className="text-primary hover:underline text-xs"
            >
              {processInstance.definitionName}
            </Link>
          </div>
        )}
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Role
          </div>
          <div>{task.assignedRole}</div>
        </div>
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Deadline
          </div>
          <div>
            {task.deadline ? (
              format(new Date(task.deadline), 'MMM d, yyyy HH:mm')
            ) : (
              <span>&mdash;</span>
            )}
          </div>
        </div>
        {task.assignedUserId && (
          <div>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              Assigned To
            </div>
            <div className="font-mono text-xs">{task.assignedUserId}</div>
          </div>
        )}
        {task.completedAt && (
          <div>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              Completed At
            </div>
            <div>{format(new Date(task.completedAt), 'MMM d, yyyy HH:mm')}</div>
          </div>
        )}
      </div>

      {siblingTasks.length > 1 && (
        <div className="rounded-lg border p-4">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
            All Tasks in This Run
          </div>
          <div className="space-y-1.5">
            {siblingTasks.map((sibling) => {
              const isCurrent = sibling.id === task.id;
              return (
                <div
                  key={sibling.id}
                  className={cn(
                    'flex items-center gap-2 text-sm rounded-md px-2 py-1.5',
                    isCurrent && 'bg-primary/5 border border-primary/10',
                  )}
                >
                  <span
                    className={cn(
                      'shrink-0 inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                      STATUS_STYLES[sibling.status] ?? STATUS_STYLES.pending,
                    )}
                  >
                    {sibling.status}
                  </span>
                  {isCurrent ? (
                    <span className="font-medium truncate">
                      {getTaskDisplayTitle(sibling, processInstance)}
                    </span>
                  ) : (
                    <Link
                      href={routes.task(handle, sibling.id)}
                      className="text-primary hover:underline truncate"
                    >
                      {getTaskDisplayTitle(sibling, processInstance)}
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <AgentOutputSection
        task={task}
        processInstance={processInstance}
        siblingTasks={siblingTasks}
        instanceId={task.processInstanceId}
      />

      {!bodyEntry.hidesContextPanel && (
        <TaskContextPanel
          processInstanceId={task.processInstanceId}
          stepId={task.stepId}
        />
      )}

      <div className="space-y-3">
        <BodyComponent task={task} remainingTaskCount={remainingTaskCount} />

        {isCompleted && (
          <NextStepCard
            processInstanceId={task.processInstanceId}
            stepId={task.stepId}
          />
        )}
      </div>
    </div>
  );
}

function AgentOutputSection({
  task,
  processInstance,
  siblingTasks,
  instanceId,
}: {
  task: HumanTask;
  processInstance: ProcessInstance | null;
  siblingTasks: HumanTask[];
  instanceId: string;
}) {
  const isAgentReview = isAgentReviewTask(task, processInstance);
  if (!isAgentReview) return null;

  const agentOutput = getAgentOutput(task) ?? getAgentOutputFromSiblings(task, siblingTasks);

  if (!agentOutput) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Agent output pending — the agent completed but output data is not yet available on this task.
        </p>
      </div>
    );
  }

  return (
    <AgentOutputReviewPanel
      agentOutput={agentOutput}
      stepId={task.stepId}
      instanceId={instanceId}
    />
  );
}
