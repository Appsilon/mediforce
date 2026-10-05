import { describe, it, expect, beforeEach } from 'vitest';
import { NotFoundError } from '../../../errors';
import { userCaller } from '../../../repositories/__tests__/create-test-scope';
import { getAcceptanceCriteria, setAcceptanceCriteria } from '../acceptance-criteria';
import { evaluationFixture, STEP, type EvaluationFixture } from './fixture';

describe('Acceptance Criteria (ADR-0023 D10)', () => {
  let fixture: EvaluationFixture;

  beforeEach(async () => {
    fixture = await evaluationFixture();
  });

  it('versions every write, newest first, and audits it', async () => {
    const scope = fixture.scope();
    expect(await getAcceptanceCriteria(STEP, scope)).toEqual({ criteria: null, versions: [] });

    await setAcceptanceCriteria({ ...STEP, criteria: { critical: { minPassRate: 0.9 } }, origin: 'user' }, scope);
    const { criteria } = await setAcceptanceCriteria({
      ...STEP, criteria: { critical: { minPassRate: 0.95, minPassHatK: 0.9 }, minor: { minPassRate: 0.5 } }, origin: 'assistant',
    }, scope);

    expect(criteria).toMatchObject({ version: 2, origin: 'assistant', createdBy: 'author-1' });
    const read = await getAcceptanceCriteria(STEP, scope);
    expect(read.criteria).toEqual(criteria);
    expect(read.versions.map((version) => version.version)).toEqual([2, 1]);
    const events = await fixture.auditRepo.getByEntity('acceptance_criteria', 'ae-grading/grade-aes');
    expect(events.map((event) => event.outputSnapshot)).toEqual(expect.arrayContaining([{ version: 1 }, { version: 2 }]));
    expect(events).toHaveLength(2);
  });

  it('reads a workflow in another workspace as missing, and writes nothing there', async () => {
    const outsider = fixture.scope(userCaller('outsider', ['pharma-b']));
    await expect(setAcceptanceCriteria({ ...STEP, criteria: { major: { minPassRate: 0.8 } }, origin: 'user' }, outsider))
      .rejects.toBeInstanceOf(NotFoundError);
    expect((await getAcceptanceCriteria(STEP, fixture.scope())).versions).toEqual([]);
  });
});
