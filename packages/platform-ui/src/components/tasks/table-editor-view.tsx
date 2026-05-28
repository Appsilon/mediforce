'use client';

import * as React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { AlertTriangle, Bot, CheckCircle, Loader2, User } from 'lucide-react';
import { mediforce } from '@/lib/mediforce';
import { cn } from '@/lib/utils';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import type { TaskBodyProps } from './task-body-registry';

// ── Column schema ─────────────────────────────────────────────────────────
// A table-editor renders one row per `task.options[i]` and one cell per column.
// `static` columns are read-only display; the others are per-cell editors whose
// values land in the output keyed by column id.

export interface SelectOption {
  id: string;
  label: string;
  kind?: 'human' | 'agent';
  badge?: string;
}

export interface StaticColumn {
  id: string;
  kind: 'static';
  label: string;
  field: string;
  link?: boolean;
}

export interface SingleSelectColumn {
  id: string;
  kind: 'single-select';
  label: string;
  options: SelectOption[];
  default?: string;
  allowEmpty?: boolean;
}

export interface MultiSelectColumn {
  id: string;
  kind: 'multi-select';
  label: string;
  options: SelectOption[];
  default?: string[];
}

export interface TextColumn {
  id: string;
  kind: 'text';
  label: string;
  placeholder?: string;
}

export interface AvatarColumn {
  id: string;
  kind: 'avatar';
  label: string;
  field: string;
  size?: number;
  fallbackField?: string;
}

export type ColumnSpec = StaticColumn | SingleSelectColumn | MultiSelectColumn | TextColumn | AvatarColumn;

export interface ItemRow {
  id: string;
  label?: string;
  href?: string;
  suggestion?: Record<string, unknown>;
  [key: string]: unknown;
}

export type CellValue = string | string[];

export interface OutputRow {
  itemId: string;
  values: Record<string, CellValue>;
}

export type TableEditorSubmit = (rows: OutputRow[]) => Promise<void>;

const PLACEHOLDER = '— pick —';

// ── Public component (registered as 'table-editor') ─────────────────────────

export function TableEditorView({ task }: TaskBodyProps) {
  const isActionable = task.status === 'claimed' || task.status === 'pending';
  const isCompleted = task.status === 'completed';

  if (isActionable) {
    return <TableEditorTaskForm task={task} />;
  }
  if (isCompleted && task.completionData) {
    return <TableEditorCompletedView completionData={task.completionData} />;
  }
  return null;
}

function TableEditorTaskForm({ task }: { task: TaskBodyProps['task'] }) {
  const config = (task.ui?.config ?? {}) as Record<string, unknown>;
  const columns = (config.columns as ColumnSpec[] | undefined) ?? [];
  const items = (task.options ?? []) as unknown as ItemRow[];
  const submitLabel = (config.submitLabel as string | undefined) ?? 'Submit';
  const emptyMessage = (config.emptyMessage as string | undefined) ?? 'No items';

  const onSubmit = React.useCallback<TableEditorSubmit>(
    async (rows) => {
      await mediforce.tasks.complete({
        taskId: task.id,
        payload: { kind: 'rows', rows },
      });
    },
    [task.id],
  );

  return (
    <TableEditorForm
      columns={columns}
      items={items}
      submitLabel={submitLabel}
      emptyMessage={emptyMessage}
      onSubmit={onSubmit}
    />
  );
}

// ── Generic form engine (reused by the assignment-table shim) ───────────────

export interface TableEditorFormProps {
  columns: ColumnSpec[];
  items: ItemRow[];
  onSubmit: TableEditorSubmit;
  submitLabel?: string;
  emptyMessage?: string;
}

function isEmptyValue(value: CellValue | undefined): boolean {
  if (value === undefined) return true;
  return value.length === 0;
}

type DisplayOnlyColumn = StaticColumn | AvatarColumn;

function editableColumns(columns: ColumnSpec[]): Exclude<ColumnSpec, DisplayOnlyColumn>[] {
  return columns.filter((c) => c.kind !== 'static' && c.kind !== 'avatar') as Exclude<ColumnSpec, DisplayOnlyColumn>[];
}

function hasOption(options: SelectOption[], id: unknown): boolean {
  return typeof id === 'string' && options.some((o) => o.id === id);
}

function initialCellValue(column: Exclude<ColumnSpec, DisplayOnlyColumn>, item: ItemRow): CellValue {
  const suggested = item.suggestion?.[column.id];
  if (column.kind === 'single-select') {
    return hasOption(column.options, suggested) ? (suggested as string) : (column.default ?? '');
  }
  if (column.kind === 'multi-select') {
    if (Array.isArray(suggested)) {
      return suggested.filter((s): s is string => hasOption(column.options, s));
    }
    return column.default ?? [];
  }
  return typeof suggested === 'string' ? suggested : '';
}

export function TableEditorForm({
  columns,
  items,
  onSubmit,
  submitLabel = 'Submit',
  emptyMessage = 'No items',
}: TableEditorFormProps) {
  const editable = React.useMemo(() => editableColumns(columns), [columns]);

  const [rows, setRows] = React.useState<Record<string, Record<string, CellValue>>>(() => {
    const initial: Record<string, Record<string, CellValue>> = {};
    for (const item of items) {
      const cells: Record<string, CellValue> = {};
      for (const column of editable) {
        cells[column.id] = initialCellValue(column, item);
      }
      initial[item.id] = cells;
    }
    return initial;
  });

  // Suggestions that point outside a single-select's option set: surfaced as a
  // warning so the reviewer notices the upstream step proposed an invalid value.
  const invalidSuggestions = React.useMemo(() => {
    const out: Record<string, Record<string, string>> = {};
    for (const item of items) {
      for (const column of editable) {
        if (column.kind !== 'single-select') continue;
        const suggested = item.suggestion?.[column.id];
        if (typeof suggested === 'string' && suggested.length > 0 && !hasOption(column.options, suggested)) {
          (out[item.id] ??= {})[column.id] = suggested;
        }
      }
    }
    return out;
  }, [items, editable]);

  const [submitting, setSubmitting] = React.useState(false);
  const [submitted, setSubmitted] = React.useState<OutputRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  function updateCell(itemId: string, columnId: string, value: CellValue): void {
    setRows((prev) => ({ ...prev, [itemId]: { ...prev[itemId], [columnId]: value } }));
  }

  const isValid = React.useMemo(() => {
    for (const item of items) {
      for (const column of editable) {
        if (column.kind === 'single-select' && column.allowEmpty === false) {
          if (isEmptyValue(rows[item.id]?.[column.id])) return false;
        }
      }
    }
    return true;
  }, [items, editable, rows]);

  function buildRows(): OutputRow[] {
    return items.map((item) => ({
      itemId: item.id,
      values: Object.fromEntries(editable.map((column) => [column.id, rows[item.id]?.[column.id] ?? ''])),
    }));
  }

  async function handleSubmit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    const built = buildRows();
    try {
      await onSubmit(built);
      setSubmitted(built);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    }
    setSubmitting(false);
  }

  if (submitted !== null) {
    return <SubmittedView rows={submitted} />;
  }

  if (items.length === 0) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {emptyMessage}
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
            {columns.map((column, index) => (
              <th key={column.id} className={cn('pb-2', index === 0 ? 'pr-3' : 'px-3')}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const itemLabel = typeof item.label === 'string' ? item.label : item.id;
            return (
              <tr key={item.id} className="border-t align-top">
                {columns.map((column, index) => (
                  <td key={column.id} className={cn('py-3', index === 0 ? 'pr-3' : 'px-3')}>
                    <Cell
                      column={column}
                      item={item}
                      itemLabel={itemLabel}
                      value={rows[item.id]?.[column.id]}
                      invalidSuggestion={invalidSuggestions[item.id]?.[column.id]}
                      disabled={submitting}
                      onChange={(value) => updateCell(item.id, column.id, value)}
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>

      {error !== null && <p className="text-sm text-destructive">{error}</p>}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting || !isValid}
        className={cn(
          'inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors',
          (submitting || !isValid) && 'opacity-50 cursor-not-allowed',
        )}
      >
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
        {submitLabel}
      </button>
    </div>
  );
}

// ── Cell renderers ──────────────────────────────────────────────────────────

interface CellProps {
  column: ColumnSpec;
  item: ItemRow;
  itemLabel: string;
  value: CellValue | undefined;
  invalidSuggestion: string | undefined;
  disabled: boolean;
  onChange: (value: CellValue) => void;
}

function Cell({ column, item, itemLabel, value, invalidSuggestion, disabled, onChange }: CellProps) {
  if (column.kind === 'static') {
    return <StaticCell field={item[column.field]} href={item.href} link={column.link === true} />;
  }

  if (column.kind === 'avatar') {
    const url = item[column.field];
    const fallback = column.fallbackField !== undefined ? item[column.fallbackField] : undefined;
    return (
      <AvatarCell
        url={typeof url === 'string' ? url : undefined}
        fallback={typeof fallback === 'string' ? fallback : undefined}
        size={column.size}
      />
    );
  }

  if (column.kind === 'text') {
    return (
      <>
        <label className="sr-only" htmlFor={`${column.id}-${item.id}`}>
          {column.label} for {itemLabel}
        </label>
        <input
          id={`${column.id}-${item.id}`}
          aria-label={`${column.label} for ${itemLabel}`}
          type="text"
          value={(value as string | undefined) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={column.placeholder}
          className="w-full rounded-md border bg-background px-2 py-1 text-sm"
        />
      </>
    );
  }

  if (column.kind === 'multi-select') {
    const selected = (value as string[] | undefined) ?? [];
    const toggle = (optionId: string): void => {
      const next = new Set(selected);
      if (next.has(optionId)) {
        next.delete(optionId);
      } else {
        next.add(optionId);
      }
      onChange(column.options.filter((o) => next.has(o.id)).map((o) => o.id));
    };
    return (
      <div role="group" aria-label={`${column.label} for ${itemLabel}`} className="space-y-1">
        {column.options.map((option) => (
          <label key={option.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              aria-label={`${option.label} for ${itemLabel}`}
              checked={selected.includes(option.id)}
              onChange={() => toggle(option.id)}
              disabled={disabled}
              className="rounded border"
            />
            {option.label}
          </label>
        ))}
      </div>
    );
  }

  // single-select
  const current = (value as string | undefined) ?? '';
  const selectedOption = column.options.find((o) => o.id === current);
  return (
    <>
      <label className="sr-only" htmlFor={`${column.id}-${item.id}`}>
        {column.label} for {itemLabel}
      </label>
      <select
        id={`${column.id}-${item.id}`}
        aria-label={`${column.label} for ${itemLabel}`}
        value={current}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="rounded-md border bg-background px-2 py-1 text-sm"
      >
        <option value="">{PLACEHOLDER}</option>
        {column.options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      {selectedOption?.kind !== undefined && <OptionKindHint option={selectedOption} />}
      {invalidSuggestion !== undefined && current === '' && (
        <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          <AlertTriangle className="h-3 w-3" />
          suggestion &apos;{invalidSuggestion}&apos; not in allowlist
        </div>
      )}
    </>
  );
}

function StaticCell({ field, href, link }: { field: unknown; href: string | undefined; link: boolean }) {
  if (Array.isArray(field)) {
    if (field.length === 0) {
      return <span className="text-xs text-muted-foreground">—</span>;
    }
    return (
      <div className="flex flex-wrap gap-1">
        {field.map((entry, index) => (
          <span key={index} className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs">
            {String(entry)}
          </span>
        ))}
      </div>
    );
  }
  const text = field === undefined || field === null ? '' : String(field);
  if (link && href !== undefined && text.length > 0) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
        {text}
      </a>
    );
  }
  return <span className="font-medium">{text}</span>;
}

export function deriveInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? words[words.length - 1]![0] ?? '' : '';
  return (first + last).toUpperCase();
}

function AvatarCell({ url, fallback, size = 32 }: { url?: string; fallback?: string; size?: number }) {
  if (url !== undefined && url.length > 0) {
    return (
      <img
        src={url}
        alt={fallback ?? ''}
        width={size}
        height={size}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  const initials = fallback !== undefined ? deriveInitials(fallback) : '?';
  return (
    <div
      className="inline-flex items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
      style={{ width: size, height: size }}
    >
      {initials}
    </div>
  );
}

function OptionKindHint({ option }: { option: SelectOption }) {
  const Icon = option.kind === 'agent' ? Bot : User;
  return (
    <div className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Icon className="h-3 w-3" />
      {option.kind}
      {option.badge !== undefined && <span className="text-muted-foreground/70">· {option.badge}</span>}
    </div>
  );
}

// ── Result views ──────────────────────────────────────────────────────────

function summariseValues(values: Record<string, CellValue>): string {
  return Object.entries(values)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join('/') : value}`)
    .join(', ');
}

function SubmittedView({ rows }: { rows: OutputRow[] }) {
  const handle = useHandleFromPath();
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:bg-green-900/20 dark:border-green-800">
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
          <span className="font-medium text-sm text-green-800 dark:text-green-300">
            {rows.length} row{rows.length === 1 ? '' : 's'} submitted
          </span>
        </div>
        <ul className="space-y-1 text-sm text-green-700 dark:text-green-300">
          {rows.map((row) => (
            <li key={row.itemId}>
              <span className="font-mono text-xs">{row.itemId}</span> → {summariseValues(row.values)}
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

function TableEditorCompletedView({ completionData }: { completionData: Record<string, unknown> }) {
  const rows = (completionData.rows as OutputRow[] | undefined) ?? [];
  const completedAt = completionData.completedAt as string | undefined;
  const handle = useHandleFromPath();

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:bg-green-900/20 dark:border-green-800">
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
          <span className="font-medium text-sm text-green-800 dark:text-green-300">
            {rows.length} row{rows.length === 1 ? '' : 's'} submitted
          </span>
        </div>
        <ul className="space-y-1 text-sm text-green-700 dark:text-green-300">
          {rows.map((row) => (
            <li key={row.itemId}>
              <span className="font-mono text-xs">{row.itemId}</span> → {summariseValues(row.values)}
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
