import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OptimizationSection } from '../optimization-section';

const evaluation = vi.hoisted(() => ({
  prepareComparison: vi.fn(),
  startComparison: vi.fn(),
}));
vi.mock('@/lib/mediforce', () => ({ mediforce: { evaluation } }));

const hooks = vi.hoisted(() => ({
  comparisons: { data: { comparisons: [] as unknown[] }, isLoading: false },
  comparisonOutputs: [] as { data: unknown }[],
  comparison: { data: undefined as unknown },
  evalRuns: [] as { data: unknown }[],
}));
vi.mock('@/hooks/use-step-evaluation', () => ({
  useComparisons: () => hooks.comparisons,
  useComparisonOutputs: () => hooks.comparisonOutputs,
  useComparison: () => hooks.comparison,
  useEvalRuns: () => hooks.evalRuns,
  useStepEvaluationMutation: (_step: unknown, mutationFn: (value: unknown) => unknown) => ({
    mutate: (value: unknown, options?: { onSuccess?: (result: unknown) => void }) => {
      Promise.resolve(mutationFn(value)).then((result) => options?.onSuccess?.(result)).catch(() => undefined);
    },
    isPending: false,
    error: null,
    reset: () => undefined,
  }),
}));
vi.mock('@/components/workflows/workflow-editor/model-picker', () => ({
  ModelPicker: ({ onChange }: { onChange: (model: string | undefined) => void }) => (
    <button type="button" data-testid="pick-model" onClick={() => onChange('anthropic/claude-haiku-5.5')}>pick model</button>
  ),
}));

const step = { kind: 'step', namespace: 'acme', workflowName: 'safety', stepId: 'grade-aes' } as const;
const datasets = { data: { datasets: [{ id: 'ds-1', version: 1, caseIds: ['c-1', 'c-2'] }] } } as never;

function run(overrides: Record<string, unknown>) {
  return {
    evalRun: { id: 'run-base', variant: null, spentUsd: 0.1, ...(overrides.evalRun as object ?? {}) },
    evaluators: [{ evaluatorId: 'ev-1', name: 'Safety', counted: true, passRate: 0.8, wilsonLower: 0.6, wilsonUpper: 0.9 }],
    scoredTrials: 10,
    meanAgentCostUsd: 0.02,
    meanJudgeCostUsd: 0.01,
    meanDurationMs: 1200,
    inputTokens: 100,
    outputTokens: 50,
    acceptance: { status: 'met', reason: 'ok' },
    ...overrides,
  };
}

const baseline = run({});
const variant = run({
  evalRun: { id: 'run-v1', variant: { model: 'anthropic/claude-haiku-5.5' }, spentUsd: 0.05 },
  calls: [{ evaluatorId: 'ev-1', scope: 'all', wins: 5, losses: 1, ties: 4, pValue: 0.03, call: 'better' }],
  recommendationScope: 'all',
});

const comparison = {
  id: 'cmp-1',
  status: 'completed',
  budgetUsd: 0.15,
  trialsPerCase: 3,
  baselineReused: false,
  createdAt: '2026-11-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  hooks.comparisons = { data: { comparisons: [] }, isLoading: false };
  hooks.comparisonOutputs = [];
  hooks.comparison = { data: undefined };
  hooks.evalRuns = [];
});

function renderSection() {
  render(
    <OptimizationSection
      step={step}
      definitionVersion={3}
      datasets={datasets}
      currentModel="anthropic/claude-sonnet-5.5"
      currentPrompt="You are a pharmacovigilance grader."
      mayRun
      runReason={undefined}
    />,
  );
}

describe('OptimizationSection — list', () => {
  it('shows status, each Variant, the best call across them, and spend against budget', () => {
    hooks.comparisons = { data: { comparisons: [comparison] }, isLoading: false };
    hooks.comparisonOutputs = [{ data: { comparison, baseline, variants: [variant] } }];
    renderSection();

    const row = screen.getByTestId('comparison-row');
    expect(within(row).getByTestId('eval-run-status')).toHaveTextContent('Completed');
    expect(within(row).getByText('anthropic/claude-haiku-5.5')).toBeInTheDocument();
    expect(within(row).getByText('better')).toBeInTheDocument();
    expect(within(row).getByText('$0.150 of $0.15')).toBeInTheDocument();
  });

  it('says there are none yet with an empty list', () => {
    renderSection();
    expect(screen.getByText('No Comparisons yet.')).toBeInTheDocument();
    expect(screen.queryByTestId('comparisons-table')).toBeNull();
  });
});

describe('OptimizationSection — report', () => {
  beforeEach(() => {
    hooks.comparisons = { data: { comparisons: [comparison] }, isLoading: false };
    hooks.comparisonOutputs = [{ data: { comparison, baseline, variants: [variant] } }];
    hooks.comparison = { data: { comparison, baseline, variants: [variant] } };
    hooks.evalRuns = [
      {
        data: {
          trials: [{ id: 't-base-1', caseId: 'case-1' }],
          report: { trialResults: [{ trialId: 't-base-1', caseName: 'Sepsis, fatal', passed: true, evaluators: [] }] },
        },
      },
      {
        data: {
          trials: [{ id: 't-v1-1', caseId: 'case-1' }],
          report: { trialResults: [{ trialId: 't-v1-1', caseName: 'Sepsis, fatal', passed: false, evaluators: [] }] },
        },
      },
    ];
  });

  it('expands to the evaluator calls, the quality/cost scatter, and a per-case drill-down linking to trial detail', async () => {
    renderSection();
    fireEvent.click(screen.getByTestId('comparison-toggle'));

    expect(await screen.findByTestId('comparison-report')).toBeInTheDocument();
    expect(screen.getByTestId('quality-cost-scatter')).toBeInTheDocument();
    expect(screen.getByText('5/1/4')).toBeInTheDocument();

    const caseRow = screen.getByTestId('comparison-case-row');
    expect(within(caseRow).getByText('Sepsis, fatal')).toBeInTheDocument();
    const links = within(caseRow).getAllByRole('link');
    expect(links[0]).toHaveAttribute('href', expect.stringContaining('run-base'));
    expect(links[1]).toHaveAttribute('href', expect.stringContaining('run-v1'));
    expect(within(caseRow).getByText('Failed')).toBeInTheDocument();
    expect(within(caseRow).getByText('Passed')).toBeInTheDocument();
  });
});

describe('OptimizationSection — new Comparison', () => {
  it('adds a model Variant, prepares it, confirms the budget, and starts it', async () => {
    evaluation.prepareComparison.mockResolvedValue({ comparison: { ...comparison, id: 'cmp-2', budgetUsd: 0.42, status: 'prepared' }, baseline, variants: [variant] });
    evaluation.startComparison.mockResolvedValue({ comparison: { ...comparison, id: 'cmp-2', budgetUsd: 0.42, status: 'running' }, baseline, variants: [variant] });
    renderSection();

    fireEvent.click(screen.getByTestId('new-comparison'));
    fireEvent.click(screen.getByTestId('pick-model'));
    fireEvent.click(screen.getByTestId('prepare-comparison'));

    expect(await screen.findByTestId('start-eval-run-dialog')).toBeInTheDocument();
    expect(evaluation.prepareComparison).toHaveBeenCalledWith(expect.objectContaining({
      variants: [{ model: 'anthropic/claude-haiku-5.5' }],
      definitionVersion: 3,
      trialsPerCase: 3,
    }));
    expect(screen.getByText('$0.42')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(evaluation.startComparison).toHaveBeenCalledWith({ comparisonId: 'cmp-2', confirmedBudgetUsd: 0.42 }));
    expect(screen.queryByTestId('start-eval-run-dialog')).toBeNull();
  });

  it('diffs an edited prompt against the current one', () => {
    renderSection();
    fireEvent.click(screen.getByTestId('new-comparison'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Change the prompt' }));

    const textarea = screen.getByRole('textbox', { name: 'Variant 1 prompt' });
    fireEvent.change(textarea, { target: { value: 'You are a stricter pharmacovigilance grader.' } });

    const diff = screen.getByTestId('prompt-diff');
    expect(within(diff).getByText('You are a pharmacovigilance grader.')).toHaveClass('line-through');
    expect(within(diff).getByText('You are a stricter pharmacovigilance grader.')).not.toHaveClass('line-through');
  });
});
