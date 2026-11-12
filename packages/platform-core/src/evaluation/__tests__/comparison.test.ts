import { describe, expect, it } from 'vitest';
import { compareToBaseline, recommendationScope, signTestPValue, type TrialGrade } from '../comparison';

const ACCURACY = '00000000-0000-4000-8000-000000000001';
const FORMAT = '00000000-0000-4000-8000-000000000002';

function caseId(index: number): string {
  return `00000000-0000-4000-9000-${String(index).padStart(12, '0')}`;
}

/** One trial per case, passing where `passes[i]` is true. */
function grades(passes: readonly boolean[], evaluatorId = ACCURACY): TrialGrade[] {
  return passes.map((passed, index) => ({ caseId: caseId(index), evaluatorId, outcome: passed === true ? 'pass' : 'fail' }));
}

describe('signTestPValue', () => {
  it('is the two-sided exact binomial tail at p = 0.5', () => {
    expect(signTestPValue(6, 0)).toBeCloseTo(2 / 64, 10);
    expect(signTestPValue(5, 0)).toBeCloseTo(2 / 32, 10);
    expect(signTestPValue(8, 2)).toBeCloseTo(2 * (1 + 10 + 45) / 1024, 10);
  });

  it('is symmetric and never above 1', () => {
    expect(signTestPValue(2, 8)).toBe(signTestPValue(8, 2));
    expect(signTestPValue(3, 3)).toBe(1);
  });

  it('is null when there is nothing to test', () => {
    expect(signTestPValue(0, 0)).toBeNull();
  });
});

describe('compareToBaseline', () => {
  it('calls a Variant better when it wins enough paired cases', () => {
    const baseline = grades([false, false, false, false, false, false, true]);
    const variant = grades([true, true, true, true, true, true, true]);
    const [call] = compareToBaseline({ baseline, variant, evaluatorIds: [ACCURACY] });
    expect(call).toMatchObject({ evaluatorId: ACCURACY, scope: 'all', wins: 6, losses: 0, ties: 1, call: 'better' });
    expect(call!.pValue).toBeCloseTo(2 / 64, 10);
  });

  it('calls a Variant worse when it loses enough paired cases', () => {
    const baseline = grades([true, true, true, true, true, true]);
    const variant = grades([false, false, false, false, false, false]);
    expect(compareToBaseline({ baseline, variant, evaluatorIds: [ACCURACY] })[0]).toMatchObject({ wins: 0, losses: 6, call: 'worse' });
  });

  it('says too few cases below six non-tied cases, even when every one is a win', () => {
    const baseline = grades([false, false, false, false, false]);
    const variant = grades([true, true, true, true, true]);
    expect(compareToBaseline({ baseline, variant, evaluatorIds: [ACCURACY] })[0]).toMatchObject({ wins: 5, call: 'too_few_cases' });
  });

  it('reads all ties as too few cases, with no p-value', () => {
    const same = grades([true, false, true, false, true, false, true]);
    expect(compareToBaseline({ baseline: same, variant: same, evaluatorIds: [ACCURACY] })[0])
      .toMatchObject({ wins: 0, losses: 0, ties: 7, pValue: null, call: 'too_few_cases' });
  });

  it('finds no clear difference when wins and losses balance', () => {
    const baseline = grades([true, true, true, true, false, false, false, false]);
    const variant = grades([false, false, false, false, true, true, true, true]);
    expect(compareToBaseline({ baseline, variant, evaluatorIds: [ACCURACY] })[0]).toMatchObject({ wins: 4, losses: 4, call: 'no_clear_difference' });
  });

  it('compares a case by its pass rate over its trials', () => {
    const id = caseId(0);
    const baseline: TrialGrade[] = [
      { caseId: id, evaluatorId: ACCURACY, outcome: 'pass' },
      { caseId: id, evaluatorId: ACCURACY, outcome: 'fail' },
    ];
    const variant: TrialGrade[] = [
      { caseId: id, evaluatorId: ACCURACY, outcome: 'pass' },
      { caseId: id, evaluatorId: ACCURACY, outcome: 'pass' },
    ];
    expect(compareToBaseline({ baseline, variant, evaluatorIds: [ACCURACY] })[0]).toMatchObject({ wins: 1, losses: 0, ties: 0 });
  });

  it('leaves out a case either run could not grade, and grades that were excluded or errored', () => {
    const baseline: TrialGrade[] = [
      { caseId: caseId(0), evaluatorId: ACCURACY, outcome: 'fail' },
      { caseId: caseId(1), evaluatorId: ACCURACY, outcome: 'errored' },
      { caseId: caseId(2), evaluatorId: ACCURACY, outcome: 'fail' },
    ];
    const variant: TrialGrade[] = [
      { caseId: caseId(0), evaluatorId: ACCURACY, outcome: 'pass' },
      { caseId: caseId(1), evaluatorId: ACCURACY, outcome: 'pass' },
      { caseId: caseId(2), evaluatorId: ACCURACY, outcome: 'excluded' },
    ];
    expect(compareToBaseline({ baseline, variant, evaluatorIds: [ACCURACY] })[0]).toMatchObject({ wins: 1, losses: 0, ties: 0 });
  });

  it('calls each Evaluator on its own grades', () => {
    const baseline = [...grades([false, false, false, false, false, false]), ...grades([true, true, true, true, true, true], FORMAT)];
    const variant = [...grades([true, true, true, true, true, true]), ...grades([true, true, true, true, true, true], FORMAT)];
    const calls = compareToBaseline({ baseline, variant, evaluatorIds: [ACCURACY, FORMAT] });
    expect(calls.map((call) => [call.evaluatorId, call.call])).toEqual([[ACCURACY, 'better'], [FORMAT, 'too_few_cases']]);
  });

  it('reads dev and holdout apart when the cases have both, beside every case', () => {
    const baseline = grades([false, false, false, false, false, false, false, false, false, false, false, false]);
    const variant = grades([true, true, true, true, true, true, true, true, true, true, true, true]);
    const splitOf = (id: string) => (Number(id.slice(-12)) < 6 ? 'dev' as const : 'holdout' as const);
    const calls = compareToBaseline({ baseline, variant, evaluatorIds: [ACCURACY], splitOf });
    expect(calls.map((call) => [call.scope, call.wins, call.call])).toEqual([
      ['all', 12, 'better'],
      ['dev', 6, 'better'],
      ['holdout', 6, 'better'],
    ]);
  });

  it('reads every case only when no split is given', () => {
    const baseline = grades([false, false, false, false, false, false]);
    const variant = grades([true, true, true, true, true, true]);
    expect(compareToBaseline({ baseline, variant, evaluatorIds: [ACCURACY] }).map((call) => call.scope)).toEqual(['all']);
  });

  it('still calls a side of the split the Evaluator graded no case of, as too few cases', () => {
    const baseline = grades([false, false, false, false, false, false]);
    const variant = grades([true, true, true, true, true, true]);
    const calls = compareToBaseline({ baseline, variant, evaluatorIds: [ACCURACY], splitOf: () => 'dev' });
    expect(calls.map((call) => [call.scope, call.wins, call.call])).toEqual([
      ['all', 6, 'better'],
      ['dev', 6, 'better'],
      ['holdout', 0, 'too_few_cases'],
    ]);
  });
});

describe('recommendationScope', () => {
  it('reads holdout for a prompt Variant when the cases have one', () => {
    expect(recommendationScope({ prompt: 'Grade by CTCAE v5.' }, true)).toBe('holdout');
    expect(recommendationScope({ model: 'openai/gpt-4o', prompt: 'Grade by CTCAE v5.' }, true)).toBe('holdout');
  });

  it('reads every case for a model Variant, and when there is no holdout', () => {
    expect(recommendationScope({ model: 'openai/gpt-4o' }, true)).toBe('all');
    expect(recommendationScope({ prompt: 'Grade by CTCAE v5.' }, false)).toBe('all');
  });
});
