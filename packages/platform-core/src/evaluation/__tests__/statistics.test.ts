import { describe, it, expect } from 'vitest';
import { caseReliability, wilsonInterval } from '../statistics';

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
