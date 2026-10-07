import { describe, it, expect } from 'vitest';
import type { EvalRunEvaluatorReport } from '../../schemas/eval-run';
import { StoredAcceptanceCriteriaSchema } from '../../schemas/evaluation';
import { evalRunAcceptance, judgeAcceptanceCriteria } from '../acceptance';

function report(overrides: Partial<EvalRunEvaluatorReport> & Pick<EvalRunEvaluatorReport, 'name'>): EvalRunEvaluatorReport {
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
    expect(judgeAcceptanceCriteria(null, [report({ name: 'findings-present' })])).toBeNull();
  });

  it('is met when every counted Evaluator reaches the criteria', () => {
    const verdict = judgeAcceptanceCriteria(
      { minPassRate: 0.85, minPassHatK: 0.9 },
      [report({ name: 'findings-present' }), report({ name: 'style', counted: false, passRate: 0.1 })],
    );
    expect(verdict).toMatchObject({ status: 'met', reason: 'Every counted Evaluator reached it' });
    expect(verdict!.evaluators.map((line) => line.name)).toEqual(['findings-present']);
  });

  it('judges the pass rate literally: 8 of 10 meets an 80% floor', () => {
    const verdict = judgeAcceptanceCriteria(
      { minPassRate: 0.8 },
      [report({ name: 'grades-valid', passes: 8, failures: 2, passRate: 0.8, wilsonLower: 0.49 })],
    );
    expect(verdict!.status).toBe('met');
  });

  it('misses on the pass rate or on pass^k, naming what fell short', () => {
    const verdict = judgeAcceptanceCriteria(
      { minPassRate: 0.95, minPassHatK: 0.9 },
      [report({ name: 'findings-present', passes: 27, failures: 3, passRate: 0.9, passHatK: 0.5 })],
    );
    expect(verdict!.status).toBe('missed');
    expect(verdict!.reason).toBe('findings-present: pass rate 90% < 95%, pass^k 50% < 90%');
  });

  it('holds every Evaluator to the same floor: a 100% floor means every graded trial passes', () => {
    const verdict = judgeAcceptanceCriteria(
      { minPassRate: 1 },
      [
        report({ name: 'findings-present', passRate: 1, wilsonLower: 0.886 }),
        report({ name: 'grades-valid', passes: 29, failures: 1, passRate: 29 / 30, wilsonLower: 0.833 }),
      ],
    );
    expect(verdict).toMatchObject({ status: 'missed', reason: 'grades-valid: pass rate 96.7% < 100%' });
  });

  it('cannot judge without a counted Evaluator, or with one that graded nothing', () => {
    expect(judgeAcceptanceCriteria({ minPassRate: 0.9 }, [report({ name: 'fatal-flagged', counted: false })]))
      .toMatchObject({ status: 'not_evaluable', reason: 'No counted Evaluator' });
    expect(judgeAcceptanceCriteria({ minPassRate: 0.8 }, [report({ name: 'grades-valid', wilsonLower: null, passRate: null })]))
      .toMatchObject({ status: 'not_evaluable', reason: 'grades-valid graded no trial' });
  });

  it('lets a miss outweigh an Evaluator that could not be judged', () => {
    const verdict = judgeAcceptanceCriteria({ minPassRate: 0.8 }, [
      report({ name: 'grades-valid', wilsonLower: null, passRate: null }),
      report({ name: 'terms-meddra', passRate: 0.4 }),
    ]);
    expect(verdict!.status).toBe('missed');
  });
});

describe('StoredAcceptanceCriteriaSchema', () => {
  it('reads criteria set per severity as the strictest of them', () => {
    expect(StoredAcceptanceCriteriaSchema.parse({
      critical: { minPassRate: 1 },
      major: { minPassRate: 0.9, minPassHatK: 0.8 },
      minor: { minPassRate: 0.5, minPassHatK: 0.6 },
    })).toEqual({ minPassRate: 1, minPassHatK: 0.8 });
    expect(StoredAcceptanceCriteriaSchema.parse({ minor: { minPassRate: 0.5 } })).toEqual({ minPassRate: 0.5 });
  });

  it('reads current criteria as they are, and refuses ones with no floor', () => {
    expect(StoredAcceptanceCriteriaSchema.parse({ minPassRate: 0.9 })).toEqual({ minPassRate: 0.9 });
    expect(StoredAcceptanceCriteriaSchema.safeParse({}).success).toBe(false);
  });
});

describe('evalRunAcceptance', () => {
  const criteria = { minPassRate: 0.9 };
  const findings = report({ name: 'findings-present' });
  const judged = (evaluators: EvalRunEvaluatorReport[]) => ({ criteriaVerdict: judgeAcceptanceCriteria(criteria, evaluators) });

  it('is null while the run is prepared or running', () => {
    expect(evalRunAcceptance({ status: 'prepared' }, judged([findings]))).toBeNull();
    expect(evalRunAcceptance({ status: 'running' }, judged([findings]))).toBeNull();
  });

  it('says no criteria were frozen into the run', () => {
    expect(evalRunAcceptance({ status: 'completed' }, { criteriaVerdict: null }))
      .toEqual({ status: 'no_criteria', reason: 'No Acceptance Criteria were frozen into this run.' });
  });

  it('is met when the run meets the criteria', () => {
    expect(evalRunAcceptance({ status: 'cancelled' }, judged([findings])))
      .toEqual({ status: 'met', reason: 'Acceptance Criteria met.' });
  });

  it('is missed when an Evaluator misses the criteria, even beside one not judged', () => {
    const failing = { ...findings, passes: 20, failures: 10, passRate: 20 / 30 };
    const ungraded = report({ name: 'grades-valid', passRate: null });
    expect(evalRunAcceptance({ status: 'completed' }, judged([failing, ungraded])))
      .toEqual({ status: 'missed', reason: 'findings-present: pass rate 66.7% < 90%' });
  });

  it('is not judged when nothing is missed but the criteria could not be judged', () => {
    expect(evalRunAcceptance({ status: 'budget_exceeded' }, judged([])))
      .toEqual({ status: 'not_judged', reason: 'No counted Evaluator' });
  });
});
