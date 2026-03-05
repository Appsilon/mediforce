'use client';

import * as React from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useMyTasks, useCompletedTasks } from '@/hooks/use-tasks';
import { ViewToggle, type TaskViewMode } from '@/components/tasks/view-toggle';
import { TaskTable } from '@/components/tasks/task-table';
import { TaskCardGrid } from '@/components/tasks/task-card-grid';
import { TaskGroupedList } from '@/components/tasks/task-grouped-list';

type FilterTab = 'active' | 'completed';

export default function TasksPage() {
  const { firebaseUser } = useAuth();
  const [viewMode, setViewMode] = React.useState<TaskViewMode>('table');
  const [filterTab, setFilterTab] = React.useState<FilterTab>('active');

  // Derive role from token claims — falls back to null (shows all tasks)
  const [role, setRole] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!firebaseUser) return;
    firebaseUser.getIdTokenResult().then((result) => {
      const roles = result.claims['roles'];
      if (Array.isArray(roles) && roles.length > 0) {
        setRole(roles[0] as string);
      }
    });
  }, [firebaseUser]);

  const { data: activeTasks, loading: activeLoading } = useMyTasks(role);
  const { data: completedTasks, loading: completedLoading } = useCompletedTasks(role);

  const currentTasks = filterTab === 'active' ? activeTasks : completedTasks;
  const currentLoading = filterTab === 'active' ? activeLoading : completedLoading;
  const currentUserId = firebaseUser?.uid ?? '';

  const ViewComponent = viewMode === 'cards' ? TaskCardGrid : viewMode === 'grouped' ? TaskGroupedList : TaskTable;

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-headline font-semibold">My Tasks</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {role ? `Tasks assigned to role: ${role}` : 'All tasks'}
          </p>
        </div>
        <ViewToggle value={viewMode} onChange={setViewMode} />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b">
        {(['active', 'completed'] as FilterTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilterTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              filterTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab}
            {tab === 'active' && activeTasks.length > 0 && (
              <span className="ml-1.5 inline-flex rounded-full bg-primary/10 px-1.5 text-xs text-primary">
                {activeTasks.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Task view */}
      <ViewComponent
        tasks={currentTasks}
        loading={currentLoading}
        currentUserId={currentUserId}
      />
    </div>
  );
}
