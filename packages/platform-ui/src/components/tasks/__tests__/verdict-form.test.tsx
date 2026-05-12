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

vi.mock('@/hooks/use-handle-from-path', () => ({
  useHandleFromPath: () => 'test-ns',
}));

import { VerdictForm } from '../verdict-form';

describe('VerdictForm (single-click GitHub flow)', () => {
  beforeEach(() => {
    mockCompleteTask.mockReset();
    mockCompleteTask.mockResolvedValue({ success: true });
  });

  it('renders the legacy two-button UI when verdicts prop is undefined', () => {
    render(<VerdictForm taskId="t1" disabled={false} />);
    expect(screen.getByRole('button', { name: /^Approve$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Request revisions/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reject/ })).not.toBeInTheDocument();
  });

  it('renders one button per resolved verdict descriptor', () => {
    const verdicts: Record<string, TaskVerdict> = {
      accept: { label: 'Accept delivery', intent: 'success', requiresComment: false },
      reject_and_notify: { label: 'Reject — notify CRO', intent: 'danger', requiresComment: false },
      ask_agent_to_revise: { label: 'Ask agent to make changes', intent: 'warning', requiresComment: true },
    };

    render(<VerdictForm taskId="t1" disabled={false} verdicts={verdicts} />);

    expect(screen.getByRole('button', { name: /Accept delivery/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reject — notify CRO/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ask agent to make changes/ })).toBeInTheDocument();
  });

  it('fires completeTask immediately on a single button click (no Submit step)', async () => {
    const verdicts: Record<string, TaskVerdict> = {
      accept: { label: 'Accept delivery', intent: 'success', requiresComment: false },
      reject_and_notify: { label: 'Reject — notify CRO', intent: 'danger', requiresComment: false },
    };
    const user = userEvent.setup();

    render(<VerdictForm taskId="t1" disabled={false} verdicts={verdicts} />);
    await user.click(screen.getByRole('button', { name: /Accept delivery/ }));

    await waitFor(() => expect(mockCompleteTask).toHaveBeenCalledTimes(1));
    expect(mockCompleteTask).toHaveBeenCalledWith('t1', 'accept', '', undefined, 'test-token');
  });

  it('disables a requiresComment verdict button until a comment is typed', async () => {
    const verdicts: Record<string, TaskVerdict> = {
      reject: { label: 'Reject', intent: 'danger', requiresComment: true },
    };
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
    const verdicts: Record<string, TaskVerdict> = {
      approve: { label: 'Approve', intent: 'success', requiresComment: false },
    };
    const user = userEvent.setup();

    render(<VerdictForm taskId="t1" disabled={false} verdicts={verdicts} />);
    await user.type(screen.getByRole('textbox'), 'looks good');
    await user.click(screen.getByRole('button', { name: /Approve/ }));

    await waitFor(() => expect(mockCompleteTask).toHaveBeenCalledTimes(1));
    expect(mockCompleteTask).toHaveBeenCalledWith('t1', 'approve', 'looks good', undefined, 'test-token');
  });
});
