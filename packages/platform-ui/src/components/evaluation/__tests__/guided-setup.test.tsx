import * as React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GuidedSetup, SetupChoice, EXPECTED_OUTPUT_EVALUATOR, type SetupStage } from '../guided-setup';

const asked = vi.hoisted(() => vi.fn());
const evaluation = vi.hoisted(() => ({
  createEvaluator: vi.fn(),
  setAcceptanceCriteria: vi.fn(),
  saveDataset: vi.fn(),
}));

vi.mock('@/lib/mediforce', () => ({ mediforce: { evaluation } }));
vi.mock('@/hooks/use-model-registry', () => ({ usePinnedDefaultModel: () => 'anthropic/claude-sonnet-5.5' }));
vi.mock('@/hooks/use-step-evaluation', () => ({
  useStepEvaluationMutation: (_step: unknown, mutationFn: (value: unknown) => Promise<unknown>) => {
    const [state, setState] = React.useState<{ isSuccess: boolean; error: Error | null }>({ isSuccess: false, error: null });
    return {
      mutate: (value: unknown, options?: { onSuccess?: () => void }) => {
        void mutationFn(value).then(() => {
          setState({ isSuccess: true, error: null });
          options?.onSuccess?.();
        });
      },
      isPending: false,
      isSuccess: state.isSuccess,
      error: state.error,
      reset: () => undefined,
    };
  },
}));
vi.mock('../evaluation-assistant-panel', () => ({
  EvaluationAssistantPanel: ({ ref }: { ref: React.Ref<{ ask: (message: string) => void }> }) => {
    React.useImperativeHandle(ref, () => ({ ask: asked }));
    return <div data-testid="evaluation-assistant" />;
  },
}));
vi.mock('../evaluation-brief-field', () => ({ EvaluationBriefField: () => <div data-testid="evaluation-brief" /> }));
vi.mock('../step-evaluation-sections', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../step-evaluation-sections')>()),
  CasesSection: () => <div data-testid="cases-section" />,
  EvaluatorsSection: () => <div data-testid="evaluators-section" />,
  StartEvalRunControls: ({ onStarted }: { onStarted: () => void }) => <button type="button" onClick={onStarted}>Start</button>,
}));

const step = { kind: 'step' as const, namespace: 'acme', workflowName: 'safety', stepId: 'extract-aes' };

function evaluatorOf(kind: string, trusted = true) {
  return { id: `e-${kind}`, name: kind, latest: { check: { kind } }, trust: { trusted } };
}

function caseOf(id: string, expectation: 'positive' | 'negative', expectedOutput: unknown) {
  return { id, name: id, expectation, expectedOutput };
}

function evaluationOf({ brief = null, cases = [], evaluators = [], datasets = [], criteria = null }: {
  brief?: unknown;
  cases?: unknown[];
  evaluators?: unknown[];
  datasets?: unknown[];
  criteria?: unknown;
} = {}) {
  return {
    brief: { data: { brief } },
    cases: { data: { cases } },
    evaluators: { data: { evaluators } },
    datasets: { data: { datasets } },
    criteria: { data: { criteria } },
    runs: { data: { evalRuns: [] } },
    agentRuns: { data: { pages: [{ runs: [{ id: 'r-1' }, { id: 'r-2' }] }] }, hasNextPage: false },
  } as unknown as Parameters<typeof GuidedSetup>[0]['evaluation'];
}

function renderSetup(stage: SetupStage, data: Parameters<typeof GuidedSetup>[0]['evaluation'], overrides: Partial<Parameters<typeof GuidedSetup>[0]> = {}) {
  const onStage = vi.fn();
  const onExit = vi.fn();
  render(
    <GuidedSetup
      step={step}
      definitionVersion={3}
      evaluation={data}
      outputSchema={undefined}
      mayEdit
      editReason={undefined}
      mayRun
      runReason={undefined}
      stage={stage}
      onStage={onStage}
      onExit={onExit}
      {...overrides}
    />,
  );
  return { onStage, onExit };
}

beforeEach(() => {
  vi.clearAllMocks();
  evaluation.createEvaluator.mockResolvedValue({});
  evaluation.setAcceptanceCriteria.mockResolvedValue({});
  evaluation.saveDataset.mockResolvedValue({});
});

describe('SetupChoice', () => {
  it('offers the guided setup or the tabs, and says how many production runs cases can start from', () => {
    const onGuided = vi.fn();
    const onManual = vi.fn();
    render(<SetupChoice step={step} evaluation={evaluationOf()} onGuided={onGuided} onManual={onManual} />);
    expect(screen.getByTestId('evaluation-setup-detected')).toHaveTextContent('2 production runs to start cases from.');
    fireEvent.click(screen.getByTestId('evaluation-setup-guided'));
    expect(onGuided).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTestId('evaluation-setup-manual'));
    expect(onManual).toHaveBeenCalledOnce();
  });
});

describe('GuidedSetup', () => {
  it('marks the current stage and the stages already filled, and moves between them', () => {
    const { onStage } = renderSetup('cases', evaluationOf({ brief: { text: 'x' } }));
    expect(screen.getByTestId('guided-setup-stage-cases')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('guided-setup-stage-brief')).toHaveAttribute('data-filled', 'true');
    expect(screen.getByTestId('guided-setup-stage-evaluators')).toHaveAttribute('data-filled', 'false');
    fireEvent.click(screen.getByTestId('guided-setup-next'));
    expect(onStage).toHaveBeenCalledWith('evaluators');
  });

  it('asks the assistant beside it to draft each stage', () => {
    renderSetup('brief', evaluationOf());
    fireEvent.click(screen.getByTestId('guided-setup-draft-brief'));
    expect(asked).toHaveBeenCalledWith(expect.stringContaining('Evaluation Brief'));
  });

  it('offers cases from reviewed runs only for a step, which has production runs', () => {
    renderSetup('cases', evaluationOf(), { step: { kind: 'agent', namespace: 'acme', agentId: 'grader' } });
    expect(screen.queryByTestId('guided-setup-reviewed-runs')).toBeNull();
    expect(screen.getByTestId('guided-setup-edge-cases')).toBeVisible();
  });

  it('adds the check that compares expected outputs once the person knows some', async () => {
    renderSetup('cases', evaluationOf());
    fireEvent.click(screen.getByRole('button', { name: 'For some' }));
    await waitFor(() => expect(evaluation.createEvaluator).toHaveBeenCalledWith(expect.objectContaining({
      ...step,
      name: EXPECTED_OUTPUT_EVALUATOR,
      check: { kind: 'expected_output', model: 'anthropic/claude-sonnet-5.5' },
    })));
  });

  it('adds no comparison when the person knows no outputs, or when the step has one', () => {
    renderSetup('cases', evaluationOf());
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(screen.getByText('Rule checks only.')).toBeVisible();
    expect(evaluation.createEvaluator).not.toHaveBeenCalled();
  });

  it('starts on the comparison the step already has, without adding another', () => {
    renderSetup('cases', evaluationOf({ evaluators: [evaluatorOf('expected_output')] }));
    expect(screen.getByRole('button', { name: 'For some' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(evaluation.createEvaluator).not.toHaveBeenCalled();
  });
});

describe('GuidedSetup review', () => {
  const filled = () => evaluationOf({
    cases: [caseOf('c-1', 'positive', { events: 3 }), caseOf('c-2', 'negative', { events: 0 }), caseOf('c-3', 'positive', null)],
    evaluators: [evaluatorOf('schema'), evaluatorOf('code', false)],
  });

  it('sums up each stage and what would weaken the run', () => {
    renderSetup('review', filled());
    expect(screen.getByTestId('review-eval-cases')).toHaveTextContent('32 with expected output · unsaved');
    expect(screen.getByTestId('review-evaluators')).toHaveTextContent('2 · 1 count1 need source approval');
    const notes = screen.getByTestId('review-notes');
    expect(notes).toHaveTextContent('1 negative case included.');
    expect(notes).toHaveTextContent('2 expected outputs, but no Expected output Evaluator compares them.');
    expect(notes).toHaveTextContent('1 Code Evaluator won\'t count until a person approves the source.');
  });

  it('saves changed criteria and the unsaved cases as a Dataset version, then leaves for the tabs', async () => {
    const { onExit } = renderSetup('review', filled());
    fireEvent.change(screen.getByLabelText('Minimum pass rate (%)'), { target: { value: '90' } });
    fireEvent.click(screen.getByText('+ Also require consistency (pass^k)'));
    fireEvent.click(screen.getByTestId('guided-setup-save'));
    await waitFor(() => expect(onExit).toHaveBeenCalledWith(null));
    expect(evaluation.setAcceptanceCriteria).toHaveBeenCalledWith({ ...step, criteria: { minPassRate: 0.9, minPassHatK: 0.8 } });
    expect(evaluation.saveDataset).toHaveBeenCalledWith(step);
  });

  it('leaves unchanged criteria and saved cases alone', async () => {
    const data = evaluationOf({
      cases: [caseOf('c-1', 'positive', null)],
      evaluators: [evaluatorOf('schema')],
      datasets: [{ version: 1, caseIds: ['c-1'] }],
    });
    const { onExit } = renderSetup('review', data);
    fireEvent.click(screen.getByTestId('guided-setup-save'));
    await waitFor(() => expect(onExit).toHaveBeenCalledWith(null));
    expect(evaluation.setAcceptanceCriteria).not.toHaveBeenCalled();
    expect(evaluation.saveDataset).not.toHaveBeenCalled();
  });

  it('saves, then starts an Eval Run and opens the Eval Runs tab', async () => {
    const { onExit } = renderSetup('review', filled());
    fireEvent.click(screen.getByTestId('guided-setup-save-and-start'));
    await waitFor(() => expect(screen.getByTestId('review-start-eval-run')).toBeVisible());
    expect(evaluation.saveDataset).toHaveBeenCalledWith(step);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(onExit).toHaveBeenCalledWith('runs');
  });

  it('cannot save without a case and an Evaluator', () => {
    renderSetup('review', evaluationOf());
    expect(screen.getByTestId('guided-setup-save')).toBeDisabled();
    expect(screen.getByTestId('guided-setup-save-and-start')).toBeDisabled();
  });
});
