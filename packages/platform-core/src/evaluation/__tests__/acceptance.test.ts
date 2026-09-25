import { describe, it, expect } from 'vitest';
import type { EvalRunEvaluatorReport } from '../../schemas/eval-run';
import { judgeAcceptanceCriteria } from '../acceptance';

function report(overrides: Partial<EvalRunEvaluatorReport> & Pick<EvalRunEvaluatorReport, 'name' | 'severity'>): EvalRunEvaluatorReport {
  return {
    evaluatorId: '00000000-0000-4000-8000-00000000000' + String(overrides.name.length % 10),
    version: 1,
    kind: 'schema',
    counted: true,
    passes: 30,
    failures: 0,
    errors: 0,
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

  it('misses on the Wilson lower bound or on pass^k, naming what fell short', () => {
    const [verdict] = judgeAcceptanceCriteria(
      { critical: { minPassRate: 0.95, minPassHatK: 0.9 } },
      [report({ name: 'findings-present', severity: 'critical', wilsonLower: 0.886, passHatK: 0.5 })],
    );
    expect(verdict!.status).toBe('missed');
    expect(verdict!.reason).toBe('findings-present: lower bound 88.6% < 95%, pass^k 50% < 90%');
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
      report({ name: 'grades-valid', severity: 'major', wilsonLower: null }),
      report({ name: 'terms-meddra', severity: 'major', wilsonLower: 0.4 }),
    ]);
    expect(verdict!.status).toBe('missed');
  });
});
