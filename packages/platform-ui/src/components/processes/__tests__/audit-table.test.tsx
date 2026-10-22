/**
 * The table answers "what went where, when, by whom" across a run and the runs
 * it started, without the engine's own dispatch chatter, and exports as CSV.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Papa from 'papaparse';
import type { AuditEvent } from '@mediforce/platform-core';
import type { RunAuditEvent, RunRef } from '@/hooks/use-run-tree-audit-events';
import { AuditTable, auditRowsToCsv, toAuditRows } from '../audit-table';

function event(overrides: Partial<AuditEvent>): AuditEvent {
  return {
    actorId: 'auto-runner',
    actorType: 'system',
    actorRole: 'orchestrator',
    action: 'step.completed',
    description: '',
    timestamp: '2026-01-01T09:00:00.000Z',
    inputSnapshot: {},
    outputSnapshot: {},
    basis: '',
    entityType: 'processInstance',
    entityId: 'run-parent',
    ...overrides,
  };
}

const parent: RunRef = { id: 'run-parent', definitionName: 'orchestrator', status: 'completed' };
const child: RunRef = { id: 'run-child', definitionName: 'review', status: 'completed' };

const entries: RunAuditEvent[] = [
  { run: parent, event: event({ id: 'e1', action: 'process.run.step.started', description: 'Auto-runner dispatching' }) },
  {
    run: parent,
    event: event({
      id: 'e2',
      stepId: 'open_case',
      description: "step.completed on step 'open_case' of instance 'run-parent'",
      outputSnapshot: { next: 'run_review', reason: 'Unconditional transition' },
      basis: 'Unconditional transition',
      timestamp: '2026-01-01T09:00:01.000Z',
    }),
  },
  {
    run: child,
    event: event({
      id: 'e3',
      action: 'task.completed',
      actorType: 'user',
      actorId: 'uid-42',
      actorRole: 'operator',
      description: "Task 't-1' resolved with verdict 'request_correction'",
      inputSnapshot: { stepId: 'cra_decision', verdict: 'request_correction' },
      basis: 'Task resolved via API',
      timestamp: '2026-01-01T09:00:02.000Z',
    }),
  },
];

const names = new Map([['uid-42', 'Ada Lovelace']]);

describe('toAuditRows', () => {
  it('drops dispatch plumbing and keeps where the run went', () => {
    const rows = toAuditRows(entries, names);
    expect(rows.map((row) => row.eventId)).toEqual(['e2', 'e3']);
    expect(rows[0]).toMatchObject({
      runName: 'orchestrator',
      stepId: 'open_case',
      nextStepId: 'run_review',
      activity: 'step.completed on step open_case',
      actorType: 'System',
    });
  });

  it('names human actors and reads the step from a task snapshot', () => {
    const [, task] = toAuditRows(entries, names);
    expect(task).toMatchObject({
      runId: 'run-child',
      stepId: 'cra_decision',
      actorName: 'Ada Lovelace',
      actorId: 'uid-42',
      actorType: 'Human',
    });
  });
});

describe('auditRowsToCsv', () => {
  it('writes one record per row with a header', () => {
    const csv = auditRowsToCsv(toAuditRows(entries, names));
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true });
    expect(parsed.meta.fields).toEqual([
      'timestamp', 'workflow', 'runId', 'step', 'nextStep', 'activity', 'action',
      'actor', 'actorId', 'actorType', 'role', 'basis', 'eventId',
    ]);
    expect(parsed.data).toHaveLength(2);
    expect(parsed.data[1]).toMatchObject({ workflow: 'review', actor: 'Ada Lovelace', step: 'cra_decision' });
  });
});

describe('AuditTable', () => {
  function renderTable() {
    return render(
      <AuditTable entries={entries} loading={false} error={null} currentRunId="run-parent" memberNames={names} handle="acme" />,
    );
  }

  it('links rows from child runs to their run page', () => {
    renderTable();
    expect(screen.getByRole('link', { name: 'review' })).toHaveAttribute('href', '/acme/workflows/review/runs/run-child');
    expect(screen.queryByRole('link', { name: 'orchestrator' })).toBeNull();
    expect(screen.getByText('2 of 2 records · 2 runs (this run and the runs it started)')).toBeInTheDocument();
  });

  it('links a child run in another namespace to that namespace', () => {
    const elsewhere = entries.map((entry) => entry.run === child ? { ...entry, run: { ...child, namespace: 'partner' } } : entry);
    render(
      <AuditTable entries={elsewhere} loading={false} error={null} currentRunId="run-parent" memberNames={names} handle="acme" />,
    );
    expect(screen.getByRole('link', { name: 'review' })).toHaveAttribute('href', '/partner/workflows/review/runs/run-child');
  });

  it('filters rows by search', async () => {
    renderTable();
    await userEvent.type(screen.getByPlaceholderText('Search steps, actors, activities'), 'ada');
    expect(screen.getByText('1 of 2 records · 2 runs (this run and the runs it started)')).toBeInTheDocument();
    expect(screen.queryByText('open_case')).toBeNull();
  });
});
