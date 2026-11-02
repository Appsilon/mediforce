import { describe, it, expect, vi } from 'vitest';
import { buildAgentRun } from '@mediforce/platform-core/testing';
import { CreateEvalCaseFromAgentRunInputSchema, CreateEvalCaseInputSchema } from '../../../contract/evaluation';
import { ForbiddenError, NotFoundError } from '../../../errors';
import { userCaller } from '../../../repositories/__tests__/create-test-scope';
import { createEvalCase, createEvalCaseFromAgentRun } from '../eval-cases';
import { previewEvaluator } from '../preview-evaluator';
import { evaluationFixture, GRADED_RUN, NAMESPACE, STEP, UNGRADED_RUN } from './fixture';

const runCodeCheck = vi.hoisted(() => vi.fn());
vi.mock('@mediforce/agent-runtime', async (importOriginal) => ({
  ...await importOriginal<typeof import('@mediforce/agent-runtime')>(),
  runCodeCheck,
}));

const findingsSchema = { kind: 'schema' as const, schema: { required: ['findings'] } };

describe('previewEvaluator', () => {
  it('runs a draft check against the step\'s production outputs and writes nothing', async () => {
    const fixture = await evaluationFixture();
    const { results } = await previewEvaluator({ ...STEP, check: findingsSchema, limit: 5 }, fixture.scope());

    expect(results).toEqual(expect.arrayContaining([
      { agentRunId: GRADED_RUN, passed: true, value: 1, label: 'pass', confidence: null, agreement: null, comment: null, error: null },
      { agentRunId: UNGRADED_RUN, passed: false, value: 0, label: 'fail', confidence: null, agreement: null, comment: 'missing required keys: findings', error: null },
    ]));
    expect(await fixture.scoreRepo.list({ limit: 10 })).toEqual([]);
    expect(await fixture.evaluationRepo.listEvaluators(STEP)).toEqual([]);
  });

  it('tries the check first on the Eval Cases taken from a run, grading each case\'s expected output in place of the run\'s', async () => {
    const fixture = await evaluationFixture();
    const planted = (await createEvalCaseFromAgentRun(CreateEvalCaseFromAgentRunInputSchema.parse({
      agentRunId: UNGRADED_RUN, name: 'Grade dropped', expectedOutput: { findings: [] }, expectation: 'negative',
    }), fixture.scope())).evalCase;
    await createEvalCase(CreateEvalCaseInputSchema.parse({
      ...STEP, name: 'Written input', input: { triggerPayload: {}, previousStepOutputs: {} }, expectedOutput: { summary: 'none' },
    }), fixture.scope());
    await createEvalCaseFromAgentRun(CreateEvalCaseFromAgentRunInputSchema.parse({ agentRunId: GRADED_RUN, name: 'Unlabelled' }), fixture.scope());

    const { cases, results } = await previewEvaluator({ ...STEP, check: findingsSchema, limit: 5 }, fixture.scope());

    expect(cases).toEqual([expect.objectContaining({ caseId: planted.id, caseName: 'Grade dropped', agentRunId: UNGRADED_RUN, passed: true })]);
    expect(results.map((outcome) => outcome.agentRunId)).toEqual([GRADED_RUN]);
  });

  it('gives a code check the Eval Case it is tried on, as an Eval Run does', async () => {
    const fixture = await evaluationFixture();
    const { evalCase } = await createEvalCaseFromAgentRun(CreateEvalCaseFromAgentRunInputSchema.parse({
      agentRunId: UNGRADED_RUN, name: 'Grade dropped', expectedOutput: { findings: [] },
    }), fixture.scope());
    runCodeCheck.mockResolvedValue({ passed: true, comment: null });

    await previewEvaluator({ ...STEP, check: { kind: 'code', runtime: 'javascript', source: 'process.exit(0)' }, limit: 1 }, fixture.scope());

    expect(runCodeCheck).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ result: { findings: [] }, case: expect.objectContaining({ id: evalCase.id }) }),
    }));
  });

  it('leaves out production runs that produced no result — they say nothing about the check', async () => {
    const fixture = await evaluationFixture();
    await fixture.agentRunRepo.create(buildAgentRun({
      id: 'agent-run-escalated', processInstanceId: 'run-graded', stepId: STEP.stepId, status: 'escalated', envelope: null, startedAt: '2026-09-22T11:00:00.000Z',
    }));

    const { results } = await previewEvaluator({ ...STEP, check: findingsSchema, limit: 5 }, fixture.scope());

    expect(results.map((outcome) => outcome.agentRunId)).toEqual([UNGRADED_RUN, GRADED_RUN]);
  });

  it('tries the check only on the runs named, never on cases', async () => {
    const fixture = await evaluationFixture();
    await createEvalCaseFromAgentRun(CreateEvalCaseFromAgentRunInputSchema.parse({ agentRunId: UNGRADED_RUN, expectedOutput: { findings: [] } }), fixture.scope());

    const { cases, results } = await previewEvaluator({ ...STEP, check: findingsSchema, agentRunIds: [GRADED_RUN], limit: 5 }, fixture.scope());

    expect(cases).toEqual([]);
    expect(results.map((outcome) => outcome.agentRunId)).toEqual([GRADED_RUN]);
  });

  it('refuses an expected-output check: a production output has no expected output to compare with', async () => {
    const fixture = await evaluationFixture();
    await expect(previewEvaluator({ ...STEP, check: { kind: 'expected_output', model: 'anthropic/claude-haiku-4.5', minAgreement: 0.8, maxAgreement: 0.1 }, limit: 5 }, fixture.scope()))
      .rejects.toThrow('cannot be tried on one');
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
