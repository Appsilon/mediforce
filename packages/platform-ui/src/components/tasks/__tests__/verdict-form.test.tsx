import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TaskVerdict } from '@mediforce/platform-core';

vi.mock('@/lib/mediforce', () => ({
  mediforce: {
    tasks: {
      complete: vi.fn(async () => ({ task: {}, run: {} })),
    },
  },
}));

// useHandleFromPath is called by the post-submit confirmation view; mocked
// here so the read-only confirmation tests below can render a stable Link.
vi.mock('@/hooks/use-handle-from-path', () => ({
  useHandleFromPath: () => 'test-ns',
}));

import { mediforce } from '@/lib/mediforce';
import { VerdictForm, VerdictConfirmationReadOnly } from '../verdict-form';

const completeMock = vi.mocked(mediforce.tasks.complete);

describe('VerdictForm (single-click GitHub flow)', () => {
  beforeEach(() => {
    completeMock.mockReset();
    completeMock.mockResolvedValue({ task: {}, run: {} } as never);
  });

  it('renders the legacy two-button UI when verdicts prop is undefined', () => {
    render(<VerdictForm taskId="t1" disabled={false} />);
    expect(screen.getByRole('button', { name: /^Approve$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Request changes/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reject/ })).not.toBeInTheDocument();
  });

  it('renders one button per descriptor with success intent sorted last', () => {
    const verdicts: TaskVerdict[] = [
      { key: 'accept', label: 'Accept delivery', intent: 'success', requiresComment: false },
      { key: 'reject_and_notify', label: 'Reject — notify CRO', intent: 'danger', requiresComment: false },
      { key: 'ask_agent_to_revise', label: 'Ask agent to make changes', intent: 'warning', requiresComment: true },
    ];

    render(<VerdictForm taskId="t1" disabled={false} verdicts={verdicts} />);

    const buttons = screen.getAllByRole('button').map((b) => b.textContent?.trim());
    expect(buttons).toEqual([
      'Reject — notify CRO',
      'Ask agent to make changes',
      'Accept delivery', // success intent always sorted last
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

    await waitFor(() => expect(completeMock).toHaveBeenCalledTimes(1));
    expect(completeMock).toHaveBeenCalledWith({
      taskId: 't1',
      payload: { kind: 'verdict', verdict: 'accept', comment: '' },
    });
  });

  it('disables a requiresComment verdict button until a comment is typed', async () => {
    const verdicts: TaskVerdict[] = [{ key: 'reject', label: 'Reject', intent: 'danger', requiresComment: true }];
    const user = userEvent.setup();

    render(<VerdictForm taskId="t1" disabled={false} verdicts={verdicts} />);
    const rejectBtn = screen.getByRole('button', { name: /^Reject$/ });
    expect(rejectBtn).toBeDisabled();

    await user.type(screen.getByRole('textbox'), 'broken manifest');
    expect(rejectBtn).not.toBeDisabled();

    await user.click(rejectBtn);
    await waitFor(() => expect(completeMock).toHaveBeenCalledTimes(1));
    expect(completeMock).toHaveBeenCalledWith({
      taskId: 't1',
      payload: { kind: 'verdict', verdict: 'reject', comment: 'broken manifest' },
    });
  });

  it('passes the typed comment with a non-required verdict when present', async () => {
    const verdicts: TaskVerdict[] = [{ key: 'approve', label: 'Approve', intent: 'success', requiresComment: false }];
    const user = userEvent.setup();

    render(<VerdictForm taskId="t1" disabled={false} verdicts={verdicts} />);
    await user.type(screen.getByRole('textbox'), 'looks good');
    await user.click(screen.getByRole('button', { name: /Approve/ }));

    await waitFor(() => expect(completeMock).toHaveBeenCalledTimes(1));
    expect(completeMock).toHaveBeenCalledWith({
      taskId: 't1',
      payload: { kind: 'verdict', verdict: 'approve', comment: 'looks good' },
    });
  });
});

describe('VerdictConfirmationReadOnly', () => {
  it('renders label + comment from task.verdicts when present', () => {
    const verdicts: TaskVerdict[] = [
      { key: 'reject_and_notify', label: 'Reject — notify CRO', intent: 'danger', requiresComment: true },
    ];
    render(
      <VerdictConfirmationReadOnly
        completionData={{
          verdict: 'reject_and_notify',
          comment: 'tables missing',
          completedAt: '2026-05-12T10:00:00.000Z',
        }}
        verdicts={verdicts}
      />,
    );
    expect(screen.getByText(/Submitted: Reject — notify CRO/)).toBeInTheDocument();
    expect(screen.getByText('tables missing')).toBeInTheDocument();
  });

  it('falls back to LEGACY_VERDICTS mapping for a revise verdict on a task without verdicts', () => {
    render(
      <VerdictConfirmationReadOnly
        completionData={{
          verdict: 'revise',
          comment: 'needs rework',
          completedAt: '2026-05-12T10:00:00.000Z',
        }}
      />,
    );
    expect(screen.getByText(/Submitted: Request changes/)).toBeInTheDocument();
    expect(screen.getByText('needs rework')).toBeInTheDocument();
  });

  it('falls back to a neutral label = key for an unknown verdict with no descriptors', () => {
    render(
      <VerdictConfirmationReadOnly
        completionData={{
          verdict: 'escalate',
          comment: '',
          completedAt: '2026-05-12T10:00:00.000Z',
        }}
      />,
    );
    expect(screen.getByText(/Submitted: escalate/)).toBeInTheDocument();
  });

  it('renders the "no verdict data available" notice when completionData has no verdict', () => {
    render(
      <VerdictConfirmationReadOnly completionData={{ comment: 'orphan', completedAt: '2026-05-12T10:00:00.000Z' }} />,
    );
    expect(screen.getByText(/Task completed\. No verdict data available\./)).toBeInTheDocument();
  });
});
