import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NotFoundError } from '../../../../errors';
import { evaluatorView, loadEvaluator } from '../evaluator-view';
import { evaluationFixture, STEP } from '../../__tests__/fixture';

describe('evaluatorView', () => {
  it('pairs an Evaluator with its versions and the trust of the latest', async () => {
    const fixture = await evaluationFixture();
    const evaluator = { ...STEP, id: randomUUID(), name: 'fatal-flagged', archived: false, createdBy: 'author-1', createdAt: '2026-09-23T08:00:00.000Z' };
    const version = {
      evaluatorId: evaluator.id, version: 1, rule: 'A fatal AE is flagged.', severity: 'critical' as const,
      check: { kind: 'code' as const, runtime: 'python' as const, source: 'print(1)' }, origin: 'user' as const,
      sourceApproval: null, calibration: null, createdBy: 'author-1', createdAt: '2026-09-23T08:00:00.000Z',
    };
    await fixture.evaluationRepo.createEvaluator(evaluator, version);

    const view = await evaluatorView(fixture.scope(), await loadEvaluator(fixture.scope(), evaluator.id));
    expect(view).toMatchObject({ name: 'fatal-flagged', latest: { version: 1 }, trust: { trusted: false, reason: 'source not approved' } });
  });

  it('reads an unknown Evaluator as missing', async () => {
    const fixture = await evaluationFixture();
    await expect(loadEvaluator(fixture.scope(), randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });
});
