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

describe('VerdictForm', () => {
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
      reject_and_notify: { label: 'Reject — notify CRO', intent: 'danger', requiresComment: true },
      ask_agent_to_revise: { label: 'Ask agent to make changes', intent: 'warning', requiresComment: true },
    };

    render(<VerdictForm taskId="t1" disabled={false} verdicts={verdicts} />);

    expect(screen.getByRole('button', { name: /Accept delivery/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reject — notify CRO/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ask agent to make changes/ })).toBeInTheDocument();
  });

  it('submits the verdict key (not the label) to completeTask', async () => {
    const verdicts: Record<string, TaskVerdict> = {
      accept: { label: 'Accept delivery', intent: 'success', requiresComment: false },
      reject_and_notify: { label: 'Reject — notify CRO', intent: 'danger', requiresComment: true },
    };
    const user = userEvent.setup();

    render(<VerdictForm taskId="t1" disabled={false} verdicts={verdicts} />);
    await user.click(screen.getByRole('button', { name: /Accept delivery/ }));
    await user.click(screen.getByRole('button', { name: /Submit review/ }));

    await waitFor(() => expect(mockCompleteTask).toHaveBeenCalledTimes(1));
    expect(mockCompleteTask).toHaveBeenCalledWith('t1', 'accept', '', undefined, 'test-token');
  });

  it('blocks submit when requiresComment is true and the comment is empty', async () => {
    const verdicts: Record<string, TaskVerdict> = {
      reject: { label: 'Reject', intent: 'danger', requiresComment: true },
    };
    const user = userEvent.setup();

    render(<VerdictForm taskId="t1" disabled={false} verdicts={verdicts} />);
    await user.click(screen.getByRole('button', { name: /^Reject$/ }));
    const submit = screen.getByRole('button', { name: /Submit review/ });
    expect(submit).toBeDisabled();

    // Add a comment and the button enables; submit fires.
    await user.type(screen.getByRole('textbox'), 'broken manifest');
    expect(submit).not.toBeDisabled();
    await user.click(submit);

    await waitFor(() => expect(mockCompleteTask).toHaveBeenCalledTimes(1));
    expect(mockCompleteTask).toHaveBeenCalledWith('t1', 'reject', 'broken manifest', undefined, 'test-token');
  });

  it('allows submit without a comment when requiresComment is false', async () => {
    const verdicts: Record<string, TaskVerdict> = {
      approve: { label: 'Approve', intent: 'success', requiresComment: false },
    };
    const user = userEvent.setup();

    render(<VerdictForm taskId="t1" disabled={false} verdicts={verdicts} />);
    await user.click(screen.getByRole('button', { name: /Approve/ }));
    const submit = screen.getByRole('button', { name: /Submit review/ });
    expect(submit).not.toBeDisabled();
    await user.click(submit);

    await waitFor(() => expect(mockCompleteTask).toHaveBeenCalledTimes(1));
    expect(mockCompleteTask).toHaveBeenCalledWith('t1', 'approve', '', undefined, 'test-token');
  });
});
