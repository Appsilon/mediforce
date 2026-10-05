import { describe, it, expect } from 'vitest';
import { evaluatorTrust } from '../trust';
import type { EvaluatorVersion } from '../../schemas/evaluation';

describe('evaluatorTrust (ADR-0023 D9)', () => {
  it('trusts a schema check on creation', () => {
    expect(evaluatorTrust({
      check: { kind: 'schema', schema: { required: ['findings'] } },
      sourceApproval: null,
    })).toEqual({ trusted: true });
  });

  it('trusts a judge on creation; its verdicts are gated one by one', () => {
    expect(evaluatorTrust({
      check: {
        kind: 'llm_judge',
        model: 'anthropic/claude-sonnet-4',
        rubric: 'Every adverse event carries a CTCAE grade justified by the source record.',
        minConfidence: 0.8,
      },
      sourceApproval: null,
    })).toEqual({ trusted: true });
  });

  it('holds a code check until its source is approved', () => {
    const check: EvaluatorVersion['check'] = { kind: 'code', runtime: 'python', source: 'print(1)' };
    expect(evaluatorTrust({ check, sourceApproval: null }))
      .toEqual({ trusted: false, reason: 'source not approved' });
    expect(evaluatorTrust({
      check,
      sourceApproval: { approvedBy: 'reviewer-1', approvedAt: '2026-09-23T10:00:00.000Z' },
    })).toEqual({ trusted: true });
  });
});
