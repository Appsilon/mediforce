import { describe, it, expect } from 'vitest';
import type { EvalRunEvaluatorReport } from '../../schemas/eval-run';
import { evalRunAcceptance, judgeAcceptanceCriteria } from '../acceptance';

function report(overrides: Partial<EvalRunEvaluatorReport> & Pick<EvalRunEvaluatorReport, 'name' | 'severity'>): EvalRunEvaluatorReport {
  return {
    evaluatorId: '00000000-0000-4000-8000-00000000000' + String(overrides.name.length % 10),
    version: 1,
    kind: 'schema',
    counted: true,
    passes: 30,
    failures: 0,
    errors: 0,
    excluded: 0,
    passRate: 1,
    wilsonLower: 0.886,
    wilsonUpper: 1,
    passAtK: 1,
    passHatK: 1,
    flakiness: 0,
    ...overrides,
  };
}

describe('judgeAcceptanceCriteria', () => {
  it('judges nothing without criteria', () => {
    expect(judgeAcceptanceCriteria(null, [report({ name: 'findings-present', severity: 'critical' })])).toEqual([]);
  });

  it('meets a criterion when every counted Evaluator of its severity reaches it', () => {
    const [verdict] = judgeAcceptanceCriteria(
      { critical: { minPassRate: 0.85, minPassHatK: 0.9 } },
      [report({ name: 'findings-present', severity: 'critical' }), report({ name: 'style', severity: 'minor', wilsonLower: 0.1 })],
    );
    expect(verdict).toMatchObject({ severity: 'critical', status: 'met' });
    expect(verdict!.evaluators.map((line) => line.name)).toEqual(['findings-present']);
  });

  it('judges the pass rate literally: 8 of 10 meets an 80% floor', () => {
    const [verdict] = judgeAcceptanceCriteria(
      { major: { minPassRate: 0.8 } },
      [report({ name: 'grades-valid', severity: 'major', passes: 8, failures: 2, passRate: 0.8, wilsonLower: 0.49 })],
    );
    expect(verdict).toMatchObject({ severity: 'major', status: 'met' });
  });

  it('misses on the pass rate or on pass^k, naming what fell short', () => {
    const [verdict] = judgeAcceptanceCriteria(
      { critical: { minPassRate: 0.95, minPassHatK: 0.9 } },
      [report({ name: 'findings-present', severity: 'critical', passes: 27, failures: 3, passRate: 0.9, passHatK: 0.5 })],
    );
    expect(verdict!.status).toBe('missed');
    expect(verdict!.reason).toBe('findings-present: pass rate 90% < 95%, pass^k 50% < 90%');
  });

  it('reads a 100% floor as every graded trial passing', () => {
    const verdicts = judgeAcceptanceCriteria(
      { critical: { minPassRate: 1 }, major: { minPassRate: 1 } },
      [
        report({ name: 'findings-present', severity: 'critical', passRate: 1, wilsonLower: 0.886 }),
        report({ name: 'grades-valid', severity: 'major', passes: 29, failures: 1, passRate: 29 / 30, wilsonLower: 0.833 }),
      ],
    );
    expect(verdicts.map((verdict) => [verdict.severity, verdict.status, verdict.reason])).toEqual([
      ['critical', 'met', 'Every counted critical Evaluator reached it'],
      ['major', 'missed', 'grades-valid: pass rate 96.7% < 100%'],
    ]);
  });

  it('cannot judge a severity with no counted Evaluator, or one that graded nothing', () => {
    const verdicts = judgeAcceptanceCriteria(
      { critical: { minPassRate: 0.9 }, major: { minPassRate: 0.8 } },
      [
        report({ name: 'fatal-flagged', severity: 'critical', counted: false }),
        report({ name: 'grades-valid', severity: 'major', wilsonLower: null, passRate: null }),
      ],
    );
    expect(verdicts.map((verdict) => [verdict.severity, verdict.status, verdict.reason])).toEqual([
      ['critical', 'not_evaluable', 'No counted critical Evaluator'],
      ['major', 'not_evaluable', 'grades-valid graded no trial'],
    ]);
  });

  it('lets a miss outweigh an Evaluator that could not be judged', () => {
    const [verdict] = judgeAcceptanceCriteria({ major: { minPassRate: 0.8 } }, [
      report({ name: 'grades-valid', severity: 'major', wilsonLower: null, passRate: null }),
      report({ name: 'terms-meddra', severity: 'major', passRate: 0.4 }),
    ]);
    expect(verdict!.status).toBe('missed');
  });
});

describe('evalRunAcceptance', () => {
  const criteria = { critical: { minPassRate: 0.9 }, major: { minPassRate: 0.8 } };
  const findings = report({ name: 'findings-present', severity: 'critical' });
  const champion = (evaluators: EvalRunEvaluatorReport[]) => ({
    variants: [
      { id: 'champion', criteria: judgeAcceptanceCriteria(criteria, evaluators) },
      // A challenger that misses everything never decides the run.
      { id: 'challenger-1', criteria: judgeAcceptanceCriteria(criteria, [{ ...findings, passes: 0, failures: 30, passRate: 0 }]) },
    ],
  });

  it('is null while the run is prepared or running', () => {
    expect(evalRunAcceptance({ status: 'prepared', acceptanceCriteria: criteria }, champion([findings]))).toBeNull();
    expect(evalRunAcceptance({ status: 'running', acceptanceCriteria: criteria }, champion([findings]))).toBeNull();
  });

  it('says no criteria were frozen into the run', () => {
    expect(evalRunAcceptance({ status: 'completed', acceptanceCriteria: null }, champion([findings])))
      .toEqual({ status: 'no_criteria', reason: 'No Acceptance Criteria were frozen into this run.' });
  });

  it('is met when the champion meets every criterion', () => {
    const graded = report({ name: 'grades-present', severity: 'major' });
    expect(evalRunAcceptance({ status: 'cancelled', acceptanceCriteria: criteria }, champion([findings, graded])))
      .toEqual({ status: 'met', reason: 'Every criterion met.' });
  });

  it('is missed when one criterion is missed, even beside one not judged', () => {
    const failing = { ...findings, passes: 20, failures: 10, passRate: 20 / 30 };
    expect(evalRunAcceptance({ status: 'completed', acceptanceCriteria: criteria }, champion([failing])))
      .toEqual({ status: 'missed', reason: 'critical missed, major not judged' });
  });

  it('is not judged when nothing is missed but a criterion could not be judged', () => {
    expect(evalRunAcceptance({ status: 'budget_exceeded', acceptanceCriteria: criteria }, champion([findings])))
      .toEqual({ status: 'not_judged', reason: 'major not judged' });
  });
});
