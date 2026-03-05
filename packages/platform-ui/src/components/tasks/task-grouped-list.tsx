'use client';

import * as React from 'react';
import Link from 'next/link';
import * as Collapsible from '@radix-ui/react-collapsible';
import { ChevronDown } from 'lucide-react';
import type { HumanTask } from '@mediforce/platform-core';
import { ClaimButton } from './claim-button';

export function TaskGroupedList({
  tasks,
  loading,
  currentUserId,
}: {
  tasks: HumanTask[];
  loading: boolean;
  currentUserId: string;
}) {
  // Group by assignedRole
  const groups = React.useMemo(() => {
    const map = new Map<string, HumanTask[]>();
    for (const task of tasks) {
      const group = map.get(task.assignedRole) ?? [];
      group.push(task);
      map.set(task.assignedRole, group);
    }
    return Array.from(map.entries());
  }, [tasks]);

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-4 space-y-2 animate-pulse">
            <div className="h-4 bg-muted rounded w-1/3" />
            <div className="h-3 bg-muted rounded w-full" />
            <div className="h-3 bg-muted rounded w-4/5" />
          </div>
        ))}
      </div>
    );
  }

  if (groups.length === 0) {
    return <div className="py-12 text-center text-sm text-muted-foreground">No tasks assigned to your role</div>;
  }

  return (
    <div className="space-y-3">
      {groups.map(([role, roleTasks]) => (
        <Collapsible.Root key={role} defaultOpen>
          <div className="rounded-lg border overflow-hidden">
            <Collapsible.Trigger className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{role}</span>
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{roleTasks.length}</span>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform data-[state=open]:rotate-180" />
            </Collapsible.Trigger>
            <Collapsible.Content>
              <ul className="divide-y">
                {roleTasks.map((task) => (
                  <li key={task.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors">
                    <Link href={`/tasks/${task.id}`} className="text-sm font-medium hover:text-primary transition-colors">
                      {task.stepId}
                    </Link>
                    {task.status === 'pending' && (
                      <ClaimButton taskId={task.id} currentUserId={currentUserId} />
                    )}
                  </li>
                ))}
              </ul>
            </Collapsible.Content>
          </div>
        </Collapsible.Root>
      ))}
    </div>
  );
}
