import * as React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProposalCard } from '../evaluation-assistant-cards';

const evaluation = vi.hoisted(() => ({ createCaseFromAgentRun: vi.fn() }));

vi.mock('@/lib/mediforce', () => ({ mediforce: { evaluation } }));
vi.mock('@/hooks/use-step-evaluation', () => ({
  useStepEvaluators: () => ({ data: { evaluators: [] } }),
  useStepEvaluationMutation: (_step: unknown, mutationFn: (value: unknown) => Promise<unknown>) => ({
    mutate: (value: unknown, options?: { onSuccess?: () => void }) => {
      void mutationFn(value).then(() => options?.onSuccess?.());
    },
    isPending: false,
  }),
}));

const step = { kind: 'step' as const, namespace: 'acme', workflowName: 'safety', stepId: 'grade-aes' };

function renderCaseCard(onDecided = vi.fn()) {
  render(
    <ProposalCard
      step={step}
      mayEdit
      editReason={undefined}
      onDecided={onDecided}
      state={{
        status: 'open',
        proposal: {
          tool: 'propose_eval_case',
          arguments: { name: 'Fatal sepsis', agentRunId: 'agent-run-1', expectedOutput: { grade: 5 }, expectation: 'positive' },
        },
      }}
    />,
  );
  return onDecided;
}

beforeEach(() => {
  vi.clearAllMocks();
  evaluation.createCaseFromAgentRun.mockResolvedValue({});
});

describe('ProposalCard for an Eval Case', () => {
  it('starts on the assistant\'s expectation', () => {
    renderCaseCard();
    expect(screen.getByRole('button', { name: 'Positive' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('lets the person mark the expected output as one to avoid before accepting', async () => {
    const onDecided = renderCaseCard();
    fireEvent.click(screen.getByRole('button', { name: 'Negative' }));
    expect(screen.getByText(/Must not match/)).toBeVisible();
    fireEvent.click(screen.getByTestId('proposal-accept'));
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith('accepted'));
    expect(evaluation.createCaseFromAgentRun).toHaveBeenCalledWith(expect.objectContaining({
      agentRunId: 'agent-run-1', expectedOutput: { grade: 5 }, expectation: 'negative',
    }));
  });

  it('lets the person drop the expected output, so the case is graded by rules only', async () => {
    renderCaseCard();
    fireEvent.click(screen.getByRole('button', { name: 'No expected output' }));
    fireEvent.click(screen.getByTestId('proposal-accept'));
    await waitFor(() => expect(evaluation.createCaseFromAgentRun).toHaveBeenCalledOnce());
    const [created] = evaluation.createCaseFromAgentRun.mock.calls[0];
    expect(created).toMatchObject({ agentRunId: 'agent-run-1', expectedOutput: null });
    expect(created).not.toHaveProperty('expectation');
  });
});
