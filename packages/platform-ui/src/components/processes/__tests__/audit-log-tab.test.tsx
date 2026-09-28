/**
 * The trail is read by someone reviewing a run after the fact: the decisions
 * have to stand out, the machinery has to fold away without disappearing, and
 * the whole thing has to open at once for reading top to bottom or printing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AuditEvent } from '@mediforce/platform-core';
import { AuditLogTab, toSpine, describeParts, headlineFor, matchesQuery } from '../audit-log-tab';

function event(overrides: Partial<AuditEvent>): AuditEvent {
  return {
    actorId: 'e2e-test-user',
    actorType: 'user',
    actorRole: 'reviewer',
    action: 'task.viewed',
    description: 'viewed a task',
    timestamp: '2026-01-01T09:00:00.000Z',
    inputSnapshot: {},
    outputSnapshot: {},
    basis: '',
    entityType: 'task',
    entityId: 't-1',
    ...overrides,
  };
}

const approval = event({
  action: 'task.completed',
  actorType: 'user',
  description: 'Approved the generation plan',
  basis: "Verdict 'approve' — sources cited",
  outputSnapshot: { verdict: 'approve' },
  stepId: 'human-review',
});

describe('toSpine', () => {
  it('makes decisions the structure and folds what lies between them', () => {
    const spine = toSpine([
      event({ action: 'process.run.started', actorType: 'system' }),
      event({ action: 'agent.run', actorType: 'agent' }),
      approval,
      event({ action: 'task.viewed' }),
      approval,
    ]);

    expect(spine.map((item) => item.kind)).toEqual(['detail', 'decision', 'detail', 'decision']);
    expect((spine[0] as { events: AuditEvent[] }).events).toHaveLength(2);
  });

  it("keeps the run's own boundaries visible rather than folding them away", () => {
    const spine = toSpine([
      event({ action: 'instance.created', description: 'Created instance' }),
      event({ action: 'process.run.started', actorType: 'system' }),
      event({ action: 'instance.completed', description: 'Run completed' }),
    ]);

    expect(spine.map((item) => item.kind)).toEqual(['milestone', 'detail', 'milestone']);
  });

  it('folds a run of details into one entry, not one per record', () => {
    const spine = toSpine([
      event({ action: 'task.viewed' }),
      event({ action: 'agent.run', actorType: 'agent' }),
      event({ action: 'process.run.started', actorType: 'system' }),
    ]);

    expect(spine).toHaveLength(1);
    expect((spine[0] as { events: AuditEvent[] }).events).toHaveLength(3);
  });
});

describe('AuditLogTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a decision with its basis on the face of it, without being opened', () => {
    render(<AuditLogTab events={[approval]} loading={false} />);

    expect(screen.getByText('Approved the generation plan')).toBeInTheDocument();
    expect(screen.getByText('Decision')).toBeInTheDocument();
    expect(screen.getByText(/sources cited/)).toBeInTheDocument();
  });

  it('collapses what lies between decisions behind a count that names it', () => {
    render(<AuditLogTab events={[event({ action: 'task.viewed' }), event({ action: 'task.created' })]} loading={false} />);

    expect(screen.getByText('2 records')).toBeInTheDocument();
    expect(screen.getByText(/viewed, created/)).toBeInTheDocument();
  });

  it('opens everything at once, and closes it again', async () => {
    const user = userEvent.setup();
    render(<AuditLogTab events={[approval, event({ action: 'task.viewed' })]} loading={false} />);

    const open = () => [...document.querySelectorAll('details')].filter((el) => el.open).length;
    const before = open();

    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(open()).toBeGreaterThan(before);

    // A second press has to work — `<details open>` is only read on mount.
    await user.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(open()).toBe(0);
  });

  it('narrows to decisions, and to one kind of actor', async () => {
    const user = userEvent.setup();
    const agentRun = event({ action: 'agent.run', actorType: 'agent', actorId: 'agent:opencode', description: 'Agent run completed' });
    render(<AuditLogTab events={[approval, agentRun, event({ action: 'task.viewed' })]} loading={false} />);

    const decisionsOnly = screen.getByRole('switch', { name: /Decisions only/ });
    await user.click(decisionsOnly);
    expect(decisionsOnly).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Approved the generation plan')).toBeInTheDocument();
    expect(screen.queryByText('Agent run completed')).not.toBeInTheDocument();

    await user.click(decisionsOnly);
    expect(decisionsOnly).toHaveAttribute('aria-checked', 'false');
    await user.click(screen.getByRole('button', { name: 'Agent' }));
    expect(screen.getByText('Agent run completed')).toBeInTheDocument();
    expect(screen.queryByText('Approved the generation plan')).not.toBeInTheDocument();
  });

  it('prints as its own document, like the report', () => {
    const { container } = render(<AuditLogTab events={[approval]} loading={false} />);
    expect(container.querySelector('[data-print-root]')).not.toBeNull();
  });
});

/**
 * The names inside a description are the content; the words around them are
 * scaffolding. Quoted identifiers get weight so a row can be skimmed for
 * "which workflow, which step" without reading the sentence.
 */
describe('describeParts', () => {
  it('lifts quoted names out of the sentence', () => {
    expect(describeParts("Created instance of 'etymology-checker' v1")).toEqual([
      { text: 'Created instance of ', strong: false },
      { text: 'etymology-checker', strong: true },
      { text: ' v1', strong: false },
    ]);
  });

  it('handles several names in one sentence', () => {
    const parts = describeParts("Human task created for step 'human-review' (reason: 'human_executor')");
    expect(parts.filter((part) => part.strong).map((part) => part.text)).toEqual(['human-review', 'human_executor']);
  });

  it('leaves a sentence with no names alone', () => {
    expect(describeParts('Process resumed after resolving task')).toEqual([
      { text: 'Process resumed after resolving task', strong: false },
    ]);
  });

  it('drops a trailing instance id — the run is the page you are on', () => {
    const parts = describeParts("step.completed on step 'collect-three-words' of instance 'a8e1bf29-1e1f-4421-a3f3-7e4ea6d98fc3'");
    expect(parts.map((part) => part.text).join('')).not.toContain('a8e1bf29');
    expect(parts.filter((part) => part.strong).map((part) => part.text)).toEqual(['collect-three-words']);
  });
});

describe('describeParts and identifiers', () => {
  it('never emphasises a uuid — it is the least meaningful thing in the row', () => {
    const parts = describeParts("Started instance 'a8e1bf29-1e1f-4421-a3f3-7e4ea6d98fc3'");
    expect(parts.some((part) => part.strong)).toBe(false);
  });

  it('shortens a uuid to its leading segment', () => {
    const text = describeParts("Task 'a8658a46-72a5-4f55-ae35-6d4a5e588428' resolved").map((part) => part.text).join('');
    expect(text).toContain('a8658a46');
    expect(text).not.toContain('6d4a5e588428');
  });

  it('still emphasises a real name beside a uuid', () => {
    const parts = describeParts("Task 'a8658a46-72a5-4f55-ae35-6d4a5e588428' resolved for step 'human-review'");
    expect(parts.filter((part) => part.strong).map((part) => part.text)).toEqual(['human-review']);
  });
});

/**
 * A decision's headline is what was decided. The stored description leads with
 * a task uuid — true, and useless as the first thing a reviewer reads.
 */
describe('headlineFor', () => {
  it('leads with the verdict when one was recorded', () => {
    expect(headlineFor(approval)).toBe('Approved');
    expect(headlineFor(event({ action: 'task.completed', outputSnapshot: { verdict: 'revise' } }))).toBe('Sent back for revision');
    expect(headlineFor(event({ action: 'task.completed', outputSnapshot: { verdict: 'escalate' } }))).toBe('Escalated');
  });

  it('falls back to the description when there is no verdict', () => {
    expect(headlineFor(event({ description: 'Created instance of test' }))).toBe('Created instance of test');
  });
});

/**
 * Search is how an auditor finds the one record they were told about — by the
 * step, the person, the action code, or a phrase from the basis.
 */
describe('matchesQuery', () => {
  const record = event({
    action: 'task.completed',
    description: "Approved the plan for step 'human-review'",
    actorId: 'deepansh',
    basis: "Verdict 'approve' — sources cited",
    stepId: 'human-review',
  });

  it('matches everything when the query is empty', () => {
    expect(matchesQuery(record, '')).toBe(true);
    expect(matchesQuery(record, '   ')).toBe(true);
  });

  it('finds a record by description, actor, action code, basis or step', () => {
    for (const query of ['approved the plan', 'deepansh', 'task.completed', 'sources cited', 'human-review']) {
      expect(matchesQuery(record, query)).toBe(true);
    }
  });

  it('ignores case and surrounding space', () => {
    expect(matchesQuery(record, '  APPROVED  ')).toBe(true);
  });

  it('says no when nothing in the record contains the query', () => {
    expect(matchesQuery(record, 'pharmacovigilance')).toBe(false);
  });
});

/**
 * Search has to match what is on the screen. The headline of a decision is
 * derived from the verdict, so searching the words a reader can actually see
 * must find the record that shows them.
 */
describe('matchesQuery and derived text', () => {
  const revised = event({
    action: 'task.completed',
    actorType: 'user',
    description: "Task '3ced98ac-33f5-4b50-8674-1058f3f88b55' resolved with verdict 'revise' for step 'human-review'",
    outputSnapshot: { verdict: 'revise' },
  });

  it('finds a decision by the headline it displays', () => {
    expect(matchesQuery(revised, 'sent back for revision')).toBe(true);
    expect(matchesQuery(revised, 'revision')).toBe(true);
  });

  it('still finds it by the verdict actually stored', () => {
    expect(matchesQuery(revised, 'revise')).toBe(true);
  });

  it('finds an approval by the word on screen', () => {
    expect(matchesQuery(approval, 'approved')).toBe(true);
  });
});
