'use client';

import * as React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { CheckCircle } from 'lucide-react';
import { completeAssignmentTask } from '@/app/actions/tasks';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import {
  TableEditorForm,
  type ColumnSpec,
  type ItemRow,
  type OutputRow,
  type TableEditorSubmit,
} from './table-editor-view';
import type { TaskBodyProps } from './task-body-registry';

// `assignment-table` is now a thin shim over the generic `table-editor`: it
// builds the assignee + priority + note column config, then maps the generic
// `{ rows }` output back to the `{ assignments }` shape the dispatch step
// consumes. Existing workflows keep working with zero WD changes.

const SKIP_VALUE = '__skip__';
const DEFAULT_PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const DEFAULT_PRIORITY = 'P2';

interface AssigneeOption {
  id: string;
  label: string;
  kind: 'human' | 'agent';
  role?: string;
}

interface SubmittedAssignment {
  itemId: string;
  assigneeId: string;
  assigneeKind: 'human' | 'agent';
  priority: string;
  note?: string;
  raw?: Record<string, unknown>;
}

export function AssignmentTableView({ task }: TaskBodyProps) {
  const isActionable = task.status === 'claimed' || task.status === 'pending';
  const isCompleted = task.status === 'completed';

  if (isActionable) {
    return <AssignmentTableForm task={task} />;
  }
  if (isCompleted && task.completionData) {
    return <AssignmentTableConfirmation completionData={task.completionData} />;
  }
  return null;
}

function AssignmentTableForm({ task }: { task: TaskBodyProps['task'] }) {
  const config = (task.ui?.config ?? {}) as Record<string, unknown>;
  const assignees = (config.assignees as AssigneeOption[] | undefined) ?? [];
  const priorities = (config.priorities as string[] | undefined) ?? DEFAULT_PRIORITIES;
  const defaultPriority = (config.defaultPriority as string | undefined) ?? DEFAULT_PRIORITY;
  const allowSkip = config.allowSkip !== false;
  const submitLabel = (config.submitLabel as string | undefined) ?? 'Submit';
  const itemColumnLabel = (config.itemColumnLabel as string | undefined) ?? 'Item';
  const noteField = config.noteField !== false;
  const items = (task.options ?? []) as unknown as ItemRow[];

  const columns = React.useMemo<ColumnSpec[]>(() => {
    const cols: ColumnSpec[] = [
      { id: 'item', kind: 'static', label: itemColumnLabel, field: 'label', link: true },
      { id: 'labels', kind: 'static', label: 'Labels', field: 'badges' },
      { id: 'current', kind: 'static', label: 'Current', field: 'currentAssignee' },
      {
        id: 'assigneeId',
        kind: 'single-select',
        label: 'Assignee',
        allowEmpty: true,
        options: [
          ...assignees.map((a) => ({
            id: a.id,
            label: a.label,
            kind: a.kind,
            ...(a.role !== undefined ? { badge: a.role } : {}),
          })),
          ...(allowSkip ? [{ id: SKIP_VALUE, label: 'Skip' }] : []),
        ],
      },
      {
        id: 'priority',
        kind: 'single-select',
        label: 'Priority',
        default: defaultPriority,
        options: priorities.map((p) => ({ id: p, label: p })),
      },
    ];
    if (noteField) {
      cols.push({ id: 'note', kind: 'text', label: 'Note', placeholder: 'optional' });
    }
    return cols;
  }, [assignees, priorities, defaultPriority, allowSkip, itemColumnLabel, noteField]);

  const onSubmit = React.useCallback<TableEditorSubmit>(
    (rows, idToken) =>
      completeAssignmentTask(task.id, { assignments: buildAssignments(rows, items, assignees) }, idToken),
    [task.id, items, assignees],
  );

  return (
    <TableEditorForm
      columns={columns}
      items={items}
      submitLabel={submitLabel}
      emptyMessage="No items to assign"
      onSubmit={onSubmit}
    />
  );
}

function buildAssignments(
  rows: OutputRow[],
  items: ItemRow[],
  assignees: AssigneeOption[],
): SubmittedAssignment[] {
  const out: SubmittedAssignment[] = [];
  for (const row of rows) {
    const assigneeId = (row.values.assigneeId as string | undefined) ?? '';
    if (assigneeId === '' || assigneeId === SKIP_VALUE) continue;
    const assignee = assignees.find((a) => a.id === assigneeId);
    if (assignee === undefined) continue;
    const item = items.find((i) => i.id === row.itemId);
    const note = ((row.values.note as string | undefined) ?? '').trim();
    out.push({
      itemId: row.itemId,
      assigneeId: assignee.id,
      assigneeKind: assignee.kind,
      priority: (row.values.priority as string | undefined) ?? '',
      ...(note.length > 0 ? { note } : {}),
      ...(item?.raw !== undefined ? { raw: item.raw as Record<string, unknown> } : {}),
    });
  }
  return out;
}

function AssignmentTableConfirmation({
  completionData,
}: {
  completionData: Record<string, unknown>;
}) {
  const assignments = (completionData.assignments as SubmittedAssignment[] | undefined) ?? [];
  const completedAt = completionData.completedAt as string | undefined;
  const handle = useHandleFromPath();

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:bg-green-900/20 dark:border-green-800">
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
          <span className="font-medium text-sm text-green-800 dark:text-green-300">
            {assignments.length} assignment{assignments.length === 1 ? '' : 's'} recorded
          </span>
        </div>
        <ul className="space-y-1 text-sm text-green-700 dark:text-green-300">
          {assignments.map((a) => (
            <li key={a.itemId}>
              <span className="font-mono text-xs">{a.itemId}</span> → {a.assigneeId} ({a.priority})
            </li>
          ))}
        </ul>
        {completedAt !== undefined && (
          <p className="mt-2 text-xs text-green-600/70 dark:text-green-400/70">
            {format(new Date(completedAt), 'MMM d, yyyy HH:mm')}
          </p>
        )}
      </div>
      <div className="text-sm text-muted-foreground">
        <Link href={`/${handle}/tasks`} className="text-primary hover:underline font-medium">
          Back to tasks
        </Link>
      </div>
    </div>
  );
}
