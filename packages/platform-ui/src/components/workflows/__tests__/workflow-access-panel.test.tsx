import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { NamespaceMemberDetail } from '@/hooks/use-namespace-members';
import { WorkflowAccessPanel } from '../workflow-access-panel';

const accessMock = vi.hoisted(() => vi.fn());
const saveMock = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-workflow-access', () => ({
  useWorkflowAccess: () => accessMock(),
  useSetWorkflowAccess: () => ({ mutateAsync: saveMock, isPending: false, error: null }),
}));

const namespaceRoleMock = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-namespace-role', () => ({
  useNamespaceRole: () => namespaceRoleMock(),
}));

const membersMock = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-namespace-members', () => ({
  useNamespaceMembers: () => membersMock(),
}));

vi.mock('@/hooks/use-workspace-roles', () => ({
  useWorkspaceRoles: () => ({
    roles: ['reviewer', 'approver'],
    workflowNames: ['tealflow'],
    heldRoles: null,
    loading: false,
    error: null,
  }),
}));

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

function renderPanel() {
  render(<WorkflowAccessPanel handle="acme" workflowName="tealflow" />);
}

describe('WorkflowAccessPanel', () => {
  beforeEach(() => {
    saveMock.mockReset();
    saveMock.mockResolvedValue(undefined);
    namespaceRoleMock.mockReturnValue({ role: 'admin', canAdmin: true, loading: false });
    membersMock.mockReturnValue({
      members: [
        member('uid-alice', 'Alice', [{ role: 'reviewer', workflowName: null }]),
        member('uid-bob', 'Bob', [{ role: 'approver', workflowName: 'otherflow' }]),
      ],
      loading: false,
      resolved: true,
    });
    accessMock.mockReturnValue({
      access: { run: ['reviewer'], edit: [] },
      caller: { mayRun: true, mayEdit: true },
      loading: false,
      error: null,
    });
  });

  it('says an empty gate is open, rather than leaving it blank', () => {
    renderPanel();

    expect(screen.getByText(/Any member of this workspace can change this workflow/)).toBeTruthy();
  });

  it('shows who holds each role for THIS workflow, and who holds nothing', () => {
    renderPanel();

    const holders = within(screen.getByRole('table'));
    expect(holders.getByText('reviewer').closest('tr')?.textContent).toContain('Alice');

    // Bob's `approver` is narrowed to another workflow, so it does not reach
    // this one — the row exists only if a grant that applies here does.
    expect(screen.queryByText('Bob')).toBeNull();
  });

  it('warns when a gated role has no holder here, because the gate is then closed to everyone', () => {
    accessMock.mockReturnValue({
      access: { run: ['nobody-holds-this'], edit: [] },
      caller: { mayRun: false, mayEdit: true },
      loading: false,
      error: null,
    });
    renderPanel();

    expect(screen.getByText(/Nobody holds "nobody-holds-this"/)).toBeTruthy();
  });

  it('saves both lists as one full replace', async () => {
    renderPanel();

    // `edit` is unrestricted, so its list is offered only once the verb is
    // restricted — and restricting it seeds the built-in floor.
    fireEvent.click(screen.getByLabelText('Restrict who can change it'));
    fireEvent.change(screen.getByLabelText('Add a role that may edit this workflow'), {
      target: { value: 'approver' },
    });
    fireEvent.keyDown(screen.getByLabelText('Add a role that may edit this workflow'), {
      key: 'Enter',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save access' }));

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledWith({
        run: ['reviewer'],
        edit: ['editor', 'workflow-manager', 'approver'],
      });
    });
  });

  it('restricting a verb starts it at the built-in floor', () => {
    renderPanel();

    fireEvent.click(screen.getByLabelText('Restrict who can change it'));

    // ADR-0020: a restricted verb always admits the built-in roles that carry
    // it, so the list opens with them rather than empty.
    expect(screen.getByText(/"editor" and "workflow-manager" always can change/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove role editor' })).toBeNull();
  });

  it('offers no way to take a built-in role off a restricted list', () => {
    accessMock.mockReturnValue({
      access: { run: ['executor', 'workflow-manager', 'reviewer'], edit: [] },
      caller: { mayRun: true, mayEdit: true },
      loading: false,
      error: null,
    });
    renderPanel();

    // A chip that could be removed would claim a restriction the server
    // re-adds on the next write — the tab has to show what the gate enforces.
    expect(screen.queryByRole('button', { name: 'Remove role executor' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove role workflow-manager' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove role reviewer' })).toBeTruthy();
  });

  it('clearing the restriction is what opens a verb back up', async () => {
    renderPanel();

    fireEvent.click(screen.getByLabelText('Restrict who can run it'));
    fireEvent.click(screen.getByRole('button', { name: 'Save access' }));

    // The only route back to "any member", now that the floor cannot be
    // emptied one chip at a time.
    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledWith({ run: [], edit: [] });
    });
  });

  it('offers a plain member no way to edit the gates', () => {
    namespaceRoleMock.mockReturnValue({ role: 'member', canAdmin: false, loading: false });
    renderPanel();

    expect(screen.queryByLabelText('Add a role that may run this workflow')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove role reviewer' })).toBeNull();
    // The gate is still legible, just not editable — a chip plus its row in
    // the holders table below.
    expect(screen.getAllByText('reviewer')).toHaveLength(2);
    expect(screen.getByText(/Only a workspace owner or admin can change these lists/)).toBeTruthy();
  });

  it('stays silent about unheld roles until the roster resolves', () => {
    membersMock.mockReturnValue({ members: [], loading: true, resolved: false });
    renderPanel();

    expect(screen.queryByText(/Nobody holds/)).toBeNull();
  });
});
