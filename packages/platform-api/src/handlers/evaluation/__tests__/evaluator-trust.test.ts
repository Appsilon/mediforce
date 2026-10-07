import { describe, it, expect, beforeEach } from 'vitest';
import { ValidationError } from '../../../errors';
import { createEvaluator } from '../evaluators';
import { CreateEvaluatorInputSchema } from '../../../contract/evaluation';
import { approveEvaluatorSource } from '../evaluator-trust';
import { evaluationFixture, STEP, type EvaluationFixture } from './fixture';

describe('approveEvaluatorSource', () => {
  let fixture: EvaluationFixture;
  beforeEach(async () => { fixture = await evaluationFixture(); });

  it('records who approved which version, and the approval makes it count', async () => {
    const { evaluator } = await createEvaluator(
      { ...STEP, name: 'grade-5-flagged', rule: 'A fatal AE is graded 5.', check: { kind: 'code', runtime: 'python', source: 'print(1)' }, origin: 'assistant' },
      fixture.scope(),
    );
    const { evaluator: approved } = await approveEvaluatorSource({ evaluatorId: evaluator.id, version: 1 }, fixture.scope());

    expect(approved.latest.sourceApproval).toMatchObject({ approvedBy: 'author-1' });
    expect(approved.trust).toEqual({ trusted: true });
    const [event] = await fixture.auditRepo.getByEntity('evaluator', evaluator.id).then((events) => events.filter((e) => e.action === 'evaluator.source_approved'));
    expect(event?.inputSnapshot).toMatchObject({ source: 'print(1)', version: 1 });
  });

  it('only approves code checks', async () => {
    const { evaluator } = await createEvaluator(
      { ...STEP, name: 'findings-present', rule: 'r', check: { kind: 'schema', schema: { required: ['findings'] } }, origin: 'user' },
      fixture.scope(),
    );
    await expect(approveEvaluatorSource({ evaluatorId: evaluator.id, version: 1 }, fixture.scope()))
      .rejects.toBeInstanceOf(ValidationError);
  });
});

describe('an llm_judge', () => {
  it('counts from creation, holding a new judge to a minimum confidence of 0.8', async () => {
    const fixture = await evaluationFixture();
    const { evaluator } = await createEvaluator(CreateEvaluatorInputSchema.parse({
      ...STEP,
      name: 'grades-justified',
      rule: 'Every grade is justified by the source record.',
      check: { kind: 'llm_judge', model: 'anthropic/claude-haiku-4.5', rubric: 'Is every grade justified by the source record?' },
    }), fixture.scope());

    expect(evaluator.trust).toEqual({ trusted: true });
    expect(evaluator.latest.check).toMatchObject({ kind: 'llm_judge', minConfidence: 0.8 });
  });
});
