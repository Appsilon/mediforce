'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMemo } from 'react';
import { format } from 'date-fns';
import { ArrowLeft, Lock } from 'lucide-react';
import { where, orderBy } from 'firebase/firestore';
import type { HumanTask } from '@mediforce/platform-core';
import { ClaimButton, UnclaimButton } from './claim-button';
import { TaskContextPanel } from './task-context-panel';
import { VerdictForm, VerdictConfirmationReadOnly } from './verdict-form';
import { useCollection } from '@/hooks/use-collection';
import { cn } from '@/lib/utils';

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  claimed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  cancelled: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
};

/** Format a stepId into a human-readable title. */
function formatStepName(stepId: string): string {
  return stepId
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function TaskDetail({
  task,
  currentUserId,
}: {
  task: HumanTask;
  currentUserId: string;
}) {
  const [hasStepContent, setHasStepContent] = React.useState(false);

  const onContentLoaded = React.useCallback((has: boolean) => {
    setHasStepContent(has);
  }, []);

  // Count remaining tasks for the same role (pending or claimed, excluding this task)
  const remainingConstraints = useMemo(
    () =>
      task.assignedRole
        ? [
            where('assignedRole', '==', task.assignedRole),
            where('status', 'in', ['pending', 'claimed']),
            orderBy('createdAt', 'asc'),
          ]
        : [],
    [task.assignedRole],
  );
  const { data: remainingTasks } = useCollection<HumanTask>(
    'humanTasks',
    remainingConstraints,
  );
  const remainingTaskCount = remainingTasks.filter((t) => t.id !== task.id).length;

  const isClaimedByMe = task.status === 'claimed' && task.assignedUserId === currentUserId;
  const isClaimedByOther = task.status === 'claimed' && task.assignedUserId !== currentUserId;
  const isCompleted = task.status === 'completed';
  const isPending = task.status === 'pending';

  return (
    <div className="p-6 max-w-3xl space-y-6">
      {/* Back */}
      <Link
        href="/tasks"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to My Tasks
      </Link>

      {/* Title + status */}
      <div className="space-y-2">
        <div className="flex items-start gap-3">
          <h1 className="text-2xl font-headline font-semibold flex-1">
            {formatStepName(task.stepId)}
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

      {/* Metadata */}
      <div className="rounded-lg border p-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Process
          </div>
          <Link
            href={`/processes/${task.processInstanceId}`}
            className="text-primary hover:underline font-mono text-xs"
          >
            {task.processInstanceId.slice(0, 12)}&hellip;
          </Link>
        </div>
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

      {/* Previous step output (context panel) */}
      <TaskContextPanel
        processInstanceId={task.processInstanceId}
        stepId={task.stepId}
        onContentLoaded={onContentLoaded}
      />

      {/* Action section — conditional on task status */}
      <div className="space-y-3">
        {/* Pending: show claim button */}
        {isPending && (
          <ClaimButton taskId={task.id} currentUserId={currentUserId} />
        )}

        {/* Claimed by current user: show verdict form + unclaim */}
        {isClaimedByMe && (
          <>
            <VerdictForm
              taskId={task.id}
              disabled={!hasStepContent}
              remainingTaskCount={remainingTaskCount}
            />
            <div className="pt-1 border-t">
              <UnclaimButton taskId={task.id} currentUserId={currentUserId} />
            </div>
          </>
        )}

        {/* Claimed by another user: locked state */}
        {isClaimedByOther && (
          <div className="rounded-lg border border-dashed p-4 flex items-center gap-3">
            <Lock className="h-5 w-5 text-muted-foreground shrink-0" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Task is locked
              </p>
              <p className="text-xs text-muted-foreground">
                Claimed by{' '}
                <span className="font-mono">{task.assignedUserId}</span>
              </p>
            </div>
          </div>
        )}

        {/* Completed: show verdict confirmation from completionData */}
        {isCompleted && task.completionData && (
          <VerdictConfirmationReadOnly
            completionData={task.completionData}
            remainingTaskCount={remainingTaskCount}
          />
        )}
      </div>
    </div>
  );
}
