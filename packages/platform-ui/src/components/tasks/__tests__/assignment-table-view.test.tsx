import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { HumanTask } from '@mediforce/platform-core';
import { buildHumanTask } from '@mediforce/platform-core/testing';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/lib/mediforce', () => ({
  mediforce: {
    tasks: {
      complete: vi.fn(async () => ({ task: {}, run: {} })),
    },
  },
}));

import { mediforce } from '@/lib/mediforce';
import { AssignmentTableView } from '../assignment-table-view';

const completeMock = vi.mocked(mediforce.tasks.complete);

function buildAssignmentTask(overrides: {
  items?: Record<string, unknown>[];
  assignees?: Record<string, unknown>[];
  config?: Record<string, unknown>;
  status?: HumanTask['status'];
  completionData?: HumanTask['completionData'];
} = {}): HumanTask {
  const items = overrides.items ?? [
    { id: '101', label: '#101 Fix login bug', sublabel: 'bug', raw: { issueNumber: 101 } },
    { id: '102', label: '#102 Add CSV export', sublabel: 'enhancement', raw: { issueNumber: 102 } },
  ];
  const assignees = overrides.assignees ?? [
    { id: 'filip', label: 'Filip', kind: 'human', role: 'fullstack' },
    { id: 'marek', label: 'Marek', kind: 'human', role: 'product-owner' },
    { id: 'fullstack-agent', label: 'Fullstack agent', kind: 'agent' },
  ];
  return buildHumanTask({
    status: overrides.status ?? 'claimed',
    assignedUserId: 'user-1',
    ui: {
      component: 'assignment-table',
      config: {
        assignees,
        priorities: ['P0', 'P1', 'P2', 'P3'],
        defaultPriority: 'P2',
        ...overrides.config,
      },
    },
    options: items,
    completionData: overrides.completionData ?? null,
  });
}

describe('AssignmentTableView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('[RENDER] one row per item from task.options', () => {
    const task = buildAssignmentTask();
    render(<AssignmentTableView task={task} />);

    expect(screen.getByText('#101 Fix login bug')).toBeInTheDocument();
    expect(screen.getByText('#102 Add CSV export')).toBeInTheDocument();
  });

  it('[RENDER] surfaces existing labels and current assignee from item fields', () => {
    const task = buildAssignmentTask({
      items: [{
        id: '110',
        label: '#110 Triage me',
        badges: ['bug', 'ux'],
        currentAssignee: 'marek',
        raw: { issueNumber: 110 },
      }],
    });
    render(<AssignmentTableView task={task} />);

    expect(screen.getByText('bug')).toBeInTheDocument();
    expect(screen.getByText('ux')).toBeInTheDocument();
    expect(screen.getByText('marek')).toBeInTheDocument();
  });

  it('[RENDER] assignee dropdown lists all configured assignees', () => {
    const task = buildAssignmentTask();
    render(<AssignmentTableView task={task} />);

    const dropdowns = screen.getAllByLabelText(/assignee/i);
    expect(dropdowns).toHaveLength(2);
    const firstRowOptions = within(dropdowns[0]).getAllByRole('option').map((o) => o.textContent);
    expect(firstRowOptions).toEqual(expect.arrayContaining(['Filip', 'Marek', 'Fullstack agent']));
  });

  it('[RENDER] pre-fills assignee, priority, and note from suggestion', () => {
    const task = buildAssignmentTask({
      items: [{
        id: '201',
        label: '#201 Refactor auth',
        suggestion: { assigneeId: 'filip', priority: 'P1', note: 'Owns the auth module' },
        raw: { issueNumber: 201 },
      }],
    });
    render(<AssignmentTableView task={task} />);

    expect(screen.getByLabelText(/assignee/i)).toHaveValue('filip');
    expect(screen.getByLabelText(/priority/i)).toHaveValue('P1');
    expect(screen.getByLabelText(/note/i)).toHaveValue('Owns the auth module');
  });

  it('[RENDER] shows warning chip when suggestion assigneeId not in allowlist', () => {
    const task = buildAssignmentTask({
      items: [{
        id: '301',
        label: '#301 Add feature',
        suggestion: { assigneeId: 'ghost', priority: 'P2' },
        raw: { issueNumber: 301 },
      }],
    });
    render(<AssignmentTableView task={task} />);

    expect(screen.getByText(/suggestion 'ghost' not in allowlist/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/assignee/i)).toHaveValue('');
  });

  it('[RENDER] empty items list disables submit and shows empty state', () => {
    const task = buildAssignmentTask({ items: [] });
    render(<AssignmentTableView task={task} />);

    expect(screen.getByText(/no items to assign/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /submit|confirm/i })).toBeDisabled();
  });

  it('[CLICK] submits assignments with correct shape', async () => {
    const user = userEvent.setup();
    const task = buildAssignmentTask({
      items: [
        {
          id: '401',
          label: '#401 First',
          suggestion: { assigneeId: 'filip', priority: 'P1', note: 'reason' },
          raw: { issueNumber: 401, title: 'First' },
        },
        {
          id: '402',
          label: '#402 Second',
          suggestion: { assigneeId: 'fullstack-agent', priority: 'P3' },
          raw: { issueNumber: 402 },
        },
      ],
    });
    render(<AssignmentTableView task={task} />);

    await user.click(screen.getByRole('button', { name: /submit|confirm/i }));

    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(completeMock).toHaveBeenCalledWith({
      taskId: task.id,
      payload: {
        kind: 'assignment',
        assignments: [
          {
            itemId: '401',
            assigneeId: 'filip',
            assigneeKind: 'human',
            priority: 'P1',
            note: 'reason',
            raw: { issueNumber: 401, title: 'First' },
          },
          {
            itemId: '402',
            assigneeId: 'fullstack-agent',
            assigneeKind: 'agent',
            priority: 'P3',
            raw: { issueNumber: 402 },
          },
        ],
      },
    });
  });

  it('[CLICK] excludes skipped rows from assignments', async () => {
    const user = userEvent.setup();
    const task = buildAssignmentTask({
      items: [
        { id: '501', label: '#501 Keep', suggestion: { assigneeId: 'filip', priority: 'P2' }, raw: { issueNumber: 501 } },
        { id: '502', label: '#502 Skip', suggestion: { assigneeId: 'marek', priority: 'P2' }, raw: { issueNumber: 502 } },
      ],
    });
    render(<AssignmentTableView task={task} />);

    const dropdowns = screen.getAllByLabelText(/assignee/i);
    await user.selectOptions(dropdowns[1], '__skip__');

    await user.click(screen.getByRole('button', { name: /submit|confirm/i }));

    expect(completeMock).toHaveBeenCalledTimes(1);
    const [input] = completeMock.mock.calls[0];
    const payload = (input as { payload: { assignments: { itemId: string }[] } }).payload;
    expect(payload.assignments).toHaveLength(1);
    expect(payload.assignments[0].itemId).toBe('501');
  });

  it('[RENDER] completed task shows confirmation summary', () => {
    const task = buildAssignmentTask({
      status: 'completed',
      completionData: {
        assignments: [
          { itemId: '601', assigneeId: 'filip', assigneeKind: 'human', priority: 'P0' },
        ],
        completedBy: 'user-1',
        completedAt: '2026-05-22T10:00:00.000Z',
      },
    });
    render(<AssignmentTableView task={task} />);

    expect(screen.getByText(/1 assignment/i)).toBeInTheDocument();
    expect(screen.getByText(/filip/i)).toBeInTheDocument();
  });
});
