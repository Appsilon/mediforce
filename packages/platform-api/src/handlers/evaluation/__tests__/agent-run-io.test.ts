import { describe, it, expect, beforeEach } from 'vitest';
import { getAgentRunIo } from '../agent-run-io';
import { userCaller } from '../../../repositories/__tests__/create-test-scope';
import { evaluationFixture, GRADED_RUN, type EvaluationFixture } from './fixture';

describe('getAgentRunIo', () => {
  let fixture: EvaluationFixture;
  beforeEach(async () => { fixture = await evaluationFixture(); });

  it('gives what the step was given and what it returned, without its trajectory', async () => {
    const io = await getAgentRunIo({ agentRunId: GRADED_RUN }, fixture.scope());

    expect(io).toMatchObject({
      agentRunId: GRADED_RUN,
      status: 'completed',
      stepInput: { events: [{ term: 'Sepsis', outcome: 'fatal' }] },
      result: { findings: [{ term: 'Sepsis', grade: 5 }] },
    });
  });

  it('reads as missing to a caller outside the run\'s workspace', async () => {
    await expect(getAgentRunIo({ agentRunId: GRADED_RUN }, fixture.scope(userCaller('outsider', ['other-workspace']))))
      .rejects.toThrow('not found');
  });
});
