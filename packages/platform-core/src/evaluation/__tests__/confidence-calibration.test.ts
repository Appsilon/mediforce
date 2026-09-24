import { describe, it, expect } from 'vitest';
import type { AcceptanceCriterionVerdict } from '../../schemas/eval-run';
import { calibrateConfidence, recommendControl, type ConfidenceOutcome } from '../confidence-calibration';

function outcomes(confidence: number, passes: number, failures: number): ConfidenceOutcome[] {
  return [
    ...Array.from({ length: passes }, () => ({ confidence, passed: true })),
    ...Array.from({ length: failures }, () => ({ confidence, passed: false })),
  ];
}

function verdict(status: AcceptanceCriterionVerdict['status'], minPassRate = 0.8): AcceptanceCriterionVerdict {
  return { severity: 'critical', criterion: { minPassRate }, status, evaluators: [], reason: '' };
}

describe('calibrateConfidence', () => {
  it('bins outcomes and weighs each bin\'s gap between confidence and pass rate', () => {
    const calibration = calibrateConfidence([...outcomes(0.95, 9, 1), ...outcomes(0.5, 5, 5)])!;
    expect(calibration.count).toBe(20);
    expect(calibration.bins).toEqual([
      { lower: 0.4, upper: 0.6, count: 10, meanConfidence: 0.5, passRate: 0.5 },
      { lower: 0.8, upper: 1, count: 10, meanConfidence: 0.95, passRate: 0.9 },
    ]);
    expect(calibration.ece).toBeCloseTo(0.025, 10);
  });

  it('puts a confidence of 1 in the top bin, and has nothing to say without outcomes', () => {
    expect(calibrateConfidence(outcomes(1, 1, 0))!.bins[0]).toMatchObject({ lower: 0.8, upper: 1 });
    expect(calibrateConfidence([])).toBeNull();
  });
});

describe('recommendControl', () => {
  it('keeps review without criteria, with a criterion it could not judge, or without confidence', () => {
    expect(recommendControl(outcomes(0.9, 30, 0), [])).toMatchObject({ controlMode: 'CM3', autonomyLevel: 'L3', confidenceThreshold: null });
    expect(recommendControl(outcomes(0.9, 30, 0), [verdict('met'), verdict('not_evaluable')]).reason).toMatch(/could not be judged/);
    expect(recommendControl([], [verdict('met')]).reason).toMatch(/no confidence/);
  });

  it('recommends the lowest threshold whose outputs pass at the strictest criterion', () => {
    const recommendation = recommendControl(
      [...outcomes(0.95, 30, 0), ...outcomes(0.6, 10, 10)],
      [verdict('missed', 0.8)],
    );
    expect(recommendation).toMatchObject({ controlMode: 'CM4', autonomyLevel: 'L4', confidenceThreshold: 0.95, coverage: 0.6 });
    expect(recommendation.reason).toMatch(/^Not every criterion was met overall/);
  });

  it('lets every output run unreviewed when all of them pass at the floor', () => {
    expect(recommendControl([...outcomes(0.9, 15, 0), ...outcomes(0.7, 15, 0)], [verdict('met', 0.8)]))
      .toMatchObject({ controlMode: 'CM4', confidenceThreshold: 0.7, coverage: 1 });
  });

  it('keeps review when no confidence level separates passing outputs over enough trials', () => {
    expect(recommendControl(outcomes(0.9, 3, 1), [verdict('met', 0.5)]).controlMode).toBe('CM3');
    expect(recommendControl(outcomes(0.9, 10, 10), [verdict('missed', 0.8)]).controlMode).toBe('CM3');
  });
});
