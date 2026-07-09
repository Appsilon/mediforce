import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
import { TableEditorView } from '../table-editor-view';

const completeMock = vi.mocked(mediforce.tasks.complete);

const CATEGORY_OPTIONS = [
  { id: 'ux', label: 'UX' },
  { id: 'tech-debt', label: 'Tech debt' },
  { id: 'infra', label: 'Infra' },
  { id: 'security', label: 'Security' },
  { id: 'product', label: 'Product' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'engine', label: 'Engine' },
  { id: 'bug', label: 'Bug' },
  { id: 'enhancement', label: 'Enhancement' },
];

const PRIORITY_OPTIONS = [
  { id: 'P0', label: 'P0' },
  { id: 'P1', label: 'P1' },
  { id: 'P2', label: 'P2' },
  { id: 'P3', label: 'P3' },
];

function buildTableEditorTask(overrides: {
  items?: Record<string, unknown>[];
  columns?: Record<string, unknown>[];
  config?: Record<string, unknown>;
  status?: HumanTask['status'];
  completionData?: HumanTask['completionData'];
} = {}): HumanTask {
  const items = overrides.items ?? [
    { id: '101', label: '#101 Fix login bug', badges: ['bug'], href: 'https://gh/101', suggestion: { category: 'ux', priority: 'P1' } },
    { id: '102', label: '#102 Add CSV export', badges: ['enhancement', 'ux'], suggestion: { category: 'tech-debt', priority: 'P3' } },
  ];
  const columns = overrides.columns ?? [
    { id: 'issue', kind: 'static', label: 'Issue', field: 'label', link: true },
    { id: 'existing', kind: 'static', label: 'Existing labels', field: 'badges' },
    { id: 'category', kind: 'single-select', label: 'Category', allowEmpty: false, options: CATEGORY_OPTIONS },
    { id: 'priority', kind: 'single-select', label: 'Priority', default: 'P2', options: PRIORITY_OPTIONS },
  ];
  return buildHumanTask({
    status: overrides.status ?? 'claimed',
    assignedUserId: 'user-1',
    ui: {
      component: 'table-editor',
      config: {
        submitLabel: 'Apply tags',
        columns,
        ...overrides.config,
      },
    },
    options: items,
    completionData: overrides.completionData ?? null,
  });
}

describe('TableEditorView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('[RENDER] one row per item with static field text', () => {
    render(<TableEditorView task={buildTableEditorTask()} />);

    expect(screen.getByText('#101 Fix login bug')).toBeInTheDocument();
    expect(screen.getByText('#102 Add CSV export')).toBeInTheDocument();
  });

  it('[RENDER] static array field renders each entry as a chip', () => {
    render(<TableEditorView task={buildTableEditorTask()} />);

    // #102 carries two existing labels
    expect(screen.getByText('enhancement')).toBeInTheDocument();
    expect(screen.getAllByText('ux').length).toBeGreaterThan(0);
  });

  it('[RENDER] static string field links to item.href when present', () => {
    render(<TableEditorView task={buildTableEditorTask()} />);

    const link = screen.getByRole('link', { name: '#101 Fix login bug' });
    expect(link).toHaveAttribute('href', 'https://gh/101');
  });

  it('[RENDER] single-select lists all configured options', () => {
    render(<TableEditorView task={buildTableEditorTask()} />);

    const categorySelects = screen.getAllByLabelText(/category/i);
    expect(categorySelects).toHaveLength(2);
    const labels = within(categorySelects[0]).getAllByRole('option').map((o) => o.textContent);
    expect(labels).toEqual(expect.arrayContaining(['UX', 'Tech debt', 'Security', 'Enhancement']));
  });

  it('[RENDER] pre-fills cells from option.suggestion keyed by column id', () => {
    render(<TableEditorView task={buildTableEditorTask({
      items: [{ id: '201', label: '#201 Refactor', suggestion: { category: 'security', priority: 'P0' } }],
    })} />);

    expect(screen.getByLabelText(/category/i)).toHaveValue('security');
    expect(screen.getByLabelText(/priority/i)).toHaveValue('P0');
  });

  it('[RENDER] single-select falls back to column default when no suggestion', () => {
    render(<TableEditorView task={buildTableEditorTask({
      items: [{ id: '301', label: '#301 No hints' }],
    })} />);

    // no suggestion → priority uses its default, category has none
    expect(screen.getByLabelText(/priority/i)).toHaveValue('P2');
    expect(screen.getByLabelText(/category/i)).toHaveValue('');
  });

  it('[RENDER] warns and clears an out-of-range single-select suggestion', () => {
    render(<TableEditorView task={buildTableEditorTask({
      items: [{ id: '401', label: '#401 Bad hint', suggestion: { category: 'ghost', priority: 'P1' } }],
    })} />);

    expect(screen.getByText(/suggestion 'ghost' not in allowlist/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/category/i)).toHaveValue('');
  });

  it('[VALIDATION] allowEmpty:false blocks submit until every row has a value', async () => {
    const user = userEvent.setup();
    render(<TableEditorView task={buildTableEditorTask({
      items: [{ id: '501', label: '#501 Untriaged' }],
    })} />);

    const submit = screen.getByRole('button', { name: /apply tags/i });
    expect(submit).toBeDisabled();

    await user.selectOptions(screen.getByLabelText(/category/i), 'bug');
    expect(submit).toBeEnabled();
  });

  it('[CLICK] submits rows with stable per-cell values map', async () => {
    const user = userEvent.setup();
    render(<TableEditorView task={buildTableEditorTask({
      items: [
        { id: '601', label: '#601 First', suggestion: { category: 'ux', priority: 'P1' } },
        { id: '602', label: '#602 Second', suggestion: { category: 'tech-debt', priority: 'P3' } },
      ],
    })} />);

    await user.click(screen.getByRole('button', { name: /apply tags/i }));

    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(completeMock).toHaveBeenCalledWith({
      taskId: expect.any(String),
      payload: {
        kind: 'rows',
        rows: [
          { itemId: '601', values: { category: 'ux', priority: 'P1' } },
          { itemId: '602', values: { category: 'tech-debt', priority: 'P3' } },
        ],
      },
    });
  });

  it('[CLICK] edits to a cell are reflected in the submitted values', async () => {
    const user = userEvent.setup();
    render(<TableEditorView task={buildTableEditorTask({
      items: [{ id: '701', label: '#701 Edit me', suggestion: { category: 'ux', priority: 'P2' } }],
    })} />);

    await user.selectOptions(screen.getByLabelText(/category/i), 'security');
    await user.selectOptions(screen.getByLabelText(/priority/i), 'P0');
    await user.click(screen.getByRole('button', { name: /apply tags/i }));

    const [input] = completeMock.mock.calls[0];
    const payload = (input as { payload: { rows: { values: Record<string, unknown> }[] } }).payload;
    expect(payload.rows[0].values).toEqual({
      category: 'security',
      priority: 'P0',
    });
  });

  it('[RENDER] text column renders an input and flows into output', async () => {
    const user = userEvent.setup();
    render(<TableEditorView task={buildTableEditorTask({
      items: [{ id: '801', label: '#801 With note' }],
      columns: [
        { id: 'issue', kind: 'static', label: 'Issue', field: 'label' },
        { id: 'note', kind: 'text', label: 'Note', placeholder: 'optional' },
      ],
    })} />);

    await user.type(screen.getByLabelText(/note/i), 'needs design input');
    await user.click(screen.getByRole('button', { name: /apply tags/i }));

    const [input] = completeMock.mock.calls[0];
    const payload = (input as { payload: { rows: { values: Record<string, unknown> }[] } }).payload;
    expect(payload.rows[0].values).toEqual({
      note: 'needs design input',
    });
  });

  it('[RENDER] multi-select renders checkboxes that toggle into an array', async () => {
    const user = userEvent.setup();
    render(<TableEditorView task={buildTableEditorTask({
      items: [{ id: '901', label: '#901 Pick many' }],
      columns: [
        { id: 'issue', kind: 'static', label: 'Issue', field: 'label' },
        {
          id: 'tags',
          kind: 'multi-select',
          label: 'Tags',
          options: [
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' },
            { id: 'c', label: 'Gamma' },
          ],
        },
      ],
    })} />);

    await user.click(screen.getByLabelText(/alpha/i));
    await user.click(screen.getByLabelText(/gamma/i));
    await user.click(screen.getByRole('button', { name: /apply tags/i }));

    const [input] = completeMock.mock.calls[0];
    const payload = (input as { payload: { rows: { values: Record<string, unknown> }[] } }).payload;
    expect(payload.rows[0].values).toEqual({
      tags: ['a', 'c'],
    });
  });

  it('[RENDER] empty items list disables submit and shows empty state', () => {
    render(<TableEditorView task={buildTableEditorTask({ items: [] })} />);

    expect(screen.getByText(/no items/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /apply tags/i })).toBeDisabled();
  });

  it('[RENDER] completed task summarises submitted rows', () => {
    render(<TableEditorView task={buildTableEditorTask({
      status: 'completed',
      completionData: {
        rows: [
          { itemId: '1001', values: { category: 'ux', priority: 'P0' } },
        ],
        completedBy: 'user-1',
        completedAt: '2026-05-22T10:00:00.000Z',
      },
    })} />);

    expect(screen.getByText(/1 row/i)).toBeInTheDocument();
    expect(screen.getByText('1001')).toBeInTheDocument();
  });
});
