import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EvaluatorOutageAlert, EvaluatorOutageSummary } from '../evaluator-outages';

const evaluation = vi.hoisted(() => ({ setEvaluatorProduction: vi.fn() }));
const evaluators = vi.hoisted((): { current: unknown[] } => ({ current: [] }));

vi.mock('@/lib/mediforce', () => ({ mediforce: { evaluation } }));
vi.mock('@/hooks/use-step-evaluation', () => ({
  useStepEvaluators: () => ({ data: { evaluators: evaluators.current } }),
  useStepEvaluationMutation: (_step: unknown, mutationFn: (value: unknown) => unknown) => ({
    mutate: (value: unknown) => { void mutationFn(value); },
    isPending: false,
    error: null,
  }),
}));

const step = { namespace: 'acme', workflowName: 'safety', stepId: 'grade-aes' };
const SANDBOXED = '5b0f2f3e-8f5c-4c55-9d0a-3f1f7c1b2a10';
const OFFLINE = '6b0f2f3e-8f5c-4c55-9d0a-3f1f7c1b2a10';

function reportLine(evaluatorId: string, name: string, errors: number) {
  return { evaluatorId, name, kind: 'code', counted: true, passes: 3, failures: 0, errors, excluded: 0 };
}

function liveEvaluator(id: string, name: string, overrides: Record<string, unknown>) {
  const version = { evaluatorId: id, version: 1, rule: 'r', check: { kind: 'code', runtime: 'python', source: 'print(1)' } };
  return { ...step, id, name, archived: false, runInProduction: false, onError: 'ignore', latest: version, versions: [version], ...overrides };
}

const output = {
  report: { evaluators: [reportLine(SANDBOXED, 'grade-5-flagged', 2), reportLine(OFFLINE, 'findings-present', 0)] },
} as never;

describe('Evaluator outages on an Eval Run', () => {
  it('alerts on the summary only for Evaluators that could not grade, saying what production does', () => {
    evaluators.current = [liveEvaluator(SANDBOXED, 'grade-5-flagged', { runInProduction: true })];
    const openProblems = vi.fn();
    render(<EvaluatorOutageAlert output={output} step={step} onOpenProblems={openProblems} />);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('grade-5-flagged could not grade 2 trials');
    expect(alert.textContent).toContain('In production, a run it cannot check continues unchecked');
    expect(alert.textContent).not.toContain('findings-present');
    fireEvent.click(screen.getByRole('button', { name: 'Decide in Problems' }));
    expect(openProblems).toHaveBeenCalled();
  });

  it('shows nothing when every Evaluator could grade every trial', () => {
    const clean = { report: { evaluators: [reportLine(OFFLINE, 'findings-present', 0)] } } as never;
    const { container } = render(<EvaluatorOutageAlert output={clean} step={step} onOpenProblems={vi.fn()} />);
    expect(container.textContent).toBe('');
  });

  it('lets an editor make a production Evaluator escalate when it cannot run', () => {
    evaluators.current = [liveEvaluator(SANDBOXED, 'grade-5-flagged', { runInProduction: true })];
    render(<EvaluatorOutageSummary output={output} step={step} mayEdit={true} editReason={undefined} />);

    fireEvent.click(screen.getByRole('button', { name: 'Escalate' }));

    expect(evaluation.setEvaluatorProduction).toHaveBeenCalledWith({ evaluatorId: SANDBOXED, onError: 'escalate' });
    expect(screen.getByRole('button', { name: 'Ignore' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('offers no choice for an Evaluator that does not run in production', () => {
    evaluators.current = [liveEvaluator(SANDBOXED, 'grade-5-flagged', { runInProduction: false })];
    render(<EvaluatorOutageSummary output={output} step={step} mayEdit={true} editReason={undefined} />);

    expect(screen.queryByRole('button', { name: 'Escalate' })).toBeNull();
    expect(screen.getByTestId('evaluator-outages').textContent).toContain('Not run in production');
  });
});
