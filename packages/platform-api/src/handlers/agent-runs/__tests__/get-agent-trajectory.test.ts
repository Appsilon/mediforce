import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryAgentRunRepository,
  InMemoryAgentTrajectoryRepository,
  InMemoryProcessInstanceRepository,
  buildAgentRun,
  buildProcessInstance,
} from '@mediforce/platform-core/testing';
import { getAgentTrajectory } from '../get-agent-trajectory';
import { NotFoundError } from '../../../errors';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

const AGENT_RUN_ID = '6f1c1b1e-0c5b-4a3e-9a51-2f6a8f0e4d21';

describe('getAgentTrajectory handler', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;
  let agentRunRepo: InMemoryAgentRunRepository;
  let agentTrajectoryRepo: InMemoryAgentTrajectoryRepository;

  beforeEach(async () => {
    instanceRepo = new InMemoryProcessInstanceRepository();
    agentRunRepo = new InMemoryAgentRunRepository(instanceRepo);
    agentTrajectoryRepo = new InMemoryAgentTrajectoryRepository(agentRunRepo);
    await instanceRepo.create(buildProcessInstance({ id: 'inst-1', namespace: 'team-alpha' }));
    await agentRunRepo.create(buildAgentRun({ id: AGENT_RUN_ID, processInstanceId: 'inst-1' }));
    await agentTrajectoryRepo.append(AGENT_RUN_ID, [
      { seq: 0, ts: '2026-09-23T08:00:00.000Z', type: 'assistant', subtype: 'tool_call', tool: 'Grep' },
    ]);
  });

  it('returns the entries of a run in the caller\'s workspace', async () => {
    const scope = createTestScope({
      instanceRepo, agentRunRepo, agentTrajectoryRepo, caller: userCaller('u-1', ['team-alpha']),
    });

    const result = await getAgentTrajectory({ agentRunId: AGENT_RUN_ID }, scope);

    expect(result).toEqual({
      agentRunId: AGENT_RUN_ID,
      entries: [{ seq: 0, ts: '2026-09-23T08:00:00.000Z', type: 'assistant', subtype: 'tool_call', tool: 'Grep' }],
    });
  });

  it('is 404 for a run in another workspace, the same as for no run at all', async () => {
    const outsider = createTestScope({
      instanceRepo, agentRunRepo, agentTrajectoryRepo, caller: userCaller('u-2', ['team-beta']),
    });

    await expect(getAgentTrajectory({ agentRunId: AGENT_RUN_ID }, outsider)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      getAgentTrajectory({ agentRunId: '00000000-0000-4000-8000-000000000000' }, createTestScope({ agentRunRepo, agentTrajectoryRepo })),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
