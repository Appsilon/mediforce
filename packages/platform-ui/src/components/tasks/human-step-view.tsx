'use client';

import * as React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { Lock } from 'lucide-react';
import type { HumanTask, ProcessInstance } from '@mediforce/platform-core';
import { TaskContextPanel } from './task-context-panel';
import { AgentOutputReviewPanel } from './agent-output-review-panel';
import { NextStepCard } from './next-step-card';
import { resolveTaskBody } from './task-body-registry';
import { getTaskDisplayTitle, isAgentReviewTask, type AgentOutputData } from './task-utils';
import type { HumanStepAccess } from './resolve-step-view';
import { useMyActionableTasksByRole } from '@/hooks/use-tasks';
import { useUserDisplayNames } from '@/hooks/use-users';
import { cn } from '@/lib/utils';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import { routes } from '@/lib/routes';

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  claimed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  cancelled: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
};

interface HumanStepViewProps {
  task: HumanTask;
  access: HumanStepAccess;
  processInstance: ProcessInstance | null;
  /** Agent output for this step, envelope-first (resolved by the page). */
  agentOutput: AgentOutputData | null;
  /** Extra right-column content — the execution's raw input/output. */
  executionPanel?: React.ReactNode;
}

/**
 * Full-width human step surface: a sticky left column with the task's
 * details and action controls, and a scrollable right column with the
 * (usually long) artifacts the human reviews — agent output, previous
 * step output, execution IO.
 *
 * Wide task bodies (file upload, assignment table, table editor) need the
 * horizontal space, so they render in the right work area instead of the
 * left rail; those bodies embed their own context, hence no TaskContextPanel.
 */
export function HumanStepView({
  task,
  access,
  processInstance,
  agentOutput,
  executionPanel,
}: HumanStepViewProps) {
  const handle = useHandleFromPath();
  const userNames = useUserDisplayNames(handle);

  const { data: remainingTasks } = useMyActionableTasksByRole(task.assignedRole);
  const remainingTaskCount = remainingTasks.filter((t) => t.id !== task.id).length;

  const bodyEntry = resolveTaskBody(task);
  const BodyComponent = bodyEntry.Component;
  const bodyIsWide = bodyEntry.hidesContextPanel === true;
  const readOnly = access.kind === 'claimed-by-other' || access.kind === 'role-mismatch';

  const body = (
    <fieldset
      disabled={readOnly}
      className={cn('min-w-0', readOnly && 'opacity-60 pointer-events-none')}
    >
      <BodyComponent task={task} remainingTaskCount={remainingTaskCount} />
    </fieldset>
  );

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
      {/* Left rail — sticky so decisions stay visible while scrolling artifacts */}
      <div className="space-y-4 lg:sticky lg:top-6">
        <div className="flex items-start gap-3">
          <h2 className="text-2xl font-headline font-semibold flex-1">
            {getTaskDisplayTitle(task, processInstance)}
          </h2>
          <span
            className={cn(
              'shrink-0 mt-1 inline-flex rounded-full px-2.5 py-1 text-xs font-medium capitalize',
              STATUS_STYLES[task.status] ?? STATUS_STYLES.pending,
            )}
          >
            {task.status}
          </span>
        </div>

        {readOnly && <AccessBanner access={access} userNames={userNames} />}

        <TaskMetadataCard task={task} processInstance={processInstance} handle={handle} userNames={userNames} />

        {!bodyIsWide && access.kind !== 'completed' && body}

        {access.kind === 'completed' && (
          <NextStepCard processInstanceId={task.processInstanceId} stepId={task.stepId} />
        )}
      </div>

      {/* Right work area — long artifacts scroll here */}
      <div className="space-y-6 min-w-0">
        <AgentOutputSection
          task={task}
          processInstance={processInstance}
          agentOutput={agentOutput}
        />

        {!bodyIsWide && (
          <TaskContextPanel
            processInstanceId={task.processInstanceId}
            stepId={task.stepId}
          />
        )}

        {bodyIsWide && access.kind !== 'completed' && body}

        {executionPanel}
      </div>
    </div>
  );
}

function AccessBanner({
  access,
  userNames,
}: {
  access: HumanStepAccess;
  userNames: Map<string, string>;
}) {
  if (access.kind === 'claimed-by-other') {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 px-4 py-3 flex items-start gap-2.5 text-sm text-amber-800 dark:text-amber-300">
        <Lock className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">
            Claimed by {userNames.get(access.claimedBy) ?? access.claimedBy}
          </p>
          <p className="text-xs mt-0.5 opacity-80">Only the claimant can act on this task.</p>
        </div>
      </div>
    );
  }
  if (access.kind === 'role-mismatch') {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 px-4 py-3 flex items-start gap-2.5 text-sm text-amber-800 dark:text-amber-300">
        <Lock className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">Requires role: {access.requiredRole}</p>
          <p className="text-xs mt-0.5 opacity-80">This task is assigned to a different role.</p>
        </div>
      </div>
    );
  }
  return null;
}

function TaskMetadataCard({
  task,
  processInstance,
  handle,
  userNames,
}: {
  task: HumanTask;
  processInstance: ProcessInstance | null;
  handle: string;
  userNames: Map<string, string>;
}) {
  return (
    <div className="rounded-lg border p-4 grid grid-cols-2 gap-4 text-sm">
      {processInstance && (
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Workflow
          </div>
          <Link
            href={routes.workflow(handle, processInstance.definitionName)}
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
          <div>{userNames.get(task.assignedUserId ?? '') ?? task.assignedUserId}</div>
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
  );
}

function AgentOutputSection({
  task,
  processInstance,
  agentOutput,
}: {
  task: HumanTask;
  processInstance: ProcessInstance | null;
  agentOutput: AgentOutputData | null;
}) {
  const isAgentReview = isAgentReviewTask(task, processInstance);
  if (!isAgentReview) return null;

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
      instanceId={task.processInstanceId}
    />
  );
}
