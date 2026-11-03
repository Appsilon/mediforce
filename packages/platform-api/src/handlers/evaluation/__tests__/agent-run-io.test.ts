import { describe, it, expect, beforeEach } from 'vitest';
import { getAgentRunIo } from '../agent-run-io';
import { recordScore } from '../../scores/record-score';
import { userCaller } from '../../../repositories/__tests__/create-test-scope';
import { addAgentWorkflowRun, evaluationFixture, GRADED_RUN, NAMESPACE, UNGRADED_RUN, type EvaluationFixture } from './fixture';

describe('getAgentRunIo', () => {
  let fixture: EvaluationFixture;
  beforeEach(async () => { fixture = await evaluationFixture(); });

  it('gives what the step was given and what it returned, without its trajectory', async () => {
    const io = await getAgentRunIo({ agentRunId: GRADED_RUN }, fixture.scope());

    expect(io).toMatchObject({
      agentRunId: GRADED_RUN,
      status: 'completed',
      stepInput: { events: [{ term: 'Sepsis', outcome: 'fatal' }] },
      caseInput: {
        triggerPayload: { studyId: 'CDISCPILOT01' },
        previousStepOutputs: { 'extract-aes': { events: [{ term: 'Sepsis', outcome: 'fatal' }] } },
      },
      result: { findings: [{ term: 'Sepsis', grade: 5 }] },
    });
  });

  it('says what a person\'s review makes of the output: approved is positive, rejected negative, unreviewed neither', async () => {
    const review = (agentRunId: string, value: number) => recordScore({
      subject: { type: 'agent_run', id: agentRunId },
      name: 'human_verdict',
      value,
      label: value === 1 ? 'approve' : 'reject',
      comment: null,
      source: 'human',
      createdBy: 'reviewer-1',
      metadata: null,
      namespace: NAMESPACE,
      processInstanceId: null,
      stepId: 'grade-aes',
      evaluatorId: null,
      supersedes: null,
      basis: 'test',
    }, fixture.scope());

    expect((await getAgentRunIo({ agentRunId: GRADED_RUN }, fixture.scope())).verdictExpectation).toBeNull();
    await review(GRADED_RUN, 1);
    await review(UNGRADED_RUN, 0);
    expect((await getAgentRunIo({ agentRunId: GRADED_RUN }, fixture.scope())).verdictExpectation).toBe('positive');
    expect((await getAgentRunIo({ agentRunId: UNGRADED_RUN }, fixture.scope())).verdictExpectation).toBe('negative');
  });

  it('says a run sent back for revision is negative, compared by meaning on the reviewer\'s comment', async () => {
    await recordScore({
      subject: { type: 'agent_run', id: GRADED_RUN },
      name: 'human_verdict',
      value: 0.5,
      label: 'revise',
      comment: 'Grade the sepsis event again',
      source: 'human',
      createdBy: 'reviewer-1',
      metadata: null,
      namespace: NAMESPACE,
      processInstanceId: null,
      stepId: 'grade-aes',
      evaluatorId: null,
      supersedes: null,
      basis: 'test',
    }, fixture.scope());
    const io = await getAgentRunIo({ agentRunId: GRADED_RUN }, fixture.scope());
    expect(io).toMatchObject({ verdictExpectation: 'negative', verdictComparison: 'agreement' });
    expect(io.verdictAgreementInstructions).toContain('Grade the sepsis event again');
  });

  it('reads as missing to a caller outside the run\'s workspace', async () => {
    await expect(getAgentRunIo({ agentRunId: GRADED_RUN }, fixture.scope(userCaller('outsider', ['other-workspace']))))
      .rejects.toThrow('not found');
  });

  describe('for an Agent evaluated on its own (ADR-0029)', () => {
    const AGENT = { namespace: NAMESPACE, agentId: 'ae-grader' };

    beforeEach(async () => {
      const grader = (await fixture.agentDefinitionRepo.getById('ae-grader'))!;
      await fixture.agentDefinitionRepo.upsert('ae-grader', { ...grader, runtimeId: 'claude-code-agent' });
    });

    it('gives the input as the Agent\'s case holds it, with what the step changed', async () => {
      const io = await getAgentRunIo({ agentRunId: GRADED_RUN, ...AGENT }, fixture.scope());
      expect(io.caseInput.previousStepOutputs).toEqual({});
      expect(io.caseInput.triggerPayload).toMatchObject({ events: [{ term: 'Sepsis', outcome: 'fatal' }], steps: { 'extract-aes': expect.anything() } });
      expect(io.result).toEqual({ findings: [{ term: 'Sepsis', grade: 5 }] });
      expect(io.agentChange).toEqual({ workflowName: 'ae-grading', stepId: 'grade-aes', definitionVersion: 1, changes: ['step prompt'], outputSchemaDiffers: false });
    });

    it('withholds an output under another output schema, and the verdict on it', async () => {
      await addAgentWorkflowRun(fixture, { workflowName: 'other-schema', step: { agent: { outputSchema: { type: 'object', required: ['grades'] } } }, agentRunId: 'run-other', result: { grades: [] }, at: '2026-10-03T10:00:00.000Z' });
      await recordScore({
        subject: { type: 'agent_run', id: 'run-other' },
        name: 'human_verdict',
        value: 1,
        label: 'approve',
        comment: null,
        source: 'human',
        createdBy: 'reviewer-1',
        metadata: null,
        namespace: NAMESPACE,
        processInstanceId: null,
        stepId: 'grade',
        evaluatorId: null,
        supersedes: null,
        basis: 'test',
      }, fixture.scope());
      const io = await getAgentRunIo({ agentRunId: 'run-other', ...AGENT }, fixture.scope());
      expect(io).toMatchObject({ result: null, verdictExpectation: null, agentChange: { outputSchemaDiffers: true, changes: ['output schema'] } });
    });

    it('withholds a revise verdict and its comment on an output under another output schema', async () => {
      await addAgentWorkflowRun(fixture, { workflowName: 'other-schema', step: { agent: { outputSchema: { type: 'object', required: ['grades'] } } }, agentRunId: 'run-other', result: { grades: [] }, at: '2026-10-03T10:00:00.000Z' });
      await recordScore({
        subject: { type: 'agent_run', id: 'run-other' },
        name: 'human_verdict',
        value: 0.5,
        label: 'revise',
        comment: 'Grade it again',
        source: 'human',
        createdBy: 'reviewer-1',
        metadata: null,
        namespace: NAMESPACE,
        processInstanceId: null,
        stepId: 'grade',
        evaluatorId: null,
        supersedes: null,
        basis: 'test',
      }, fixture.scope());
      const io = await getAgentRunIo({ agentRunId: 'run-other', ...AGENT }, fixture.scope());
      expect(io).toMatchObject({ result: null, verdictExpectation: null, verdictComparison: null, verdictAgreementInstructions: null });
    });

    it('refuses a run of a step that does not use the Agent', async () => {
      await expect(getAgentRunIo({ agentRunId: GRADED_RUN, namespace: NAMESPACE, agentId: 'other' }, fixture.scope())).rejects.toThrow();
    });
  });
});
