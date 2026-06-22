import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildHumanTask } from '@mediforce/platform-core/testing';
import type { HumanTask } from '@mediforce/platform-core';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

vi.mock('@/lib/mediforce', () => ({
  mediforce: {
    tasks: {
      complete: vi.fn(async () => ({ task: {}, run: {} })),
    },
  },
}));

import { mediforce } from '@/lib/mediforce';
import { deriveInitials } from '@/lib/format';
import { TableEditorView } from '../table-editor-view';
import type { ColumnSpec } from '../table-editor-view';

const completeMock = vi.mocked(mediforce.tasks.complete);

function buildAvatarTask(
  overrides: { items?: Record<string, unknown>[]; columns?: ColumnSpec[]; status?: HumanTask['status'] } = {},
): HumanTask {
  const columns: ColumnSpec[] = overrides.columns ?? [
    { id: 'avatar', kind: 'avatar', label: 'Photo', field: 'photoUrl', fallbackField: 'name' },
    { id: 'name-col', kind: 'static', label: 'Name', field: 'name' },
    {
      id: 'role',
      kind: 'single-select',
      label: 'Role',
      options: [
        { id: 'dev', label: 'Dev' },
        { id: 'pm', label: 'PM' },
      ],
    },
  ];
  const items = overrides.items ?? [
    { id: 'u1', label: 'Alice', name: 'Alice Wonderland', photoUrl: 'https://example.com/alice.jpg' },
    { id: 'u2', label: 'Bob', name: 'Bob Builder', photoUrl: '' },
    { id: 'u3', label: 'Eve', name: 'Eve' },
  ];
  return buildHumanTask({
    status: overrides.status ?? 'claimed',
    assignedUserId: 'user-1',
    ui: { component: 'table-editor', config: { submitLabel: 'Save', columns } },
    options: items,
  });
}

// ── deriveInitials ──────────────────────────────────────────────────────────

describe('deriveInitials', () => {
  it('returns first+last initials for two-word name', () => {
    expect(deriveInitials('Alice Wonderland')).toBe('AW');
  });

  it('returns first two chars for one-word name', () => {
    expect(deriveInitials('Eve')).toBe('EV');
    expect(deriveInitials('E')).toBe('E');
  });

  it('picks first and last word for multi-word names', () => {
    expect(deriveInitials('Jean Luc Picard')).toBe('JP');
  });

  it('trims leading/trailing whitespace', () => {
    expect(deriveInitials('  Alice Wonderland  ')).toBe('AW');
  });

  it('uppercases lowercase input', () => {
    expect(deriveInitials('alice wonderland')).toBe('AW');
  });

  it('returns empty string for empty/whitespace-only input', () => {
    expect(deriveInitials('')).toBe('');
    expect(deriveInitials('   ')).toBe('');
  });
});

// ── AvatarCell rendering ────────────────────────────────────────────────────

describe('AvatarCell rendering via TableEditorView', () => {
  it('renders <img> with correct src, alt, and size when URL is present', () => {
    render(<TableEditorView task={buildAvatarTask()} />);

    const img = screen.getByRole('img', { name: 'Alice Wonderland' });
    expect(img).toHaveAttribute('src', 'https://example.com/alice.jpg');
    expect(img).toHaveAttribute('width', '32');
    expect(img).toHaveAttribute('height', '32');
    expect(img).toHaveClass('rounded-full');
  });

  it('renders initials div when URL is empty string', () => {
    render(<TableEditorView task={buildAvatarTask()} />);

    expect(screen.getByText('BB')).toBeInTheDocument();
  });

  it('renders initials div when URL field is undefined', () => {
    render(
      <TableEditorView
        task={buildAvatarTask({
          items: [{ id: 'u4', label: 'Dana', name: 'Dana Scully' }],
        })}
      />,
    );

    expect(screen.getByText('DS')).toBeInTheDocument();
  });

  it('renders "?" when no URL and no fallback field', () => {
    render(
      <TableEditorView
        task={buildAvatarTask({
          columns: [
            { id: 'avatar', kind: 'avatar', label: 'Photo', field: 'photoUrl' },
            { id: 'role', kind: 'single-select', label: 'Role', options: [{ id: 'dev', label: 'Dev' }] },
          ],
          items: [{ id: 'u5', label: 'Unknown' }],
        })}
      />,
    );

    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('applies custom size to the avatar', () => {
    render(
      <TableEditorView
        task={buildAvatarTask({
          columns: [
            { id: 'avatar', kind: 'avatar', label: 'Photo', field: 'photoUrl', fallbackField: 'name', size: 48 },
            { id: 'role', kind: 'single-select', label: 'Role', options: [{ id: 'dev', label: 'Dev' }] },
          ],
          items: [{ id: 'u6', label: 'Fox', name: 'Fox Mulder', photoUrl: 'https://example.com/fox.jpg' }],
        })}
      />,
    );

    const img = screen.getByRole('img', { name: 'Fox Mulder' });
    expect(img).toHaveAttribute('width', '48');
    expect(img).toHaveAttribute('height', '48');
  });

  it('applies custom size to the initials fallback div', () => {
    render(
      <TableEditorView
        task={buildAvatarTask({
          columns: [
            { id: 'avatar', kind: 'avatar', label: 'Photo', field: 'photoUrl', fallbackField: 'name', size: 64 },
            { id: 'role', kind: 'single-select', label: 'Role', options: [{ id: 'dev', label: 'Dev' }] },
          ],
          items: [{ id: 'u7', label: 'Walter', name: 'Walter Skinner' }],
        })}
      />,
    );

    const initialsDiv = screen.getByText('WS');
    expect(initialsDiv).toHaveStyle({ width: '64px', height: '64px' });
  });
});

// ── Avatar column excluded from output ──────────────────────────────────────

describe('Avatar column excluded from output', () => {
  it('avatar column values do not appear in submitted rows', async () => {
    const user = userEvent.setup();
    render(
      <TableEditorView
        task={buildAvatarTask({
          items: [{ id: 'u1', label: 'Alice', name: 'Alice Wonderland', photoUrl: 'https://example.com/alice.jpg' }],
        })}
      />,
    );

    await user.selectOptions(screen.getByLabelText(/role/i), 'dev');
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(completeMock).toHaveBeenCalledTimes(1);
    const payload = completeMock.mock.calls[0][0] as {
      payload: { rows: { itemId: string; values: Record<string, unknown> }[] };
    };
    const row = payload.payload.rows[0];
    expect(row.values).toEqual({ role: 'dev' });
    expect(row.values).not.toHaveProperty('avatar');
  });
});
