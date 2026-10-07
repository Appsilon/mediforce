import { describe, it, expect } from 'vitest';
import { STEP_FINGERPRINT_COMPONENTS } from '../eval-run';
import { StepQualificationSchema } from '../step-qualification';
import { describeAcceptanceCriteria } from '../../evaluation/acceptance';

describe('StepQualificationSchema', () => {
  it('reads a qualification signed when runs had variants, without its variant keys (ADR-0024)', () => {
    const hash = 'a'.repeat(64);
    const signed = {
      namespace: 'ws-1', workflowName: 'ae-grading', stepId: 'grade-aes',
      id: '0e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', evalRunId: '1e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', definitionVersion: 3,
      variantId: 'champion', variantLabel: 'Current step', patch: {},
      fingerprint: { hash, components: Object.fromEntries(STEP_FINGERPRINT_COMPONENTS.map((component) => [component, hash])) },
      evaluators: [], mcpPolicy: {}, acceptanceCriteria: { critical: { minPassRate: 0.9 } }, verdicts: [], deviations: [],
      signature: { signerId: 'author-1', signerName: 'Ada Author', meaning: 'Approval', signedAt: '2026-09-23T10:00:00.000Z', reauthentication: 'password' },
    };

    const read = StepQualificationSchema.parse(signed);

    expect(read).not.toHaveProperty('variantId');
    expect(read).not.toHaveProperty('patch');
    expect(read.fingerprint.hash).toBe(hash);
  });

  it('reads a qualification signed when Evaluators had a severity, as it was signed', () => {
    const hash = 'b'.repeat(64);
    const criterion = { minPassRate: 0.9 };
    const signed = {
      namespace: 'ws-1', workflowName: 'ae-grading', stepId: 'grade-aes',
      id: '2e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', evalRunId: '3e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', definitionVersion: 3,
      fingerprint: { hash, components: Object.fromEntries(STEP_FINGERPRINT_COMPONENTS.map((component) => [component, hash])) },
      evaluators: [{ evaluatorId: '4e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', name: 'findings-present', version: 1, kind: 'schema', severity: 'critical', counted: true }],
      mcpPolicy: {},
      acceptanceCriteria: { critical: { minPassRate: 1 }, major: criterion },
      verdicts: [
        { severity: 'critical', criterion: { minPassRate: 1 }, status: 'met', evaluators: [], reason: 'Every counted critical Evaluator reached it' },
        { severity: 'major', criterion, status: 'not_evaluable', evaluators: [], reason: 'No counted major Evaluator' },
      ],
      deviations: [{ severity: 'major', justification: 'No major check counts yet.' }],
      signature: { signerId: 'author-1', signerName: 'Ada Author', meaning: 'Approval', signedAt: '2026-09-23T10:00:00.000Z', reauthentication: 'password' },
    };

    const read = StepQualificationSchema.parse(signed);

    expect(read.acceptanceCriteria).toEqual(signed.acceptanceCriteria);
    expect(read.verdicts.map((verdict) => [verdict.severity, verdict.status])).toEqual([['critical', 'met'], ['major', 'not_evaluable']]);
    expect(read.deviations).toEqual(signed.deviations);
    expect(describeAcceptanceCriteria(read.acceptanceCriteria)).toBe('critical: pass rate ≥ 1; major: pass rate ≥ 0.9');
  });
});
