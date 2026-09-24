import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ValidationError } from '../../../errors';
import { createEvaluator } from '../evaluators';
import { approveEvaluatorSource, calibrateEvaluator, labelEvaluatorOutput, listEvaluatorLabels } from '../evaluator-trust';
import { evaluationFixture, GRADED_RUN, STEP, UNGRADED_RUN, type EvaluationFixture } from './fixture';

describe('approveEvaluatorSource', () => {
  let fixture: EvaluationFixture;
  beforeEach(async () => { fixture = await evaluationFixture(); });

  it('records who approved which version, and the approval makes it count', async () => {
    const { evaluator } = await createEvaluator(
      { ...STEP, name: 'grade-5-flagged', rule: 'A fatal AE is graded 5.', severity: 'critical', check: { kind: 'code', runtime: 'python', source: 'print(1)' }, origin: 'assistant' },
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
      { ...STEP, name: 'findings-present', rule: 'r', severity: 'major', check: { kind: 'schema', schema: { required: ['findings'] } }, origin: 'user' },
      fixture.scope(),
    );
    await expect(approveEvaluatorSource({ evaluatorId: evaluator.id, version: 1 }, fixture.scope()))
      .rejects.toBeInstanceOf(ValidationError);
  });
});

describe('labels and calibration', () => {
  let fixture: EvaluationFixture;
  beforeEach(async () => { fixture = await evaluationFixture(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  async function judge() {
    const { evaluator } = await createEvaluator({
      ...STEP,
      name: 'grades-justified',
      rule: 'Every grade is justified by the source record.',
      severity: 'major',
      check: {
        kind: 'llm_judge',
        model: 'anthropic/claude-haiku-4.5',
        rubric: 'Is every AE graded?',
        choices: [{ label: 'graded', value: 1 }, { label: 'ungraded', value: 0 }],
      },
      origin: 'user',
    }, fixture.scope());
    return evaluator;
  }

  it('stores a label as a human Score that a relabel supersedes', async () => {
    const evaluator = await judge();
    const first = await labelEvaluatorOutput({ evaluatorId: evaluator.id, agentRunId: GRADED_RUN, passed: false }, fixture.scope());
    const second = await labelEvaluatorOutput({ evaluatorId: evaluator.id, agentRunId: GRADED_RUN, passed: true, comment: 'Sepsis graded 5.' }, fixture.scope());

    expect(first.score).toMatchObject({ source: 'human', name: 'grades-justified', value: 0, evaluatorId: evaluator.id, supersedes: null });
    expect(second.score).toMatchObject({ value: 1, label: 'pass', comment: 'Sepsis graded 5.', supersedes: first.score.id, createdBy: 'author-1' });
    const { labels } = await listEvaluatorLabels({ evaluatorId: evaluator.id }, fixture.scope());
    expect(labels.map((label) => label.id)).toEqual([second.score.id]);
  });

  it('records how often the judge agreed with the latest labels', async () => {
    const evaluator = await judge();
    await labelEvaluatorOutput({ evaluatorId: evaluator.id, agentRunId: GRADED_RUN, passed: true }, fixture.scope());
    await labelEvaluatorOutput({ evaluatorId: evaluator.id, agentRunId: UNGRADED_RUN, passed: false }, fixture.scope());
    // The judge calls every output graded — right on one, wrong on the other.
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"reasoning": "All events carry a grade.", "choice": "graded"}' }, finish_reason: 'stop' }],
    }))));
    const scope = fixture.scope();
    Object.assign(scope, { workspaceSecrets: { getSecrets: async () => ({ OPENROUTER_API_KEY: 'sk-test' }) } });

    const result = await calibrateEvaluator({ evaluatorId: evaluator.id }, scope);

    // Agreeing on half while saying "graded" to everything is agreement by chance alone: κ 0.
    expect(result.evaluator.latest.calibration).toMatchObject({ agreement: 0.5, kappa: 0, labelCount: 2, failureLabelCount: 1 });
    expect(result.disagreements).toEqual([{ agentRunId: UNGRADED_RUN, humanPassed: false, judgePassed: true }]);
    expect(result.evaluator.trust).toEqual({ trusted: false, reason: 'calibrated on 2 labels, needs 10' });
  });

  it('refuses to calibrate with nothing labelled', async () => {
    const evaluator = await judge();
    await expect(calibrateEvaluator({ evaluatorId: evaluator.id }, fixture.scope())).rejects.toBeInstanceOf(ValidationError);
  });
});
