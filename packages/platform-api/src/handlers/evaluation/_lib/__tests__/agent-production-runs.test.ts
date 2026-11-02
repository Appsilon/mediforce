import { describe, it, expect } from 'vitest';
import { isProductionRunOfAgent, listAgentProductionRuns, loadAgentRunSource } from '../agent-production-runs';
import { listAgentProductionRunsPage } from '../../step-agent-runs';
import { buildAgentRun, buildProcessInstance } from '@mediforce/platform-core/testing';
import { addAgentWorkflowRun, evaluationFixture, GRADED_RUN, NAMESPACE, UNGRADED_RUN, WORKFLOW } from '../../__tests__/fixture';

const AGENT = { kind: 'agent', namespace: NAMESPACE, agentId: 'ae-grader' } as const;

describe('listAgentProductionRuns', () => {
  it('lists the runs of every step using the agent, newest first, capped at the limit', async () => {
    const fixture = await evaluationFixture();
    const { usages, runs } = await listAgentProductionRuns(fixture.scope(), AGENT, 5);
    expect(usages.map(({ workflowName, stepId }) => ({ workflowName, stepId }))).toEqual([{ workflowName: WORKFLOW, stepId: 'grade-aes' }]);
    expect(runs.map(({ agentRun }) => agentRun.id)).toEqual([UNGRADED_RUN, GRADED_RUN]);
    expect((await listAgentProductionRuns(fixture.scope(), AGENT, 1)).runs.map(({ agentRun }) => agentRun.id)).toEqual([UNGRADED_RUN]);
  });

  it('gives each run its workflow run, whose status outlives the Agent Run a review left paused', async () => {
    const fixture = await evaluationFixture();
    const grader = (await fixture.agentDefinitionRepo.getById('ae-grader'))!;
    await fixture.agentDefinitionRepo.upsert('ae-grader', { ...grader, runtimeId: 'claude-code-agent' });
    const { processInstanceId } = (await fixture.scope().agentRuns.getById(UNGRADED_RUN))!;
    await fixture.instanceRepo.update(processInstanceId, { status: 'completed' });
    await fixture.agentRunRepo.update(UNGRADED_RUN, { status: 'paused' });
    const { runs } = await listAgentProductionRunsPage({ namespace: NAMESPACE, agentId: 'ae-grader', limit: 5 }, fixture.scope());
    expect(runs.find(({ agentRun }) => agentRun.id === UNGRADED_RUN)).toMatchObject({ agentRun: { status: 'paused' }, workflowRunStatus: 'completed' });
  });

  it('is empty for an agent no step uses', async () => {
    const fixture = await evaluationFixture();
    expect(await listAgentProductionRuns(fixture.scope(), { ...AGENT, agentId: 'unused' }, 5)).toEqual({ usages: [], runs: [], hasMore: false });
  });
});

describe('how a production run used the Agent', () => {
  it('reads what the step changed from the version the run ran, and pages through the runs', async () => {
    const fixture = await evaluationFixture();
    await addAgentWorkflowRun(fixture, { workflowName: 'as-is', agentRunId: 'run-as-is', result: { findings: [] }, at: '2026-10-03T10:00:00.000Z' });
    await addAgentWorkflowRun(fixture, {
      workflowName: 'customised',
      step: { agent: { prompt: 'Be brief.', skills: [{ namespace: NAMESPACE, id: 'ctcae' }] } as never },
      agentRunId: 'run-customised',
      result: { findings: [] },
      at: '2026-10-02T10:00:00.000Z',
    });
    const { runs, hasMore } = await listAgentProductionRuns(fixture.scope(), AGENT, 2);
    expect(runs.map(({ agentRun, change }) => [agentRun.id, change.changes])).toEqual([
      ['run-as-is', []],
      ['run-customised', ['step prompt', 'skills']],
    ]);
    expect(hasMore).toBe(true);
    const next = await listAgentProductionRuns(fixture.scope(), AGENT, 2, 2);
    expect(next.runs.map(({ agentRun }) => agentRun.id)).toEqual([UNGRADED_RUN, GRADED_RUN]);
    expect(next.hasMore).toBe(false);
  });

  it('marks a step whose output schema differs, and not one that repeats the Agent\'s', async () => {
    const fixture = await evaluationFixture();
    const grader = (await fixture.agentDefinitionRepo.getById('ae-grader'))!;
    const outputSchema = { type: 'object' as const, required: ['findings'] };
    await fixture.agentDefinitionRepo.upsert('ae-grader', { ...grader, outputSchema });
    await addAgentWorkflowRun(fixture, { workflowName: 'other-schema', step: { agent: { outputSchema: { type: 'object', required: ['grades'] } } }, agentRunId: 'run-other', result: { grades: [] }, at: '2026-10-03T10:00:00.000Z' });
    await addAgentWorkflowRun(fixture, { workflowName: 'same-schema', step: { agent: { outputSchema } }, agentRunId: 'run-same', result: { findings: [] }, at: '2026-10-02T10:00:00.000Z' });
    await addAgentWorkflowRun(fixture, { workflowName: 'inherits', agentRunId: 'run-inherits', result: { findings: [] }, at: '2026-10-01T10:00:00.000Z' });
    const scope = fixture.scope();
    expect((await loadAgentRunSource(scope, AGENT, 'run-other')).change).toMatchObject({ changes: ['output schema'], outputSchemaDiffers: true });
    expect((await loadAgentRunSource(scope, AGENT, 'run-same')).change).toMatchObject({ changes: ['output schema'], outputSchemaDiffers: false });
    expect((await loadAgentRunSource(scope, AGENT, 'run-inherits')).change).toMatchObject({ changes: [], outputSchemaDiffers: false });
  });

  it('folds what the agent was given into the case\'s trigger payload, as the step merged it', async () => {
    const fixture = await evaluationFixture();
    await addAgentWorkflowRun(fixture, {
      workflowName: 'mapped',
      step: { stepParams: { language: 'en', term: 'overridden by the input', study: '${triggerPayload.studyId}' } },
      agentRunId: 'run-mapped',
      result: {},
      at: '2026-10-03T10:00:00.000Z',
      stepInput: { term: 'Sepsis', study: 'overridden by the mapping', steps: { extract: { term: 'Sepsis' } } },
    });
    expect((await loadAgentRunSource(fixture.scope(), AGENT, 'run-mapped')).input).toEqual({
      triggerPayload: { language: 'en', term: 'Sepsis', study: 'CDISCPILOT01', steps: { extract: { term: 'Sepsis' } } },
      previousStepOutputs: {},
    });
  });

  it('refuses a run of a step that does not use the Agent', async () => {
    const fixture = await evaluationFixture();
    await expect(loadAgentRunSource(fixture.scope(), { ...AGENT, agentId: 'other' }, GRADED_RUN)).rejects.toThrow('not a production run of a step that uses');
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
