'use client';

import * as React from 'react';
import * as Popover from '@radix-ui/react-popover';
import { SlidersHorizontal, Check } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useMyTasks, useCompletedTasks } from '@/hooks/use-tasks';
import { TaskGroupedView, type GroupByField } from '@/components/tasks/task-grouped-view';
import { cn } from '@/lib/utils';

const GROUP_FIELDS: { value: GroupByField; label: string }[] = [
  { value: 'process', label: 'Process' },
  { value: 'action', label: 'Action' },
];

function DisplayPopover({
  activeFields,
  onToggle,
}: {
  activeFields: Set<GroupByField>;
  onToggle: (field: GroupByField) => void;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm',
          'text-muted-foreground hover:text-foreground hover:bg-muted transition-colors',
        )}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Display
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          className="z-50 w-48 rounded-lg border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95"
        >
          <div className="px-2 py-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Group by
            </span>
          </div>
          {GROUP_FIELDS.map((field) => {
            const isActive = activeFields.has(field.value);
            return (
              <button
                key={field.value}
                onClick={() => onToggle(field.value)}
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm',
                  'hover:bg-accent hover:text-accent-foreground transition-colors',
                  isActive ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {field.label}
                {isActive && <Check className="h-3.5 w-3.5" />}
              </button>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export default function TasksPage() {
  const { firebaseUser } = useAuth();
  const [groupByFields, setGroupByFields] = React.useState<Set<GroupByField>>(
    () => new Set<GroupByField>(['process']),
  );

  const toggleField = React.useCallback((field: GroupByField) => {
    setGroupByFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) {
        next.delete(field);
      } else {
        next.add(field);
      }
      return next;
    });
  }, []);

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
  const currentUserId = firebaseUser?.uid ?? '';

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-headline font-semibold">My Tasks</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {role ? `Tasks assigned to role: ${role}` : 'All tasks'}
          </p>
        </div>
        <DisplayPopover activeFields={groupByFields} onToggle={toggleField} />
      </div>

      <TaskGroupedView
        activeTasks={activeTasks}
        completedTasks={completedTasks}
        loading={activeLoading || completedLoading}
        currentUserId={currentUserId}
        groupByFields={groupByFields}
      />
    </div>
  );
}
