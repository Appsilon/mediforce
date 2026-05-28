'use client';

import { useParams } from 'next/navigation';
import { useTask } from '@/hooks/use-task';
import { TaskDetail } from '@/components/tasks/task-detail';

export default function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const { task, loading } = useTask(taskId);

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-4 w-20 rounded bg-muted animate-pulse" />
        <div className="h-8 w-2/3 rounded bg-muted animate-pulse" />
        <div className="h-32 rounded bg-muted animate-pulse" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        Task not found.
      </div>
    );
  }

  return <TaskDetail task={task} />;
}
