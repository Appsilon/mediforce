import { describe, it, expect } from 'vitest';
import { isProductionRunOfAgent, listAgentProductionRuns } from '../agent-production-runs';
import { buildAgentRun, buildProcessInstance } from '@mediforce/platform-core/testing';
import { evaluationFixture, GRADED_RUN, NAMESPACE, UNGRADED_RUN, WORKFLOW } from '../../__tests__/fixture';

const AGENT = { kind: 'agent', namespace: NAMESPACE, agentId: 'ae-grader' } as const;

describe('listAgentProductionRuns', () => {
  it('lists the runs of every step using the agent, newest first, capped at the limit', async () => {
    const fixture = await evaluationFixture();
    const { usages, runs } = await listAgentProductionRuns(fixture.scope(), AGENT, 5);
    expect(usages.map(({ workflowName, stepId }) => ({ workflowName, stepId }))).toEqual([{ workflowName: WORKFLOW, stepId: 'grade-aes' }]);
    expect(runs.map(({ agentRun }) => agentRun.id)).toEqual([UNGRADED_RUN, GRADED_RUN]);
    expect((await listAgentProductionRuns(fixture.scope(), AGENT, 1)).runs.map(({ agentRun }) => agentRun.id)).toEqual([UNGRADED_RUN]);
  });

  it('is empty for an agent no step uses', async () => {
    const fixture = await evaluationFixture();
    expect(await listAgentProductionRuns(fixture.scope(), { ...AGENT, agentId: 'unused' }, 5)).toEqual({ usages: [], runs: [] });
  });
});

describe('isProductionRunOfAgent', () => {
  it('accepts a production run of a step that used the agent', async () => {
    const fixture = await evaluationFixture();
    const scope = fixture.scope();
    const agentRun = (await scope.agentRuns.getById(GRADED_RUN))!;
    const instance = (await scope.runs.getById(agentRun.processInstanceId))!;
    expect(await isProductionRunOfAgent(scope, AGENT, agentRun, instance)).toBe(true);
    expect(await isProductionRunOfAgent(scope, { ...AGENT, agentId: 'other' }, agentRun, instance)).toBe(false);
  });

  it('rejects an eval trial — it is not a production run', async () => {
    const fixture = await evaluationFixture();
    const instance = buildProcessInstance({ id: 'run-trial', namespace: NAMESPACE, definitionName: WORKFLOW, evalRunId: 'eval-1' });
    const agentRun = buildAgentRun({ id: 'agent-run-trial', processInstanceId: 'run-trial', stepId: 'grade-aes' });
    expect(await isProductionRunOfAgent(fixture.scope(), AGENT, agentRun, instance)).toBe(false);
  });
});
