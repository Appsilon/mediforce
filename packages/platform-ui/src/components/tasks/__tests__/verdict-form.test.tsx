import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TaskVerdict } from '@mediforce/platform-core';

const mockCompleteTask = vi.fn();
vi.mock('@/app/actions/tasks', () => ({
  completeTask: (...args: unknown[]) => mockCompleteTask(...args),
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ firebaseUser: { getIdToken: () => Promise.resolve('test-token') } }),
}));

// Note: useHandleFromPath is only called from the post-submit confirmation
// (VerdictConfirmation). These tests assert pre-submit behaviour; no mock
// needed.

import { VerdictForm } from '../verdict-form';

describe('VerdictForm (single-click GitHub flow)', () => {
  beforeEach(() => {
    mockCompleteTask.mockReset();
    mockCompleteTask.mockResolvedValue({ success: true });
  });

  it('renders the legacy two-button UI when verdicts prop is undefined', () => {
    render(<VerdictForm taskId="t1" disabled={false} />);
    expect(screen.getByRole('button', { name: /^Approve$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Request changes/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reject/ })).not.toBeInTheDocument();
  });

  it('renders one button per descriptor in array order', () => {
    const verdicts: TaskVerdict[] = [
      { key: 'accept', label: 'Accept delivery', intent: 'success', requiresComment: false },
      { key: 'reject_and_notify', label: 'Reject — notify CRO', intent: 'danger', requiresComment: false },
      { key: 'ask_agent_to_revise', label: 'Ask agent to make changes', intent: 'warning', requiresComment: true },
    ];

    render(<VerdictForm taskId="t1" disabled={false} verdicts={verdicts} />);

    const buttons = screen.getAllByRole('button').map((b) => b.textContent?.trim());
    expect(buttons).toEqual([
      'Accept delivery',
      'Reject — notify CRO',
      'Ask agent to make changes',
    ]);
  });

  it('fires completeTask immediately on a single button click (no Submit step)', async () => {
    const verdicts: TaskVerdict[] = [
      { key: 'accept', label: 'Accept delivery', intent: 'success', requiresComment: false },
      { key: 'reject_and_notify', label: 'Reject — notify CRO', intent: 'danger', requiresComment: false },
    ];
    const user = userEvent.setup();

    render(<VerdictForm taskId="t1" disabled={false} verdicts={verdicts} />);
    await user.click(screen.getByRole('button', { name: /Accept delivery/ }));

    await waitFor(() => expect(mockCompleteTask).toHaveBeenCalledTimes(1));
    expect(mockCompleteTask).toHaveBeenCalledWith('t1', 'accept', '', undefined, 'test-token');
  });

  it('disables a requiresComment verdict button until a comment is typed', async () => {
    const verdicts: TaskVerdict[] = [
      { key: 'reject', label: 'Reject', intent: 'danger', requiresComment: true },
    ];
    const user = userEvent.setup();

    render(<VerdictForm taskId="t1" disabled={false} verdicts={verdicts} />);
    const rejectBtn = screen.getByRole('button', { name: /^Reject$/ });
    expect(rejectBtn).toBeDisabled();

    await user.type(screen.getByRole('textbox'), 'broken manifest');
    expect(rejectBtn).not.toBeDisabled();

    await user.click(rejectBtn);
    await waitFor(() => expect(mockCompleteTask).toHaveBeenCalledTimes(1));
    expect(mockCompleteTask).toHaveBeenCalledWith('t1', 'reject', 'broken manifest', undefined, 'test-token');
  });

  it('passes the typed comment with a non-required verdict when present', async () => {
    const verdicts: TaskVerdict[] = [
      { key: 'approve', label: 'Approve', intent: 'success', requiresComment: false },
    ];
    const user = userEvent.setup();

    render(<VerdictForm taskId="t1" disabled={false} verdicts={verdicts} />);
    await user.type(screen.getByRole('textbox'), 'looks good');
    await user.click(screen.getByRole('button', { name: /Approve/ }));

    await waitFor(() => expect(mockCompleteTask).toHaveBeenCalledTimes(1));
    expect(mockCompleteTask).toHaveBeenCalledWith('t1', 'approve', 'looks good', undefined, 'test-token');
  });
});
