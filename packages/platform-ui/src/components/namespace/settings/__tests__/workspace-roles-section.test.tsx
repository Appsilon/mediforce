import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { NamespaceMemberDetail } from '@/hooks/use-namespace-members';
import type { UseWorkspaceRolesResult } from '@/hooks/use-workspace-roles';
import { WorkspaceRolesSection } from '../workspace-roles-section';

const setMemberRolesMock = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-namespace-mutations', () => ({
  useSetMemberRoles: () => ({ mutateAsync: setMemberRolesMock }),
}));

const workspaceRolesMock = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-workspace-roles', () => ({
  useWorkspaceRoles: () => workspaceRolesMock(),
}));

/** A resolved vocabulary — what every test gets unless it asks for another. */
const WORKSPACE_ROLES: UseWorkspaceRolesResult = {
  roles: ['reviewer'],
  workflowNames: ['otherflow', 'tealflow'],
  heldRoles: null,
  loading: false,
  error: null,
};

function member(
  uid: string,
  displayName: string,
  grants: NamespaceMemberDetail['grants'],
): NamespaceMemberDetail {
  return {
    id: uid,
    uid,
    role: 'member',
    displayName,
    email: null,
    lastSignInTime: null,
    joinedAt: '2026-01-01T00:00:00.000Z',
    grants,
  };
}

const MEMBERS = [
  member('uid-alice', 'Alice', [
    { role: 'reviewer', workflowName: null },
    { role: 'approver', workflowName: 'tealflow' },
  ]),
  member('uid-bob', 'Bob', []),
];

/** 20 members holding two roles each — enough to page and filter over. */
const MANY: NamespaceMemberDetail[] = Array.from({ length: 20 }, (_, index) =>
  member(`uid-${index}`, `Member ${index}`, [
    { role: 'reviewer', workflowName: null },
    { role: 'approver', workflowName: 'tealflow' },
  ]),
);

function renderSection(overrides: Partial<React.ComponentProps<typeof WorkspaceRolesSection>> = {}) {
  const onError = vi.fn();
  render(
    <WorkspaceRolesSection
      handle="acme"
      members={MEMBERS}
      canManageMembers
      onError={onError}
      {...overrides}
    />,
  );
  return { onError };
}

/** Toggle one workflow inside the named checkbox group. */
function toggleWorkflow(groupLabel: string, workflow: string) {
  const group = screen.getByRole('group', { name: groupLabel });
  fireEvent.click(within(group).getByRole('checkbox', { name: workflow }));
}

/** The visible cells of every data row, in order. */
function rowTexts(): string[][] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => [...row.querySelectorAll('td')].slice(0, 3).map((cell) => cell.textContent ?? ''));
}

describe('WorkspaceRolesSection', () => {
  beforeEach(() => {
    setMemberRolesMock.mockReset();
    setMemberRolesMock.mockResolvedValue(undefined);
    workspaceRolesMock.mockReset();
    workspaceRolesMock.mockReturnValue(WORKSPACE_ROLES);
  });

  it('gives every assignment its own row, so member ↔ role ↔ workflows never has to be inferred', () => {
    renderSection();

    expect(rowTexts()).toEqual([
      ['Alice', 'approver', 'tealflow'],
      ['Alice', 'reviewer', 'All workflows'],
    ]);
  });

  it('collapses one role held on several workflows into a single row', () => {
    renderSection({
      members: [
        member('uid-alice', 'Alice', [
          { role: 'reviewer', workflowName: 'tealflow' },
          { role: 'reviewer', workflowName: 'otherflow' },
        ]),
      ],
    });

    // One role, two workflows — not two rows both reading `reviewer`.
    expect(rowTexts()).toEqual([['Alice', 'reviewer', 'otherflowtealflow']]);
  });

  it('reads a role as unnarrowed when a workspace-wide grant sits beside a narrowed one', () => {
    renderSection({
      members: [
        member('uid-alice', 'Alice', [
          { role: 'reviewer', workflowName: null },
          { role: 'reviewer', workflowName: 'tealflow' },
        ]),
      ],
    });

    // The NULL already covers every workflow, so naming `tealflow` would claim
    // a limit that is not in force.
    expect(rowTexts()).toEqual([['Alice', 'reviewer', 'All workflows']]);
  });

  it('says so plainly when nobody holds a role yet', () => {
    renderSection({ members: [member('uid-bob', 'Bob', [])] });

    expect(screen.getByText('No roles assigned yet.')).toBeInTheDocument();
  });

  it('gives a non-admin the roster with no controls', () => {
    renderSection({ canManageMembers: false });

    // Alice holds two roles, so she owns two rows — that is the shape.
    expect(screen.getAllByText('Alice')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /assign role/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /remove reviewer from alice/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /edit workflows/i })).toBeNull();
  });

  it('assigns a role across several workflows in one write', async () => {
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: /assign role/i }));
    fireEvent.change(screen.getByLabelText('Member to assign a role to'), {
      target: { value: 'uid-bob' },
    });
    fireEvent.change(screen.getByLabelText('Role to assign'), { target: { value: 'PI' } });
    toggleWorkflow('Workflows for the new role', 'tealflow');
    toggleWorkflow('Workflows for the new role', 'otherflow');
    fireEvent.click(screen.getByRole('button', { name: 'Grant' }));

    // The point of the multi-select: `PI` on two workflows is one act, not two
    // separate picks of the same role.
    await waitFor(() =>
      expect(setMemberRolesMock).toHaveBeenCalledWith({
        handle: 'acme',
        uid: 'uid-bob',
        grants: [
          { role: 'PI', workflowName: 'otherflow' },
          { role: 'PI', workflowName: 'tealflow' },
        ],
      }),
    );
  });

  it('defaults a new assignment to the whole workspace', async () => {
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: /assign role/i }));
    fireEvent.change(screen.getByLabelText('Member to assign a role to'), {
      target: { value: 'uid-bob' },
    });
    fireEvent.change(screen.getByLabelText('Role to assign'), { target: { value: 'PI' } });
    fireEvent.click(screen.getByRole('button', { name: 'Grant' }));

    await waitFor(() =>
      expect(setMemberRolesMock).toHaveBeenCalledWith({
        handle: 'acme',
        uid: 'uid-bob',
        grants: [{ role: 'PI', workflowName: null }],
      }),
    );
  });

  it('accepts a role no workflow declares yet', async () => {
    // The vocabulary is open by construction (ADR-0019) — the pick-list is a
    // suggestion, and granting a role before any workflow names it is the
    // ordinary first move.
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: /assign role/i }));
    fireEvent.change(screen.getByLabelText('Member to assign a role to'), {
      target: { value: 'uid-bob' },
    });
    fireEvent.change(screen.getByLabelText('Role to assign'), {
      target: { value: 'biostatistician' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Grant' }));

    await waitFor(() =>
      expect(setMemberRolesMock).toHaveBeenCalledWith(
        expect.objectContaining({ grants: [{ role: 'biostatistician', workflowName: null }] }),
      ),
    );
  });

  it('states workspace-wide as a checked option rather than leaving it inferred', () => {
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Edit workflows for reviewer for Alice' }));
    const group = screen.getByRole('group', { name: 'Workflows for reviewer for Alice' });

    // `reviewer` is unnarrowed, and the control says so out loud instead of
    // leaving the reader to infer it from an empty list.
    expect(within(group).getByRole('checkbox', { name: 'All workflows' })).toBeChecked();
    expect(within(group).getByRole('checkbox', { name: 'tealflow' })).not.toBeChecked();
  });

  it('clears All once a workflow is named, and will not uncheck into nothing', () => {
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Edit workflows for reviewer for Alice' }));
    const label = 'Workflows for reviewer for Alice';
    const all = () =>
      within(screen.getByRole('group', { name: label })).getByRole('checkbox', {
        name: 'All workflows',
      });

    toggleWorkflow(label, 'tealflow');
    expect(all()).not.toBeChecked();

    // Back to workspace-wide, then a no-op: "no workflows at all" is not a
    // grant this model can express, so the only way out is naming a workflow.
    toggleWorkflow(label, 'All workflows');
    expect(all()).toBeChecked();
    toggleWorkflow(label, 'All workflows');
    expect(all()).toBeChecked();
  });

  it('locks the last named workflow, so narrowing cannot fall through into workspace-wide', async () => {
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Edit workflows for approver for Alice' }));
    const label = 'Workflows for approver for Alice';
    const tealflow = () =>
      within(screen.getByRole('group', { name: label })).getByRole('checkbox', {
        name: 'tealflow',
      });

    // `approver` is narrowed to `tealflow` alone. Unchecking it would empty the
    // list, and an empty list is what the write reads as workspace-wide — so
    // the gesture that looks like narrowing further would grant the role
    // everywhere. Revoking is the row's X, not the last checkbox.
    expect(tealflow()).toBeDisabled();
    fireEvent.click(tealflow());
    expect(tealflow()).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(setMemberRolesMock).not.toHaveBeenCalled());
  });

  it('holds the write controls until the workflow list resolves', () => {
    workspaceRolesMock.mockReturnValue({
      roles: [],
      workflowNames: [],
      loading: true,
      error: null,
    });
    renderSection();

    // Granting now would write the widest grant there is, because the narrower
    // choices have not rendered yet.
    expect(screen.getByRole('button', { name: /assign role/i })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Edit workflows for approver for Alice' }),
    ).toBeDisabled();
  });

  it('says the workflow list failed rather than offering a workspace-wide grant', () => {
    workspaceRolesMock.mockReturnValue({
      roles: [],
      workflowNames: [],
      loading: false,
      error: new Error('boom'),
    });
    renderSection();

    // An empty scope list means two different things — "no workflows here" and
    // "we could not find out" — and only one of them makes All workflows the
    // honest answer.
    expect(screen.getByRole('status')).toHaveTextContent(/could not load/i);
    expect(screen.getByRole('button', { name: /assign role/i })).toBeDisabled();
  });

  it('opens the scope control on what the row already holds', () => {
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Edit workflows for approver for Alice' }));
    const group = screen.getByRole('group', { name: 'Workflows for approver for Alice' });

    // Editing starts from the current grant, never from a blank slate — a
    // blank one would silently widen the role on the next save.
    expect(within(group).getByRole('checkbox', { name: 'tealflow' })).toBeChecked();
    expect(within(group).getByRole('checkbox', { name: 'otherflow' })).not.toBeChecked();
  });

  it('re-narrows one row without disturbing the member’s other roles', async () => {
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Edit workflows for approver for Alice' }));
    // The control opens on what the row already holds, so re-narrowing means
    // unchecking `tealflow` as well as checking `otherflow` — in that order,
    // because the last named workflow is locked until a replacement is picked.
    toggleWorkflow('Workflows for approver for Alice', 'otherflow');
    toggleWorkflow('Workflows for approver for Alice', 'tealflow');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    // A full replace names the member's whole end state, so the untouched
    // `reviewer` grant has to travel with it or the save would revoke it.
    await waitFor(() =>
      expect(setMemberRolesMock).toHaveBeenCalledWith({
        handle: 'acme',
        uid: 'uid-alice',
        grants: [
          { role: 'reviewer', workflowName: null },
          { role: 'approver', workflowName: 'otherflow' },
        ],
      }),
    );
  });

  it('widens a narrowed role back to the workspace via the All option', async () => {
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Edit workflows for approver for Alice' }));
    toggleWorkflow('Workflows for approver for Alice', 'All workflows');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(setMemberRolesMock).toHaveBeenCalledWith({
        handle: 'acme',
        uid: 'uid-alice',
        grants: [
          { role: 'reviewer', workflowName: null },
          { role: 'approver', workflowName: null },
        ],
      }),
    );
  });

  it('drops every grant of a role when its row is removed', async () => {
    renderSection({
      members: [
        member('uid-alice', 'Alice', [
          { role: 'reviewer', workflowName: 'tealflow' },
          { role: 'reviewer', workflowName: 'otherflow' },
          { role: 'approver', workflowName: null },
        ]),
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remove reviewer from Alice' }));

    // One row, one removal — both `reviewer` grants go.
    await waitFor(() =>
      expect(setMemberRolesMock).toHaveBeenCalledWith({
        handle: 'acme',
        uid: 'uid-alice',
        grants: [{ role: 'approver', workflowName: null }],
      }),
    );
  });

  it('filters on member and role together', () => {
    renderSection({ members: MANY });

    fireEvent.change(screen.getByLabelText('Filter by member'), { target: { value: 'member 1' } });
    // Substring, case-insensitive: `member 1` also matches Member 10..19.
    expect(rowTexts().every((cells) => cells[0]?.startsWith('Member 1'))).toBe(true);

    fireEvent.change(screen.getByLabelText('Filter by role'), { target: { value: 'REVIEW' } });
    expect(rowTexts().every((cells) => cells[1] === 'reviewer')).toBe(true);
    expect(rowTexts().length).toBeGreaterThan(0);
  });

  it('says so when the filters match nothing, and offers the way back', () => {
    renderSection({ members: MANY });

    fireEvent.change(screen.getByLabelText('Filter by role'), { target: { value: 'nonesuch' } });
    expect(screen.getByText('No roles match these filters.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.queryByText('No roles match these filters.')).toBeNull();
  });

  it('pages the roster and reports the range it is showing', () => {
    renderSection({ members: MANY });

    // 20 members x 2 roles = 40 assignments, 10 to a page by default.
    expect(rowTexts()).toHaveLength(10);
    expect(screen.getByText('1–10 of 40')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('11–20 of 40')).toBeInTheDocument();
    expect(screen.getByText('2 / 4')).toBeInTheDocument();
  });

  it('honours the chosen page size', () => {
    renderSection({ members: MANY });

    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '50' } });

    expect(rowTexts()).toHaveLength(40);
    expect(screen.getByText('1–40 of 40')).toBeInTheDocument();
  });

  it('returns to the first page when a filter narrows the roster', () => {
    renderSection({ members: MANY });

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('2 / 4')).toBeInTheDocument();

    // Staying on page 2 of a now-shorter list is how a filter looks broken.
    fireEvent.change(screen.getByLabelText('Filter by role'), { target: { value: 'reviewer' } });
    expect(screen.getByText('1–10 of 20')).toBeInTheDocument();
  });

  it('keeps the pager reachable once the largest page size is chosen', () => {
    renderSection({ members: MANY });

    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '100' } });

    // One page of 40 — the control that gets back to 10 must not vanish.
    expect(screen.getByLabelText('Rows per page')).toBeInTheDocument();
  });

  it('surfaces a failed write instead of leaving the row looking saved', async () => {
    setMemberRolesMock.mockRejectedValueOnce(new Error('nope'));
    const { onError } = renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Remove reviewer from Alice' }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith('nope'));
  });
});
