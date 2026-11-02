import * as React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ProposalCard } from '../evaluation-assistant-cards';

const evaluation = vi.hoisted(() => ({ createCaseFromAgentRun: vi.fn(), createCase: vi.fn(), createPerturbedCase: vi.fn(), createEvaluator: vi.fn(), addEvaluatorVersion: vi.fn() }));
const stepEvaluators = vi.hoisted(() => ({ current: [] as unknown[] }));
const runIo = vi.hoisted(() => ({ current: undefined as unknown, error: null as Error | null }));

vi.mock('@/lib/mediforce', () => ({ mediforce: { evaluation } }));
vi.mock('@/hooks/use-model-registry', () => ({ usePinnedDefaultModel: () => 'anthropic/claude-sonnet-5.5' }));
vi.mock('@/hooks/use-step-evaluation', () => ({
  useStepEvaluators: () => ({ data: { evaluators: stepEvaluators.current } }),
  useAgentRunIo: (agentRunId: string | null) => (agentRunId !== null && runIo.error !== null
    ? { data: undefined, isError: true, error: runIo.error }
    : { data: agentRunId === null ? undefined : runIo.current, isError: false, error: null }),
  useStepEvaluationMutation: (_step: unknown, mutationFn: (value: unknown) => Promise<unknown>) => ({
    mutate: (value: unknown, options?: { onSuccess?: () => void }) => {
      void mutationFn(value).then(() => options?.onSuccess?.());
    },
    isPending: false,
  }),
}));

const step = { kind: 'step' as const, namespace: 'acme', workflowName: 'safety', stepId: 'grade-aes' };

const sourceRun = {
  agentRunId: 'agent-run-1',
  status: 'completed',
  stepInput: null,
  caseInput: { triggerPayload: { narrative: 'Patient died of sepsis' }, previousStepOutputs: {} },
  result: { grade: 4 },
  reasoningSummary: null,
  confidence: null,
  verdictExpectation: 'negative',
};

function renderProposal(proposal: React.ComponentProps<typeof ProposalCard>['state']['proposal'], onDecided = vi.fn()) {
  render(<ProposalCard step={step} mayEdit editReason={undefined} onDecided={onDecided} state={{ status: 'open', proposal }} />);
  return onDecided;
}

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
  evaluation.createCase.mockResolvedValue({});
  evaluation.createPerturbedCase.mockResolvedValue({});
  evaluation.createEvaluator.mockResolvedValue({});
  evaluation.addEvaluatorVersion.mockResolvedValue({});
  stepEvaluators.current = [];
  runIo.current = sourceRun;
  runIo.error = null;
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

describe('ProposalCard shows what an Eval Case holds', () => {
  it('shows a written case\'s input and expected output apart, with why it was proposed', () => {
    renderProposal({
      tool: 'propose_eval_case',
      arguments: {
        name: 'Grade 5 sepsis',
        input: { triggerPayload: { narrative: 'Fatal sepsis on day 3' }, previousStepOutputs: {} },
        expectedOutput: { grade: 5 },
        rationale: 'Death must be graded 5',
      },
    });
    expect(screen.getByText('Written input')).toBeVisible();
    expect(screen.getByText('Death must be graded 5')).toBeVisible();
    expect(screen.getByTestId('proposed-case-input')).toHaveTextContent('Fatal sepsis on day 3');
    expect(screen.getByTestId('proposed-case-output')).toHaveTextContent('"grade": 5');
    expect(screen.getByText(/Must match, exactly/)).toBeVisible();
  });

  it('shows a case from a run as the run gives it: its input and its reviewed output', () => {
    renderProposal({ tool: 'propose_eval_case', arguments: { name: 'Rejected grading', agentRunId: 'agent-run-1' } });
    expect(screen.getByText('From run agent-ru')).toBeVisible();
    expect(screen.getByTestId('proposed-case-input')).toHaveTextContent('Patient died of sepsis');
    expect(screen.getByTestId('proposed-case-output')).toHaveTextContent('"grade": 4');
    expect(screen.getByRole('button', { name: 'Negative' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('says a case from an unreviewed run has no expected output', () => {
    runIo.current = { ...sourceRun, verdictExpectation: null };
    renderProposal({ tool: 'propose_eval_case', arguments: { name: 'Unreviewed', agentRunId: 'agent-run-1' } });
    expect(screen.getByTestId('proposed-case-output')).toHaveTextContent('None — only the Evaluators grade it');
    expect(screen.queryByRole('button', { name: 'Positive' })).toBeNull();
  });

  it('says why a run\'s case cannot be shown when the run fails to load, and offers no Review', () => {
    runIo.error = new Error('Agent run not found');
    renderProposal({ tool: 'propose_eval_case', arguments: { name: 'Gone', agentRunId: 'agent-run-1' } });
    expect(screen.getByTestId('proposed-case-load-error')).toHaveTextContent('Agent run not found');
    expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();
  });

  it('opens the case in the Add case form to review, and accepts it as edited there', async () => {
    const onDecided = renderProposal({
      tool: 'propose_eval_case',
      arguments: {
        name: 'Grade 5 sepsis',
        input: { triggerPayload: { narrative: 'Fatal sepsis on day 3' }, previousStepOutputs: {} },
        expectedOutput: { grade: 5 },
        containsProductionData: true,
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    const dialog = await screen.findByTestId('case-dialog');
    expect(within(dialog).getByRole('textbox', { name: 'Expected output' })).toHaveValue(JSON.stringify({ grade: 5 }, null, 2));
    fireEvent.change(within(dialog).getByLabelText('Case name'), { target: { value: 'Grade 5 sepsis, renamed' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith('accepted'));
    expect(evaluation.createCase).toHaveBeenCalledWith(expect.objectContaining({
      ...step,
      name: 'Grade 5 sepsis, renamed',
      input: { triggerPayload: { narrative: 'Fatal sepsis on day 3' }, previousStepOutputs: {} },
      expectedOutput: { grade: 5 },
      expectation: 'positive',
      containsProductionData: true,
      origin: 'assistant',
    }));
  });
});

describe('ProposalCard for an Evaluator', () => {
  it('opens the Evaluator in the Add form to review, and creates it as edited there, still the assistant\'s', async () => {
    const onDecided = renderProposal({
      tool: 'propose_evaluator',
      arguments: {
        name: 'grades-valid',
        rule: 'Every grade is 1 to 5.',
        check: { kind: 'code', runtime: 'javascript', source: 'process.exit(0)' },
        rationale: 'Grades out of range broke the last run.',
        runInProduction: true,
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    const dialog = await screen.findByTestId('evaluator-dialog');
    expect(within(dialog).getByLabelText('Evaluator name')).toHaveValue('grades-valid');
    expect(within(dialog).getByLabelText('Source')).toHaveValue('process.exit(0)');
    fireEvent.change(within(dialog).getByLabelText('Rule'), { target: { value: 'Every grade is 1 to 5, as CTCAE has it.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith('accepted'));
    expect(evaluation.createEvaluator).toHaveBeenCalledWith({
      ...step,
      name: 'grades-valid',
      rule: 'Every grade is 1 to 5, as CTCAE has it.',
      check: { kind: 'code', runtime: 'javascript', source: 'process.exit(0)' },
      runInProduction: true,
      origin: 'assistant',
    });
  });

  it('keeps the assistant\'s name and rule for a schema check accepted on Review, as Accept on the card does', async () => {
    const onDecided = renderProposal({
      tool: 'propose_evaluator',
      arguments: { name: 'grades-shape', rule: 'Every adverse event carries a grade.', check: { kind: 'schema', schema: { type: 'object', required: ['grades'] } } },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    const dialog = await screen.findByTestId('evaluator-dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith('accepted'));
    expect(evaluation.createEvaluator).toHaveBeenCalledWith(expect.objectContaining({
      name: 'grades-shape',
      rule: 'Every adverse event carries a grade.',
      check: { kind: 'schema', schema: { type: 'object', required: ['grades'] } },
    }));
  });
});

describe('ProposalCard for a new Evaluator version', () => {
  const evaluatorId = '11111111-1111-4111-8111-111111111111';
  const latest = { version: 2, rule: 'Every grade is 1 to 5.', check: { kind: 'code', runtime: 'javascript', source: 'process.exit(0)' } };

  it('opens the version in the Evaluator\'s edit form over what it leaves unchanged, and saves it as edited there, still the assistant\'s', async () => {
    stepEvaluators.current = [{ id: evaluatorId, name: 'grades-valid', latest }];
    const onDecided = renderProposal({
      tool: 'propose_evaluator_version',
      arguments: { evaluatorId, rule: 'Every grade is 1 to 5, as CTCAE has it.', rationale: 'The rule did not name its source.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    const dialog = await screen.findByTestId('evaluator-dialog');
    expect(within(dialog).getByLabelText('Evaluator name')).toBeDisabled();
    expect(within(dialog).getByLabelText('Rule')).toHaveValue('Every grade is 1 to 5, as CTCAE has it.');
    expect(within(dialog).getByLabelText('Source')).toHaveValue('process.exit(0)');
    fireEvent.change(within(dialog).getByLabelText('Source'), { target: { value: 'process.exit(1)' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith('accepted'));
    expect(evaluation.addEvaluatorVersion).toHaveBeenCalledWith({
      evaluatorId,
      rule: 'Every grade is 1 to 5, as CTCAE has it.',
      check: { kind: 'code', runtime: 'javascript', source: 'process.exit(1)' },
      origin: 'assistant',
    });
  });

  it('offers no Review while its Evaluator is not known', () => {
    renderProposal({ tool: 'propose_evaluator_version', arguments: { evaluatorId, rule: 'Every grade is 1 to 5.' } });
    expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();
  });
});

describe('ProposalCard for an edge case', () => {
  const edgeCase = {
    tool: 'propose_perturbed_case' as const,
    arguments: {
      name: 'Narrative missing',
      baseAgentRunId: 'agent-run-1',
      perturbation: { kind: 'edge_values' as const, description: 'The narrative is gone' },
      inputChanges: [{ op: 'remove' as const, part: 'triggerPayload' as const, path: ['narrative'] }],
      fileChanges: [{ op: 'delete' as const, path: 'data/ae.csv' }],
      expectedOutput: { grade: null },
      expectation: 'positive' as const,
      rationale: 'Grading must not guess',
    },
    caseInput: { triggerPayload: {}, previousStepOutputs: { extract: { term: 'Sepsis' } } },
  };

  it('is laid out as a case from a run is: where it comes from, why, the input it goes in with and its expected output', () => {
    renderProposal(edgeCase);
    expect(screen.getByText('Edge case of run agent-ru')).toBeVisible();
    expect(screen.getByText('edge values')).toBeVisible();
    expect(screen.getByText('The narrative is gone')).toBeVisible();
    expect(screen.getByText('Grading must not guess')).toBeVisible();
    expect(screen.getByTestId('proposed-case-input')).toHaveTextContent('"term": "Sepsis"');
    expect(screen.getByTestId('proposed-case-output')).toHaveTextContent('"grade": null');
    expect(screen.getByRole('button', { name: 'Positive' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('lists every change it makes, a deleted file included, on the card and on Review', async () => {
    renderProposal(edgeCase);
    expect(screen.getByTestId('proposed-case-changes')).toHaveTextContent('remove triggerPayload.narrative; delete data/ae.csv');
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    const dialog = await screen.findByTestId('case-dialog');
    expect(dialog).toHaveTextContent('remove triggerPayload.narrative; delete data/ae.csv');
  });

  it('lets the person relabel its expected output before accepting', async () => {
    const onDecided = renderProposal(edgeCase);
    fireEvent.click(screen.getByRole('button', { name: 'Negative' }));
    fireEvent.click(screen.getByTestId('proposal-accept'));
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith('accepted'));
    expect(evaluation.createPerturbedCase).toHaveBeenCalledWith(expect.objectContaining({
      baseAgentRunId: 'agent-run-1', expectedOutput: { grade: null }, expectation: 'negative',
    }));
  });

  it('opens in the Add case form to review, and accepts it with its changes and the input as edited there', async () => {
    const onDecided = renderProposal(edgeCase);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    const dialog = await screen.findByTestId('case-dialog');
    const edited = { triggerPayload: { narrative: '' }, previousStepOutputs: { extract: { term: 'Sepsis' } } };
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Case input' }), { target: { value: JSON.stringify(edited) } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith('accepted'));
    expect(evaluation.createPerturbedCase).toHaveBeenCalledWith(expect.objectContaining({
      ...step,
      baseAgentRunId: 'agent-run-1',
      fileChanges: [{ op: 'delete', path: 'data/ae.csv' }],
      input: edited,
      origin: 'assistant',
    }));
  });
});
