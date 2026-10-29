import * as React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GuidedSetup, SetupChoice, EXPECTED_OUTPUT_EVALUATOR, type SetupStage } from '../guided-setup';

const asked = vi.hoisted(() => vi.fn());
const evaluation = vi.hoisted(() => ({
  createEvaluator: vi.fn(),
  setAcceptanceCriteria: vi.fn(),
  saveDataset: vi.fn(),
  setBrief: vi.fn(),
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
  EvaluationAssistantPanel: ({ starter }: { starter?: { actions: { label: string; prompt: string; testId: string }[] } }) => {
    const [conversation, setConversation] = React.useState<string[]>([]);
    return (
      <div data-testid="evaluation-assistant">
        {starter?.actions.map((action) => (
          <button key={action.testId} type="button" data-testid={action.testId} onClick={() => { asked(action.prompt); setConversation((current) => [...current, action.label]); }}>{action.label}</button>
        ))}
        <p data-testid="assistant-conversation">{conversation.join(', ')}</p>
      </div>
    );
  },
}));
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
  const setupAt = (at: SetupStage) => (
    <GuidedSetup
      step={step}
      definitionVersion={3}
      evaluation={data}
      outputSchema={undefined}
      mayEdit
      editReason={undefined}
      mayRun
      runReason={undefined}
      stage={at}
      onStage={onStage}
      onExit={onExit}
      {...overrides}
    />
  );
  const { rerender } = render(setupAt(stage));
  return { onStage, onExit, moveTo: (at: SetupStage) => rerender(setupAt(at)) };
}

beforeEach(() => {
  vi.clearAllMocks();
  evaluation.createEvaluator.mockResolvedValue({});
  evaluation.setAcceptanceCriteria.mockResolvedValue({});
  evaluation.saveDataset.mockResolvedValue({});
  evaluation.setBrief.mockResolvedValue({});
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

  it('hands each stage\'s drafting job to the assistant, as a button in its panel', () => {
    renderSetup('brief', evaluationOf());
    fireEvent.click(screen.getByTestId('guided-setup-draft-brief'));
    expect(asked).toHaveBeenCalledWith(expect.stringContaining('Evaluation Brief'));
  });

  it('keeps a conversation per stage: a new stage starts its own, and going back returns to the earlier one', () => {
    const shownConversation = () => screen.getAllByTestId('assistant-conversation').filter((element) => element.closest('[hidden]') === null);
    const { moveTo } = renderSetup('brief', evaluationOf());
    fireEvent.click(screen.getByTestId('guided-setup-draft-brief'));
    expect(shownConversation()).toHaveLength(1);
    expect(shownConversation()[0]).toHaveTextContent('Draft the Brief');
    moveTo('cases');
    expect(shownConversation()).toHaveLength(1);
    expect(shownConversation()[0]).toBeEmptyDOMElement();
    moveTo('brief');
    expect(shownConversation()[0]).toHaveTextContent('Draft the Brief');
  });

  it('keeps the Brief open for writing and saves it when the person leaves the field', async () => {
    renderSetup('brief', evaluationOf());
    const field = screen.getByLabelText('Evaluation Brief');
    expect(field).toHaveAttribute('placeholder', 'Write it, or let the assistant draft it →');
    fireEvent.change(field, { target: { value: 'Extracts adverse events.' } });
    fireEvent.blur(field);
    await waitFor(() => expect(evaluation.setBrief).toHaveBeenCalledWith({ ...step, text: 'Extracts adverse events.' }));
  });

  it('shows the saved Brief, and leaves it alone when nothing changed', () => {
    renderSetup('brief', evaluationOf({ brief: { text: 'Drafted by the assistant.' } }));
    const field = screen.getByLabelText('Evaluation Brief');
    expect(field).toHaveValue('Drafted by the assistant.');
    fireEvent.blur(field);
    expect(evaluation.setBrief).not.toHaveBeenCalled();
  });

  it('offers cases from runs only for a step, which has production runs', () => {
    renderSetup('cases', evaluationOf(), { step: { kind: 'agent', namespace: 'acme', agentId: 'grader' } });
    expect(screen.queryByTestId('guided-setup-cases-from-runs')).toBeNull();
    expect(screen.getByTestId('guided-setup-edge-cases')).toBeVisible();
  });

  it('asks for edge cases and negative ones: real outputs with one obvious error planted', () => {
    renderSetup('cases', evaluationOf());
    fireEvent.click(screen.getByTestId('guided-setup-edge-cases'));
    expect(asked).toHaveBeenLastCalledWith(expect.stringContaining('inputs production has not sent yet'));
    expect(asked).toHaveBeenLastCalledWith(expect.stringContaining('negative cases from real outputs with one obvious error planted'));
  });

  it('asks for no planted errors when the person does not know the correct outputs: nothing would compare them', () => {
    renderSetup('cases', evaluationOf());
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    fireEvent.click(screen.getByTestId('guided-setup-edge-cases'));
    expect(asked).toHaveBeenLastCalledWith(expect.stringContaining('inputs production has not sent yet'));
    expect(asked).not.toHaveBeenLastCalledWith(expect.stringContaining('error planted'));
  });

  it('asks for cases from runs with the outputs the person knows, from the reviewer where there was one', () => {
    renderSetup('cases', evaluationOf());
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    fireEvent.click(screen.getByTestId('guided-setup-cases-from-runs'));
    expect(asked).toHaveBeenLastCalledWith(expect.stringContaining('take them from the reviewers\' decisions'));
    expect(asked).toHaveBeenLastCalledWith(expect.stringContaining('mark the rest Positive or Negative'));
  });

  it('asks for cases from runs without expected outputs when the person knows none', () => {
    renderSetup('cases', evaluationOf());
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    fireEvent.click(screen.getByTestId('guided-setup-cases-from-runs'));
    expect(asked).toHaveBeenLastCalledWith(expect.stringContaining('without an expected output'));
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
