import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { describeRoles, useWorkflowEditGate } from '../use-workflow-access';

const accessMock = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => accessMock(),
  useMutation: () => ({}),
  useQueryClient: () => ({}),
}));

vi.mock('@/lib/mediforce', () => ({ mediforce: { workflows: {} } }));
vi.mock('@/lib/retry', () => ({ stopRetryOn4xx: () => false }));

/**
 * The gate the Save button, the Definitions tab and the workflow menu all
 * consult (#1253). Its two failure modes are opposite and both silent: greying
 * a control out on an answer we do not have, and greying one out with no
 * readable reason.
 */
describe('useWorkflowEditGate', () => {
  function gate(data: unknown) {
    accessMock.mockReturnValue({ data, isLoading: false, error: null });
    return renderHook(() => useWorkflowEditGate('acme', 'tealflow')).result.current;
  }

  it('permits while the read is unresolved — the server still refuses if it must', () => {
    expect(gate(undefined)).toEqual({ mayEdit: true, reason: undefined });
  });

  it('permits an ungated workflow with nothing to explain', () => {
    expect(
      gate({ access: { run: [], edit: [] }, caller: { mayRun: true, mayEdit: true } }),
    ).toEqual({ mayEdit: true, reason: undefined });
  });

  it('refuses with the roles named, so the control says who to ask', () => {
    const result = gate({
      access: { run: [], edit: ['approver'] },
      caller: { mayRun: true, mayEdit: false },
    });

    expect(result.mayEdit).toBe(false);
    expect(result.reason).toBe(
      "Changing this workflow is restricted to 'approver' — see the Access tab",
    );
  });

  it('reads the server\'s answer, not the list — a narrowed grant is invisible here', () => {
    // `edit` names a role and the caller is admitted anyway: the grant that
    // admitted them is narrowed to this workflow, which the browser cannot see.
    expect(
      gate({
        access: { run: [], edit: ['approver'] },
        caller: { mayRun: true, mayEdit: true },
      }),
    ).toEqual({ mayEdit: true, reason: undefined });
  });
});

describe('describeRoles', () => {
  it('names one role bare and several as a choice', () => {
    expect(describeRoles(['approver'])).toBe("'approver'");
    expect(describeRoles(['approver', 'PI'])).toBe("one of 'approver', 'PI'");
  });
});
