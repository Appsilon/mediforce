'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { doc, onSnapshot } from 'firebase/firestore';
import type { HumanTask } from '@mediforce/platform-core';
import { db } from '@/lib/firebase';
import { TaskDetail } from '@/components/tasks/task-detail';

export default function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const [task, setTask] = React.useState<HumanTask | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!taskId) return;
    const unsub = onSnapshot(doc(db, 'humanTasks', taskId), (snap) => {
      if (snap.exists()) {
        setTask({ id: snap.id, ...snap.data() } as HumanTask);
      } else {
        setTask(null);
      }
      setLoading(false);
    });
    return unsub;
  }, [taskId]);

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
