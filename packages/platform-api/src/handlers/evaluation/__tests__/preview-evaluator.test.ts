import { describe, it, expect } from 'vitest';
import { ForbiddenError, NotFoundError } from '../../../errors';
import { userCaller } from '../../../repositories/__tests__/create-test-scope';
import { previewEvaluator } from '../preview-evaluator';
import { evaluationFixture, GRADED_RUN, NAMESPACE, STEP, UNGRADED_RUN } from './fixture';

const findingsSchema = { kind: 'schema' as const, schema: { required: ['findings'] } };

describe('previewEvaluator', () => {
  it('runs a draft check against the step\'s production outputs and writes nothing', async () => {
    const fixture = await evaluationFixture();
    const { results } = await previewEvaluator({ ...STEP, check: findingsSchema, limit: 5 }, fixture.scope());

    expect(results).toEqual(expect.arrayContaining([
      { agentRunId: GRADED_RUN, passed: true, value: 1, label: 'pass', comment: null, error: null },
      { agentRunId: UNGRADED_RUN, passed: false, value: 0, label: 'fail', comment: 'missing required keys: findings', error: null },
    ]));
    expect(await fixture.scoreRepo.list({ limit: 10 })).toEqual([]);
    expect(await fixture.evaluationRepo.listEvaluators(STEP)).toEqual([]);
  });

  it('is refused to a member who may not run the workflow — a preview runs check code and spends the model key', async () => {
    const fixture = await evaluationFixture();
    await fixture.processRepo.setWorkflowAccess(NAMESPACE, STEP.workflowName, { run: ['runner'], edit: [] });
    await expect(previewEvaluator({ ...STEP, check: findingsSchema, limit: 5 }, fixture.scope(userCaller('viewer', [NAMESPACE]))))
      .rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses an Agent Run of another step', async () => {
    const fixture = await evaluationFixture();
    await expect(previewEvaluator(
      { ...STEP, stepId: 'grade-aes', workflowName: 'ae-grading', namespace: NAMESPACE, check: findingsSchema, agentRunIds: ['no-such-run'], limit: 5 },
      fixture.scope(),
    )).rejects.toBeInstanceOf(NotFoundError);
  });
});
