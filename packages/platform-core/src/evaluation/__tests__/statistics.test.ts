import { describe, it, expect } from 'vitest';
import { caseReliability, cohensKappa, wilsonInterval } from '../statistics';

describe('wilsonInterval', () => {
  it('matches the reference values', () => {
    // 8/10: [0.4902, 0.9433]; 10/10: [0.7225, 1].
    const eight = wilsonInterval(8, 10)!;
    expect(eight.lower).toBeCloseTo(0.4902, 4);
    expect(eight.upper).toBeCloseTo(0.9433, 4);
    const all = wilsonInterval(10, 10)!;
    expect(all.lower).toBeCloseTo(0.7225, 4);
    expect(all.upper).toBeCloseTo(1, 10);
  });

  it('has no interval without trials', () => {
    expect(wilsonInterval(0, 0)).toBeNull();
  });
});

describe('caseReliability', () => {
  it('separates pass@k, pass^k and flakiness', () => {
    const reliability = caseReliability(new Map([
      ['grade-5-sepsis', [true, true, true]],
      ['grade-4-neutropenia', [true, false, true]],
      ['hys-law', [false, false, false]],
      ['never-graded', []],
    ]));
    expect(reliability).toEqual({ passAtK: 2 / 3, passHatK: 1 / 3, flakiness: 1 / 3 });
  });

  it('keeps a trial that could not be graded in its case\'s k, so it cannot lift pass^k', () => {
    const reliability = caseReliability(new Map([
      ['grade-5-sepsis', [true, null]],
      ['hys-law', [null, null]],
    ]));
    expect(reliability).toEqual({ passAtK: 1 / 2, passHatK: 0, flakiness: 0 });
  });

  it('is null with nothing graded', () => {
    expect(caseReliability(new Map([['a', []]]))).toBeNull();
  });
});

describe('cohensKappa', () => {
  const repeat = (count: number, first: boolean, second: boolean) => Array.from({ length: count }, () => ({ first, second }));

  it('matches the reference value', () => {
    // 20 both pass, 5 and 10 split, 15 both fail: observed 0.7, chance 0.5, κ 0.4.
    const pairs = [...repeat(20, true, true), ...repeat(5, true, false), ...repeat(10, false, true), ...repeat(15, false, false)];
    expect(cohensKappa(pairs)).toBeCloseTo(0.4, 10);
  });

  it('is 1 on perfect agreement and 0 or below when agreement is only chance', () => {
    expect(cohensKappa([...repeat(3, true, true), ...repeat(2, false, false)])).toBe(1);
    expect(cohensKappa([...repeat(1, true, true), ...repeat(1, true, false), ...repeat(1, false, true), ...repeat(1, false, false)])).toBe(0);
  });

  it('is undefined without items, or when both raters said the same thing to everything', () => {
    expect(cohensKappa([])).toBeNull();
    expect(cohensKappa(repeat(4, true, true))).toBeNull();
  });
});
