'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTask } from '@/hooks/use-task';
import { useProcessInstance } from '@/hooks/use-process-instances';
import { routes } from '@/lib/routes';

/**
 * Thin redirect: human tasks are displayed as run steps (the merged human
 * step view), so a task deep-link resolves the owning run and forwards to
 * `routes.workflowRunStep` **in the run's own workspace**. Kept so emails,
 * bookmarks, and the inbox's fallback links keep working — including the ones
 * pointing at a task in a workspace other than the one the link was built
 * under.
 */
export default function TaskRedirectPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const router = useRouter();
  const { task, loading, error, notFound } = useTask(taskId);
  const {
    data: instance,
    loading: instanceLoading,
    notFound: instanceNotFound,
    error: instanceError,
  } = useProcessInstance(task?.processInstanceId ?? null);

  // The run's own workspace, never the handle in the URL. A task reached from
  // an inbox showing more than one workspace — or from a bookmark typed under
  // the wrong handle — otherwise forwards to a workflow that does not exist
  // there, and the destination 404s.
  React.useEffect(() => {
    if (task && instance && instance.namespace !== undefined) {
      router.replace(
        routes.workflowRunStep(
          instance.namespace,
          instance.definitionName,
          task.processInstanceId,
          task.stepId,
        ),
      );
    }
  }, [task, instance, router]);

  if (notFound) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        Task not found.
      </div>
    );
  }

  if (error && !loading) {
    return (
      <div className="p-6 space-y-2">
        <p className="text-sm font-medium text-destructive">Failed to load task.</p>
        <p className="text-xs text-muted-foreground font-mono break-all">{error.message}</p>
      </div>
    );
  }

  if (!loading && task && !instanceLoading && (instanceNotFound || instanceError)) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        Unable to locate this task&apos;s run.
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="h-4 w-20 rounded bg-muted animate-pulse" />
      <div className="h-8 w-2/3 rounded bg-muted animate-pulse" />
      <div className="h-32 rounded bg-muted animate-pulse" />
    </div>
  );
}
