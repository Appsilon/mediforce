import { describe, it, expect, beforeEach } from 'vitest';
import { NotFoundError, ValidationError } from '../../../errors';
import { userCaller } from '../../../repositories/__tests__/create-test-scope';
import { getEvaluationBrief, setEvaluationBrief } from '../briefs';
import { evaluationFixture, STEP, type EvaluationFixture } from './fixture';

describe('Evaluation Briefs', () => {
  let fixture: EvaluationFixture;
  beforeEach(async () => { fixture = await evaluationFixture(); });

  it('versions every write and serves the newest as current', async () => {
    await setEvaluationBrief({ ...STEP, text: 'Grades AEs for the DSMB.', origin: 'user' }, fixture.scope());
    await setEvaluationBrief({ ...STEP, text: 'A missed grade 5 is critical.', origin: 'assistant' }, fixture.scope());

    const { brief, versions } = await getEvaluationBrief(STEP, fixture.scope());
    expect(brief).toMatchObject({ version: 2, text: 'A missed grade 5 is critical.', origin: 'assistant', createdBy: 'author-1' });
    expect(versions.map((version) => version.version)).toEqual([2, 1]);
    expect(await fixture.auditRepo.getByEntity('evaluation_brief', 'ae-grading/grade-aes')).toHaveLength(2);
  });

  it('only evaluates agent steps', async () => {
    await expect(getEvaluationBrief({ ...STEP, stepId: 'extract-aes' }, fixture.scope()))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('reads a workflow in another workspace as missing', async () => {
    await expect(getEvaluationBrief(STEP, fixture.scope(userCaller('outsider', ['pharma-b']))))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});
