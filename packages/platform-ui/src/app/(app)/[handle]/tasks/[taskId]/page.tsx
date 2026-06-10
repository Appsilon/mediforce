'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTask } from '@/hooks/use-task';
import { useProcessInstance } from '@/hooks/use-process-instances';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import { routes } from '@/lib/routes';

/**
 * Thin redirect: human tasks are displayed as run steps (the merged human
 * step view), so a task deep-link resolves the owning run and forwards to
 * `routes.workflowRunStep`. Kept so emails, bookmarks, and the inbox's
 * loading-state fallback links keep working.
 */
export default function TaskRedirectPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const router = useRouter();
  const handle = useHandleFromPath();
  const { task, loading, error, notFound } = useTask(taskId);
  const { data: instance } = useProcessInstance(task?.processInstanceId ?? null);

  React.useEffect(() => {
    if (task && instance) {
      router.replace(
        routes.workflowRunStep(handle, instance.definitionName, task.processInstanceId, task.stepId),
      );
    }
  }, [task, instance, handle, router]);

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

  return (
    <div className="p-6 space-y-4">
      <div className="h-4 w-20 rounded bg-muted animate-pulse" />
      <div className="h-8 w-2/3 rounded bg-muted animate-pulse" />
      <div className="h-32 rounded bg-muted animate-pulse" />
    </div>
  );
}
