import { describe, it, expect } from 'vitest';
import { listStepProductionAgentRuns } from '../step-agent-runs';
import { evaluationFixture, GRADED_RUN, STEP } from '../../__tests__/fixture';

describe('listStepProductionAgentRuns', () => {
  it('caps the list at the limit, newest first', async () => {
    const fixture = await evaluationFixture();
    expect((await listStepProductionAgentRuns(fixture.scope(), STEP, 1)).map((run) => run.id)).toHaveLength(1);
    expect((await listStepProductionAgentRuns(fixture.scope(), STEP, 5)).at(-1)?.id).toBe(GRADED_RUN);
  });

  it('is empty for a workflow with no runs', async () => {
    const fixture = await evaluationFixture();
    expect(await listStepProductionAgentRuns(fixture.scope(), { ...STEP, workflowName: 'never-run' }, 5)).toEqual([]);
  });
});
