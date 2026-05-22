'use client';

import * as React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { AlertTriangle, Bot, CheckCircle, Loader2, User } from 'lucide-react';
import { completeAssignmentTask } from '@/app/actions/tasks';
import { useAuth } from '@/contexts/auth-context';
import { cn } from '@/lib/utils';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import type { TaskBodyProps } from './task-body-registry';

const SKIP_VALUE = '__skip__';
const DEFAULT_PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const DEFAULT_PRIORITY = 'P2';

interface AssignmentItem {
  id: string;
  label: string;
  sublabel?: string;
  href?: string;
  badges?: string[];
  currentAssignee?: string;
  suggestion?: {
    assigneeId: string;
    priority?: string;
    note?: string;
  };
  raw?: Record<string, unknown>;
}

interface AssigneeOption {
  id: string;
  label: string;
  kind: 'human' | 'agent';
  role?: string;
}

interface RowState {
  assigneeId: string;
  priority: string;
  note: string;
}

interface SubmittedAssignment {
  itemId: string;
  assigneeId: string;
  assigneeKind: 'human' | 'agent';
  priority: string;
  note?: string;
  raw?: Record<string, unknown>;
}

export function AssignmentTableView({ task, remainingTaskCount }: TaskBodyProps) {
  const isActionable = task.status === 'claimed' || task.status === 'pending';
  const isCompleted = task.status === 'completed';

  if (isActionable) {
    return <AssignmentTableForm task={task} remainingTaskCount={remainingTaskCount} />;
  }
  if (isCompleted && task.completionData) {
    return (
      <AssignmentTableConfirmation
        completionData={task.completionData}
        remainingTaskCount={remainingTaskCount}
      />
    );
  }
  return null;
}

function AssignmentTableForm({ task }: TaskBodyProps) {
  const { firebaseUser } = useAuth();
  const items = (task.options ?? []) as unknown as AssignmentItem[];
  const config = (task.ui?.config ?? {}) as Record<string, unknown>;
  const assignees = (config.assignees as AssigneeOption[] | undefined) ?? [];
  const priorities = (config.priorities as string[] | undefined) ?? DEFAULT_PRIORITIES;
  const defaultPriority = (config.defaultPriority as string | undefined) ?? DEFAULT_PRIORITY;
  const allowSkip = config.allowSkip !== false;
  const submitLabel = (config.submitLabel as string | undefined) ?? 'Submit';
  const itemColumnLabel = (config.itemColumnLabel as string | undefined) ?? 'Item';
  const noteField = config.noteField !== false;

  const assigneeIds = React.useMemo(() => new Set(assignees.map((a) => a.id)), [assignees]);

  const [rows, setRows] = React.useState<Record<string, RowState>>(() => {
    const initial: Record<string, RowState> = {};
    for (const item of items) {
      const suggestionId = item.suggestion?.assigneeId;
      const validId = suggestionId !== undefined && assigneeIds.has(suggestionId) ? suggestionId : '';
      initial[item.id] = {
        assigneeId: validId,
        priority: item.suggestion?.priority ?? defaultPriority,
        note: item.suggestion?.note ?? '',
      };
    }
    return initial;
  });
  const [submitting, setSubmitting] = React.useState(false);
  const [submitted, setSubmitted] = React.useState<SubmittedAssignment[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  function updateRow(itemId: string, patch: Partial<RowState>): void {
    setRows((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));
  }

  function buildAssignments(): SubmittedAssignment[] {
    const out: SubmittedAssignment[] = [];
    for (const item of items) {
      const row = rows[item.id];
      if (!row || row.assigneeId === '' || row.assigneeId === SKIP_VALUE) continue;
      const assignee = assignees.find((a) => a.id === row.assigneeId);
      if (!assignee) continue;
      const note = row.note.trim();
      out.push({
        itemId: item.id,
        assigneeId: assignee.id,
        assigneeKind: assignee.kind,
        priority: row.priority,
        ...(note.length > 0 ? { note } : {}),
        ...(item.raw !== undefined ? { raw: item.raw } : {}),
      });
    }
    return out;
  }

  async function handleSubmit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    const assignments = buildAssignments();
    const idToken = firebaseUser ? await firebaseUser.getIdToken() : '';
    const result = await completeAssignmentTask(task.id, { assignments }, idToken);
    if (result.success) {
      setSubmitted(assignments);
    } else {
      setError(result.error ?? 'Failed to submit');
    }
    setSubmitting(false);
  }

  if (submitted !== null) {
    return <AssignmentTableSubmittedView assignments={submitted} />;
  }

  if (items.length === 0) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No items to assign
        </div>
        <button
          type="button"
          disabled
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground opacity-50 cursor-not-allowed"
        >
          {submitLabel}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <th className="pb-2 pr-3">{itemColumnLabel}</th>
            <th className="pb-2 px-3">Assignee</th>
            <th className="pb-2 px-3">Priority</th>
            {noteField && <th className="pb-2 pl-3">Note</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const row = rows[item.id];
            const suggestionId = item.suggestion?.assigneeId;
            const suggestionInvalid = suggestionId !== undefined && !assigneeIds.has(suggestionId);
            return (
              <tr key={item.id} className="border-t align-top">
                <td className="py-3 pr-3">
                  <div className="font-medium">
                    {item.href !== undefined ? (
                      <a href={item.href} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        {item.label}
                      </a>
                    ) : (
                      item.label
                    )}
                  </div>
                  {item.sublabel !== undefined && (
                    <div className="text-xs text-muted-foreground">{item.sublabel}</div>
                  )}
                  {item.badges && item.badges.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {item.badges.map((badge, idx) => (
                        <span key={idx} className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs">
                          {badge}
                        </span>
                      ))}
                    </div>
                  )}
                  {item.currentAssignee !== undefined && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      currently: {item.currentAssignee}
                    </div>
                  )}
                </td>
                <td className="py-3 px-3">
                  <label className="sr-only" htmlFor={`assignee-${item.id}`}>Assignee for {item.label}</label>
                  <select
                    id={`assignee-${item.id}`}
                    aria-label={`Assignee for ${item.label}`}
                    value={row.assigneeId}
                    onChange={(e) => updateRow(item.id, { assigneeId: e.target.value })}
                    disabled={submitting}
                    className="rounded-md border bg-background px-2 py-1 text-sm"
                  >
                    <option value="">— pick —</option>
                    {assignees.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                    {allowSkip && <option value={SKIP_VALUE}>Skip</option>}
                  </select>
                  {row.assigneeId !== '' && row.assigneeId !== SKIP_VALUE && (
                    <AssigneeBadge assignee={assignees.find((a) => a.id === row.assigneeId)} />
                  )}
                  {suggestionInvalid && (
                    <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                      <AlertTriangle className="h-3 w-3" />
                      suggestion &apos;{suggestionId}&apos; not in allowlist
                    </div>
                  )}
                </td>
                <td className="py-3 px-3">
                  <label className="sr-only" htmlFor={`priority-${item.id}`}>Priority for {item.label}</label>
                  <select
                    id={`priority-${item.id}`}
                    aria-label={`Priority for ${item.label}`}
                    value={row.priority}
                    onChange={(e) => updateRow(item.id, { priority: e.target.value })}
                    disabled={submitting}
                    className="rounded-md border bg-background px-2 py-1 text-sm"
                  >
                    {priorities.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </td>
                {noteField && (
                  <td className="py-3 pl-3">
                    <label className="sr-only" htmlFor={`note-${item.id}`}>Note for {item.label}</label>
                    <input
                      id={`note-${item.id}`}
                      aria-label={`Note for ${item.label}`}
                      type="text"
                      value={row.note}
                      onChange={(e) => updateRow(item.id, { note: e.target.value })}
                      disabled={submitting}
                      placeholder="optional"
                      className="w-full rounded-md border bg-background px-2 py-1 text-sm"
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      {error !== null && <p className="text-sm text-destructive">{error}</p>}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting}
        className={cn(
          'inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors',
          submitting && 'opacity-50 cursor-not-allowed',
        )}
      >
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
        {submitLabel}
      </button>
    </div>
  );
}

function AssigneeBadge({ assignee }: { assignee: AssigneeOption | undefined }) {
  if (!assignee) return null;
  const Icon = assignee.kind === 'agent' ? Bot : User;
  return (
    <div className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Icon className="h-3 w-3" />
      {assignee.kind}
      {assignee.role !== undefined && <span className="text-muted-foreground/70">· {assignee.role}</span>}
    </div>
  );
}

function AssignmentTableSubmittedView({ assignments }: { assignments: SubmittedAssignment[] }) {
  const handle = useHandleFromPath();
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:bg-green-900/20 dark:border-green-800">
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
          <span className="font-medium text-sm text-green-800 dark:text-green-300">
            {assignments.length} assignment{assignments.length === 1 ? '' : 's'} submitted
          </span>
        </div>
        <ul className="space-y-1 text-sm text-green-700 dark:text-green-300">
          {assignments.map((a) => (
            <li key={a.itemId}>
              <span className="font-mono text-xs">{a.itemId}</span> → {a.assigneeId} ({a.priority})
            </li>
          ))}
        </ul>
      </div>
      <div className="text-sm text-muted-foreground">
        <Link href={`/${handle}/tasks`} className="text-primary hover:underline font-medium">
          Back to tasks
        </Link>
      </div>
    </div>
  );
}

function AssignmentTableConfirmation({
  completionData,
}: {
  completionData: Record<string, unknown>;
  remainingTaskCount?: number;
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
