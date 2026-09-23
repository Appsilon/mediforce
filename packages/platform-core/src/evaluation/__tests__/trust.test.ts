import { describe, it, expect } from 'vitest';
import { evaluatorTrust } from '../trust';
import type { EvaluatorVersion } from '../../schemas/evaluation';

const judgeCheck: EvaluatorVersion['check'] = {
  kind: 'llm_judge',
  model: 'anthropic/claude-sonnet-4',
  rubric: 'Every adverse event carries a CTCAE grade justified by the source record.',
  choices: [{ label: 'grounded', value: 1 }, { label: 'ungrounded', value: 0 }],
};

function calibration(overrides: Partial<NonNullable<EvaluatorVersion['calibration']>> = {}) {
  return { agreement: 0.9, labelCount: 12, failureLabelCount: 3, calibratedAt: '2026-09-23T10:00:00.000Z', ...overrides };
}

describe('evaluatorTrust (ADR-0023 D9)', () => {
  it('trusts a schema check on creation', () => {
    expect(evaluatorTrust({
      check: { kind: 'schema', schema: { required: ['findings'] } },
      sourceApproval: null,
      calibration: null,
    })).toEqual({ trusted: true });
  });

  it('holds a code check until its source is approved', () => {
    const check: EvaluatorVersion['check'] = { kind: 'code', runtime: 'python', source: 'print(1)' };
    expect(evaluatorTrust({ check, sourceApproval: null, calibration: null }))
      .toEqual({ trusted: false, reason: 'source not approved' });
    expect(evaluatorTrust({
      check,
      sourceApproval: { approvedBy: 'reviewer-1', approvedAt: '2026-09-23T10:00:00.000Z' },
      calibration: null,
    })).toEqual({ trusted: true });
  });

  it.each([
    [null, 'not calibrated'],
    [calibration({ labelCount: 9 }), 'calibrated on 9 labels, needs 10'],
    [calibration({ failureLabelCount: 1 }), 'calibrated on 1 failure labels, needs 2'],
    [calibration({ agreement: 0.7 }), 'agreement 0.70 below 0.8'],
  ])('holds a judge short of the calibration bar (%#)', (judgeCalibration, reason) => {
    expect(evaluatorTrust({ check: judgeCheck, sourceApproval: null, calibration: judgeCalibration }))
      .toEqual({ trusted: false, reason });
  });

  it('trusts a judge at 10 labels, 2 failures and 0.8 agreement', () => {
    expect(evaluatorTrust({
      check: judgeCheck,
      sourceApproval: null,
      calibration: calibration({ labelCount: 10, failureLabelCount: 2, agreement: 0.8 }),
    })).toEqual({ trusted: true });
  });
});
