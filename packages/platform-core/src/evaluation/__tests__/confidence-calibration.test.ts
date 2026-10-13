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
  return { criterion: { minPassRate }, status, evaluators: [], reason: '' };
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
  it('keeps review without criteria, or with criteria it could not judge', () => {
    expect(recommendControl(null)).toMatchObject({ autonomyLevel: 'L3' });
    expect(recommendControl(verdict('not_evaluable'))).toMatchObject({ autonomyLevel: 'L3', reason: expect.stringMatching(/could not be judged/) });
  });

  it('lets the agent apply its output when the criteria were met', () => {
    expect(recommendControl(verdict('met', 0.8))).toMatchObject({ autonomyLevel: 'L4', reason: expect.stringMatching(/0\.8/) });
  });

  it('keeps review when the criteria were missed', () => {
    expect(recommendControl(verdict('missed', 0.8)).autonomyLevel).toBe('L3');
  });
});
