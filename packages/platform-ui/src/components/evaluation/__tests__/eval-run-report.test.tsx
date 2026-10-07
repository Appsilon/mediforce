import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { EvalRunEvaluatorReport, EvalRunReport } from '@mediforce/platform-core';
import type { EvalRunOutput } from '@mediforce/platform-api/contract';
import { EvalRunSummary } from '../eval-run-report';

vi.mock('@/hooks/use-step-evaluation', () => ({
  useStepEvaluationMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ passwordAuthEnabled: true }) }));
vi.mock('@/lib/mediforce', () => ({ mediforce: { evaluation: {} } }));

const step = { namespace: 'acme', workflowName: 'safety', stepId: 'grade-aes' };

function evaluator(index: number, name: string, passes: number, failures: number, counted = true): EvalRunEvaluatorReport {
  return {
    evaluatorId: `${index}e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c`, name, version: 1, kind: 'schema', counted,
    passes, failures, errors: 0, excluded: 0, passRate: passes / (passes + failures),
    wilsonLower: null, wilsonUpper: null, passAtK: null, passHatK: null, flakiness: null,
  };
}

function renderSummary(evaluators: EvalRunEvaluatorReport[], criteriaVerdict: EvalRunReport['criteriaVerdict']) {
  const report = {
    k: 1, trials: { total: 5, scored: 5, failed: 0, skipped: 0, inProgress: 0 },
    mcp: { live: [], replayed: [], denied: [], recordedFirst: [], unrecordedCalls: [] },
    evaluators, criteriaVerdict, confidence: null, recommendation: null, judgeVerdicts: [], trialResults: [],
    costUsd: 0, meanCostUsd: null, inputTokens: 0, outputTokens: 0, meanDurationMs: null, maxDurationMs: null,
  } as unknown as EvalRunReport;
  const evalRun = { id: 'run-1', status: 'completed', acceptanceCriteria: { minPassRate: 0.7 }, fingerprint: null };
  render(<EvalRunSummary output={{ evalRun, report } as unknown as EvalRunOutput} step={step} mayEdit={true} editReason={undefined} />);
}

describe('EvalRunSummary', () => {
  it('states the criteria in one line and colours each counted Evaluator by whether it reached the floor', () => {
    const passing = evaluator(1, 'summary-present', 5, 0);
    const failing = evaluator(2, 'result-stable', 2, 3);
    const notCounted = evaluator(3, 'unapproved-code', 0, 5, false);
    renderSummary([passing, failing, notCounted], {
      criterion: { minPassRate: 0.7 }, status: 'missed', reason: 'result-stable: pass rate 40% < 70%',
      evaluators: [
        { evaluatorId: passing.evaluatorId, name: passing.name, wilsonLower: null, passHatK: null, met: true },
        { evaluatorId: failing.evaluatorId, name: failing.name, wilsonLower: null, passHatK: null, met: false },
      ],
    });

    expect(screen.getByTestId('criteria-verdict').textContent).toBe('Acceptance criteria missed — 1 of 2 counted Evaluators below pass rate ≥ 70%');
    expect(screen.queryByTestId('criteria-verdicts')).toBeNull();
    const metOf = (name: string) => within(screen.getByText(name).closest('tr')!).getByTestId('evaluator-pass-rate').getAttribute('data-met');
    expect([metOf('summary-present'), metOf('result-stable'), metOf('unapproved-code')]).toEqual(['true', 'false', null]);
  });

  it('says every counted Evaluator reached the floor when the criteria are met', () => {
    const passing = evaluator(1, 'summary-present', 5, 0);
    renderSummary([passing], {
      criterion: { minPassRate: 0.7, minPassHatK: 0.9 }, status: 'met', reason: 'Every counted Evaluator reached it',
      evaluators: [{ evaluatorId: passing.evaluatorId, name: passing.name, wilsonLower: null, passHatK: 1, met: true }],
    });

    expect(screen.getByTestId('criteria-verdict').textContent).toBe('Acceptance criteria met — the one counted Evaluator at pass rate ≥ 70% and pass^k ≥ 90%');
  });
});
