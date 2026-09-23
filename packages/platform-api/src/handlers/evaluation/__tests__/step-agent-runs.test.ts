import { describe, it, expect } from 'vitest';
import { buildAgentRun } from '@mediforce/platform-core/testing';
import { NotFoundError } from '../../../errors';
import { userCaller } from '../../../repositories/__tests__/create-test-scope';
import { listStepAgentRuns } from '../step-agent-runs';
import { evaluationFixture, GRADED_RUN, STEP, UNGRADED_RUN } from './fixture';

describe('listStepAgentRuns', () => {
  it('lists the step\'s finished production runs, newest first', async () => {
    const fixture = await evaluationFixture();
    await fixture.agentRunRepo.create(buildAgentRun({
      id: 'still-running', processInstanceId: 'run-graded', stepId: 'grade-aes', status: 'running', startedAt: '2026-09-22T11:00:00.000Z',
    }));

    const { runs } = await listStepAgentRuns({ ...STEP, limit: 20 }, fixture.scope());
    expect(runs.map((run) => run.id)).toEqual([UNGRADED_RUN, GRADED_RUN]);
  });

  it('reads as missing from another workspace', async () => {
    const fixture = await evaluationFixture();
    await expect(listStepAgentRuns({ ...STEP, limit: 20 }, fixture.scope(userCaller('outsider', ['pharma-b']))))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});
