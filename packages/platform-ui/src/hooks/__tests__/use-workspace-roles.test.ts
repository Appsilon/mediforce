import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createQueryWrapper } from '@/test/react-query';

const listWorkflowsMock = vi.fn<(...args: unknown[]) => Promise<{ definitions: unknown[] }>>();
const listMembersMock = vi.fn<(...args: unknown[]) => Promise<{ members: unknown[] }>>();

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

vi.mock('@/lib/mediforce', () => ({
  mediforce: {
    workflows: { list: listWorkflowsMock },
    users: { listMembers: listMembersMock },
  },
  ApiError,
}));

const { useWorkspaceRoles } = await import('../use-workspace-roles');

const deferred = () => {
  let resolve!: (value: { members: unknown[] }) => void;
  const promise = new Promise<{ members: unknown[] }>((r) => { resolve = r; });
  return { promise, resolve };
};

describe('useWorkspaceRoles heldRoles', () => {
  beforeEach(() => {
    listWorkflowsMock.mockReset();
    listMembersMock.mockReset();
    listWorkflowsMock.mockResolvedValue({ definitions: [] });
  });

  it('answers with the roles the roster actually holds on the named workflow', async () => {
    listMembersMock.mockResolvedValue({
      members: [
        { uid: 'u-1', role: 'member', grants: [{ role: 'reviewer', workflowName: null }] },
        { uid: 'u-2', role: 'member', grants: [{ role: 'approver', workflowName: 'tealflow' }] },
        { uid: 'u-3', role: 'member', grants: [{ role: 'auditor', workflowName: 'otherflow' }] },
      ],
    });
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(
      () => useWorkspaceRoles('acme', { workflowName: 'tealflow' }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.heldRoles).toEqual(['approver', 'reviewer']);
  });

  // A workflow being authored has no name yet, so no grant can be narrowed to
  // it — the roles someone could exercise on it are exactly the workspace-wide
  // ones. Answering `null` here is what left the new-workflow editor unable to
  // warn about a role nobody holds, which is the editor where the typo the
  // warning exists for gets made.
  it('counts workspace-wide grants when no workflow is named yet', async () => {
    listMembersMock.mockResolvedValue({
      members: [
        { uid: 'u-1', role: 'member', grants: [{ role: 'reviewer', workflowName: null }] },
        { uid: 'u-2', role: 'member', grants: [{ role: 'approver', workflowName: 'tealflow' }] },
      ],
    });
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useWorkspaceRoles('acme'), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.heldRoles).toEqual(['reviewer']);
  });

  // An unread roster and an empty one are both `[]` here, so answering with the
  // set while the fetch is in flight warns about every role on every step until
  // it lands.
  it('stays unknown while the member roster is still in flight', async () => {
    const roster = deferred();
    listMembersMock.mockReturnValue(roster.promise);
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useWorkspaceRoles('acme'), { wrapper });

    expect(result.current.heldRoles).toBeNull();

    roster.resolve({ members: [] });
    await waitFor(() => expect(result.current.heldRoles).toEqual([]));
  });
});
