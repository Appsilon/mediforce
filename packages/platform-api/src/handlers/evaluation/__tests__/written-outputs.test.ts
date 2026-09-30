import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createEvaluator } from '../evaluators';
import { calibrateEvaluator, labelEvaluatorOutput, listEvaluatorLabels } from '../evaluator-trust';
import { createEvalCasesFromLabels } from '../eval-cases';
import { archiveWrittenOutput, createWrittenOutput, listWrittenOutputs } from '../written-outputs';
import { evaluationFixture, GRADED_RUN, STEP, type EvaluationFixture } from './fixture';

const judgeCheck = {
  kind: 'llm_judge' as const,
  model: 'anthropic/claude-haiku-4.5',
  rubric: 'Is every AE graded correctly?',
  choices: [{ label: 'graded', value: 1 }, { label: 'ungraded', value: 0 }],
};

describe('written outputs', () => {
  let fixture: EvaluationFixture;
  beforeEach(async () => { fixture = await evaluationFixture(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  async function judge() {
    const { evaluator } = await createEvaluator({ ...STEP, name: 'grades-correct', rule: 'Every grade follows CTCAE.', severity: 'major', check: judgeCheck, origin: 'user' }, fixture.scope());
    return evaluator;
  }

  it('starts from a production run\'s input and is labelled for a judge in the same write', async () => {
    const evaluator = await judge();
    const { writtenOutput, score } = await createWrittenOutput({
      ...STEP,
      basedOnAgentRunId: GRADED_RUN,
      result: { findings: [{ term: 'Sepsis', grade: 2 }] },
      note: 'A fatal event graded 2.',
      origin: 'user',
      label: { evaluatorId: evaluator.id, passed: false, comment: 'Fatal is grade 5.' },
    }, fixture.scope());

    expect(writtenOutput).toMatchObject({
      ...STEP,
      basedOnAgentRunId: GRADED_RUN,
      stepInput: { events: [{ term: 'Sepsis', outcome: 'fatal' }] },
      result: { findings: [{ term: 'Sepsis', grade: 2 }] },
      archived: false,
      createdBy: 'author-1',
    });
    expect(score).toMatchObject({ subject: { type: 'written_output', id: writtenOutput.id }, value: 0, label: 'fail', comment: 'Fatal is grade 5.', processInstanceId: null });
    expect((await listWrittenOutputs(STEP, fixture.scope())).writtenOutputs.map((row) => row.id)).toEqual([writtenOutput.id]);
    const [event] = await fixture.auditRepo.getByEntity('eval_written_output', writtenOutput.id);
    expect(event).toMatchObject({ action: 'eval_written_output.created', inputSnapshot: { basedOnAgentRunId: GRADED_RUN } });
  });

  it('refuses a label on another step\'s written output', async () => {
    const evaluator = await judge();
    const scope = fixture.scope();
    const elsewhere = await scope.evaluation.createWrittenOutput({
      ...STEP, stepId: 'review-aes', id: randomUUID(), stepInput: null, result: { findings: [] }, basedOnAgentRunId: null,
      note: null, origin: 'user', archived: false, createdBy: 'author-1', createdAt: '2026-09-24T08:00:00.000Z',
    });
    await expect(labelEvaluatorOutput({ evaluatorId: evaluator.id, writtenOutputId: elsewhere.id, passed: false }, scope))
      .rejects.toThrow("is not an output of step 'grade-aes'");
  });

  it('is graded by the judge while it is calibrated, beside the labelled production outputs', async () => {
    const evaluator = await judge();
    const scope = fixture.scope();
    await labelEvaluatorOutput({ evaluatorId: evaluator.id, agentRunId: GRADED_RUN, passed: true }, scope);
    const { writtenOutput } = await createWrittenOutput({
      ...STEP, basedOnAgentRunId: GRADED_RUN, result: { findings: [{ term: 'Sepsis', grade: 2 }] }, origin: 'user',
      label: { evaluatorId: evaluator.id, passed: false },
    }, scope);
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"reasoning": "Every event carries a grade.", "choice": "graded"}' }, finish_reason: 'stop' }],
    })));
    vi.stubGlobal('fetch', fetch);
    Object.assign(scope, { workspaceSecrets: { getSecrets: async () => ({ OPENROUTER_API_KEY: 'sk-test' }) } });

    const result = await calibrateEvaluator({ evaluatorId: evaluator.id }, scope);

    expect(result.evaluator.latest.calibration).toMatchObject({ labelCount: 2, failureLabelCount: 1, agreement: 0.5 });
    expect(result.disagreements).toEqual([{ agentRunId: writtenOutput.id, humanPassed: false, judgePassed: true }]);
    const prompts = fetch.mock.calls.map(([, init]) => String((init as RequestInit).body));
    expect(prompts.some((body) => body.includes('\\"grade\\":2') || body.includes('"grade": 2') || body.includes('\\"grade\\": 2'))).toBe(true);
  });

  it('drops out of the labels once archived, and never becomes an Eval Case', async () => {
    const evaluator = await judge();
    const scope = fixture.scope();
    const { writtenOutput } = await createWrittenOutput({
      ...STEP, result: { findings: [] }, origin: 'user', label: { evaluatorId: evaluator.id, passed: false },
    }, scope);

    const seeded = await createEvalCasesFromLabels({ evaluatorId: evaluator.id, split: 'dev' }, scope);
    expect(seeded).toEqual({ cases: [], skipped: [{ agentRunId: writtenOutput.id, reason: 'a written output, not a production run' }] });

    await archiveWrittenOutput({ writtenOutputId: writtenOutput.id, archived: true }, scope);
    expect((await listEvaluatorLabels({ evaluatorId: evaluator.id }, scope)).labels).toEqual([]);
    expect((await listWrittenOutputs(STEP, scope)).writtenOutputs).toEqual([]);
  });
});
