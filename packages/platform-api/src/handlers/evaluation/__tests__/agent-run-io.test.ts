import { describe, it, expect, beforeEach } from 'vitest';
import { getAgentRunIo } from '../agent-run-io';
import { recordScore } from '../../scores/record-score';
import { userCaller } from '../../../repositories/__tests__/create-test-scope';
import { evaluationFixture, GRADED_RUN, NAMESPACE, UNGRADED_RUN, type EvaluationFixture } from './fixture';

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

  it('reads as missing to a caller outside the run\'s workspace', async () => {
    await expect(getAgentRunIo({ agentRunId: GRADED_RUN }, fixture.scope(userCaller('outsider', ['other-workspace']))))
      .rejects.toThrow('not found');
  });
});
