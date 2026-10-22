'use client';

import * as React from 'react';
import Link from 'next/link';
import Papa from 'papaparse';
import { format } from 'date-fns';
import { ArrowRight, Download } from 'lucide-react';
import type { RunAuditEvent } from '@/hooks/use-run-tree-audit-events';
import { SearchField } from '@/components/ui/search-field';
import { secondaryButtonClass } from '@/components/ui/button-styles';
import { routes } from '@/lib/routes';
import { saveBlobToDevice } from '@/lib/save-blob';
import { describeParts, headlineFor } from './audit-log-tab';

/** The engine announcing its own dispatch loop. Every step writes them and
 *  they say nothing the step's own rows don't, so the table leaves them out. */
export const PLUMBING_ACTIONS: ReadonlySet<string> = new Set([
  'process.run.started',
  'process.run.step.started',
  'script.step.started',
]);

const ACTOR_TYPE_LABELS: Record<string, string> = {
  user: 'Human',
  agent: 'Agent',
  system: 'System',
};

export type AuditRow = {
  eventId: string;
  timestamp: string;
  runId: string;
  runName: string;
  stepId: string;
  nextStepId: string;
  activity: string;
  action: string;
  actorId: string;
  actorName: string;
  actorType: string;
  actorRole: string;
  basis: string;
};

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** One row per audit event: when, which run, where the run was and where it
 *  went next, what happened, who did it and on what basis. */
export function toAuditRows(entries: RunAuditEvent[], memberNames: Map<string, string>): AuditRow[] {
  return entries
    .filter(({ event }) => PLUMBING_ACTIONS.has(event.action) === false)
    .map(({ run, event }) => ({
      eventId: event.id ?? '',
      timestamp: event.timestamp,
      runId: run.id,
      runName: run.definitionName,
      // Task records carry the step in their snapshot rather than on the event.
      stepId: event.stepId ?? stringOrEmpty(event.inputSnapshot.stepId),
      nextStepId: stringOrEmpty(event.outputSnapshot.next),
      activity: describeParts(headlineFor(event)).map((part) => part.text).join('').trim(),
      action: event.action,
      actorId: event.actorId,
      actorName: memberNames.get(event.actorId) ?? event.actorId,
      actorType: ACTOR_TYPE_LABELS[event.actorType] ?? event.actorType,
      actorRole: event.actorRole,
      basis: event.basis,
    }));
}

export function auditRowsToCsv(rows: AuditRow[]): string {
  return Papa.unparse(rows.map((row) => ({
    timestamp: row.timestamp,
    workflow: row.runName,
    runId: row.runId,
    step: row.stepId,
    nextStep: row.nextStepId,
    activity: row.activity,
    action: row.action,
    actor: row.actorName,
    actorId: row.actorId,
    actorType: row.actorType,
    role: row.actorRole,
    basis: row.basis,
    eventId: row.eventId,
  })));
}

function matchesRow(row: AuditRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return [
    row.runName, row.stepId, row.nextStepId, row.activity, row.action,
    row.actorName, row.actorId, row.actorType, row.actorRole, row.basis,
  ].some((field) => field.toLowerCase().includes(needle));
}

const COLUMNS = ['Time', 'Workflow', 'Step', 'Activity', 'Actor', 'Role', 'Basis'];

export function AuditTable({ entries, loading, error, currentRunId, memberNames, handle }: {
  entries: RunAuditEvent[];
  loading: boolean;
  error: Error | null;
  /** The run whose page this is — its rows don't link to themselves. */
  currentRunId: string;
  memberNames: Map<string, string>;
  handle: string;
}) {
  const [query, setQuery] = React.useState('');

  const rows = React.useMemo(() => toAuditRows(entries, memberNames), [entries, memberNames]);
  const visible = React.useMemo(() => rows.filter((row) => matchesRow(row, query)), [rows, query]);

  if (loading) {
    return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 rounded bg-muted animate-pulse" />)}</div>;
  }

  if (error) {
    return (
      <div className="py-8 text-center text-sm text-destructive">
        Failed to load audit events: {error.message}
      </div>
    );
  }

  if (rows.length === 0) {
    return <div className="py-8 text-center text-sm text-muted-foreground">No audit events</div>;
  }

  function handleDownload() {
    const blob = new Blob([auditRowsToCsv(visible)], { type: 'text/csv;charset=utf-8' });
    saveBlobToDevice(blob, `audit-trail-${currentRunId}.csv`);
  }

  const runCount = new Set(rows.map((row) => row.runId)).size;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search steps, actors, activities"
          className="flex-1"
        />
        <button onClick={handleDownload} className={secondaryButtonClass}>
          <Download className="h-4 w-4" />
          Download CSV
        </button>
      </div>

      <p className="text-xs text-muted-foreground tabular-nums">
        {visible.length} of {rows.length} records
        {runCount > 1 && ` · ${runCount} runs (this run and the runs it started)`}
      </p>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        <table className="w-full min-w-[960px] text-xs">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr className="border-b">
              {COLUMNS.map((column) => (
                <th key={column} className="px-3 py-2 text-left font-medium whitespace-nowrap">{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-muted-foreground">
                  No records match “{query.trim()}”.
                </td>
              </tr>
            )}
            {visible.map((row, index) => (
              <tr key={row.eventId || `${row.runId}-${row.timestamp}-${index}`} className="border-b last:border-0 align-top hover:bg-muted/30">
                <td className="px-3 py-2 whitespace-nowrap tabular-nums text-muted-foreground">
                  {format(new Date(row.timestamp), 'yyyy-MM-dd HH:mm:ss')}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {row.runId === currentRunId ? (
                    row.runName
                  ) : (
                    <Link
                      href={routes.workflowRun(handle, row.runName, row.runId)}
                      className="font-medium text-primary hover:underline"
                    >
                      {row.runName}
                    </Link>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap font-mono">
                  {row.stepId === '' ? <span className="text-muted-foreground">—</span> : row.stepId}
                  {row.nextStepId !== '' && (
                    <span className="text-muted-foreground">
                      <ArrowRight className="mx-1 inline h-3 w-3" />
                      {row.nextStepId}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 min-w-[220px]">
                  {row.activity}
                  <code className="mt-0.5 block font-mono text-[10px] text-muted-foreground">{row.action}</code>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="font-medium">{row.actorName}</span>
                  <span className="block text-[10px] text-muted-foreground">{row.actorType}</span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{row.actorRole}</td>
                <td className="px-3 py-2 min-w-[200px] text-muted-foreground">{row.basis}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
