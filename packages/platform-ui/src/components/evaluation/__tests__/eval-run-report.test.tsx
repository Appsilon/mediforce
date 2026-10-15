import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EvalRunSummary } from '../eval-run-report';

const signQualification = vi.hoisted(() => vi.fn());
const history = vi.hoisted((): { current: unknown[] } => ({ current: [] }));

vi.mock('@/lib/mediforce', () => ({ mediforce: { evaluation: { signQualification } } }));
vi.mock('@/hooks/use-step-evaluation', () => ({
  useStepEvaluationMutation: (_step: unknown, mutationFn: (value: unknown) => unknown) => ({
    mutate: (value: unknown) => { void mutationFn(value); },
    isPending: false,
    error: null,
    reset: () => undefined,
  }),
  useStepQualification: () => ({ data: { history: history.current } }),
}));

const step = { kind: 'step', namespace: 'acme', workflowName: 'safety', stepId: 'grade-aes' } as const;
const outputWith = (status: 'met' | 'missed') => ({
  evalRun: { id: 'run-1', status: 'completed', definitionVersion: 1, acceptanceCriteria: { minPassRate: 1 }, fingerprint: { hash: 'f' } },
  report: {
    k: 1, evaluators: [], judgeVerdicts: [], trials: { inProgress: 0 },
    criteriaVerdict: { status, reason: 'findings-present passed 0 of 2 trials', criterion: { minPassRate: 1 }, evaluators: [] },
  },
}) as never;

describe('EvalRunSummary — signing off a run\'s verdict', () => {
  it('confirms a missed verdict as failed, with no justification', () => {
    signQualification.mockClear();
    history.current = [];
    render(<EvalRunSummary output={outputWith('missed')} step={step} mayEdit={true} editReason={undefined} />);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm that evaluation failed' }));
    expect(screen.queryByLabelText('Justification for overwriting the verdict')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign' }));

    expect(signQualification).toHaveBeenCalledWith({ evalRunId: 'run-1', decision: 'confirmed' });
  });

  it('says the verdict met is confirmed as passed', () => {
    history.current = [];
    render(<EvalRunSummary output={outputWith('met')} step={step} mayEdit={true} editReason={undefined} />);

    expect(screen.getByRole('button', { name: 'Confirm that evaluation passed' })).toBeTruthy();
  });

  it('will not overwrite a verdict until a justification is written', () => {
    signQualification.mockClear();
    history.current = [];
    render(<EvalRunSummary output={outputWith('missed')} step={step} mayEdit={true} editReason={undefined} />);

    fireEvent.click(screen.getByRole('button', { name: 'Overwrite the evaluation verdict' }));
    const sign = screen.getByRole('button', { name: 'Sign' }) as HTMLButtonElement;
    expect(sign.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Justification for overwriting the verdict'), { target: { value: ' A reviewer read every grade. ' } });
    expect(sign.disabled).toBe(false);
    fireEvent.click(sign);

    expect(signQualification).toHaveBeenCalledWith({ evalRunId: 'run-1', decision: 'overwritten', justification: 'A reviewer read every grade.' });
  });

  it('offers no decision once the run is signed, and shows who decided what', () => {
    history.current = [{
      evalRunId: 'run-1', decision: 'overwritten', verdicts: [{ status: 'missed' }],
      deviations: [{ justification: 'A reviewer read every grade.' }], signature: { signerName: 'Dr Q' },
    }];
    render(<EvalRunSummary output={outputWith('missed')} step={step} mayEdit={true} editReason={undefined} />);

    expect(screen.queryByTestId('confirm-verdict')).toBeNull();
    expect(screen.getByTestId('run-decision').getAttribute('data-outcome')).toBe('passed');
    expect(screen.getByTestId('run-decision').textContent).toContain('A reviewer read every grade.');
  });
});
