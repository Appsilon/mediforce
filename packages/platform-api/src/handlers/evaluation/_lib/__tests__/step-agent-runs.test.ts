import { describe, it, expect } from 'vitest';
import { listStepProductionAgentRuns } from '../step-agent-runs';
import { buildAgentRun, buildProcessInstance } from '@mediforce/platform-core/testing';
import { evaluationFixture, GRADED_RUN, NAMESPACE, STEP, WORKFLOW } from '../../__tests__/fixture';

describe('listStepProductionAgentRuns', () => {
  it('caps the list at the limit, newest first', async () => {
    const fixture = await evaluationFixture();
    expect((await listStepProductionAgentRuns(fixture.scope(), STEP, 1)).map((run) => run.id)).toHaveLength(1);
    expect((await listStepProductionAgentRuns(fixture.scope(), STEP, 5)).at(-1)?.id).toBe(GRADED_RUN);
  });

  it('leaves out dry runs — their output never reached production', async () => {
    const fixture = await evaluationFixture();
    await fixture.instanceRepo.create(buildProcessInstance({ id: 'run-dry', namespace: NAMESPACE, definitionName: WORKFLOW, dryRun: true }));
    await fixture.agentRunRepo.create(buildAgentRun({
      id: 'agent-run-dry',
      processInstanceId: 'run-dry',
      stepId: 'grade-aes',
      startedAt: '2026-09-22T11:00:00.000Z',
    }));
    const ids = (await listStepProductionAgentRuns(fixture.scope(), STEP, 5)).map((run) => run.id);
    expect(ids).not.toContain('agent-run-dry');
    expect(ids).toContain(GRADED_RUN);
  });

  it('is empty for a workflow with no runs', async () => {
    const fixture = await evaluationFixture();
    expect(await listStepProductionAgentRuns(fixture.scope(), { ...STEP, workflowName: 'never-run' }, 5)).toEqual([]);
  });
});
