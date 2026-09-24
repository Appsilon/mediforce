import { describe, it, expect, beforeEach } from 'vitest';
import { ValidationError } from '../../../errors';
import { recordScore } from '../../scores/record-score';
import { archiveEvalCase, createEvalCase, createEvalCaseFromAgentRun, listEvalCases } from '../eval-cases';
import { evaluationFixture, GRADED_RUN, NAMESPACE, STEP, UNGRADED_RUN, type EvaluationFixture } from './fixture';

async function reviewVerdict(fixture: EvaluationFixture, agentRunId: string, value: number, comment: string | null) {
  await recordScore({
    subject: { type: 'agent_run', id: agentRunId },
    name: 'human_verdict',
    value,
    label: value === 1 ? 'approve' : value === 0 ? 'reject' : 'revise',
    comment,
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
}

describe('Eval Cases', () => {
  let fixture: EvaluationFixture;
  beforeEach(async () => { fixture = await evaluationFixture(); });

  it('turns a rejected production run into a negative case carrying the reviewer\'s comment', async () => {
    await reviewVerdict(fixture, UNGRADED_RUN, 0, 'No CTCAE grades at all.');
    const { evalCase } = await createEvalCaseFromAgentRun({ agentRunId: UNGRADED_RUN, split: 'dev', origin: 'user' }, fixture.scope());

    expect(evalCase).toMatchObject({
      ...STEP,
      source: 'production',
      sourceAgentRunId: UNGRADED_RUN,
      expectation: 'negative',
      notes: 'No CTCAE grades at all.',
      containsProductionData: true,
      workspaceSeedCommit: null,
      input: {
        triggerPayload: { studyId: 'CDISCPILOT01' },
        previousStepOutputs: { 'extract-aes': { events: [{ term: 'Sepsis', outcome: 'fatal' }] } },
      },
    });
  });

  it('makes an approved run a positive case', async () => {
    await reviewVerdict(fixture, GRADED_RUN, 1, null);
    const { evalCase } = await createEvalCaseFromAgentRun({ agentRunId: GRADED_RUN, split: 'holdout', origin: 'user' }, fixture.scope());
    expect(evalCase).toMatchObject({ expectation: 'positive', split: 'holdout', notes: null });
  });

  it('asks for the expectation of a run sent back for revision, rather than calling it positive', async () => {
    await reviewVerdict(fixture, GRADED_RUN, 0.5, 'Grade the sepsis event again.');
    await expect(createEvalCaseFromAgentRun({ agentRunId: GRADED_RUN, split: 'dev', origin: 'user' }, fixture.scope()))
      .rejects.toThrow(/sent back/);
    const { evalCase } = await createEvalCaseFromAgentRun({ agentRunId: GRADED_RUN, expectation: 'negative', split: 'dev', origin: 'user' }, fixture.scope());
    expect(evalCase).toMatchObject({ expectation: 'negative', notes: 'Grade the sepsis event again.' });
  });

  it('asks for the expectation of a run nobody reviewed', async () => {
    await expect(createEvalCaseFromAgentRun({ agentRunId: GRADED_RUN, split: 'dev', origin: 'user' }, fixture.scope()))
      .rejects.toBeInstanceOf(ValidationError);
    const { evalCase } = await createEvalCaseFromAgentRun({ agentRunId: GRADED_RUN, expectation: 'positive', split: 'dev', origin: 'user' }, fixture.scope());
    expect(evalCase.expectation).toBe('positive');
  });

  it('adds a manual case and hides archived ones from the list', async () => {
    const { evalCase } = await createEvalCase({
      ...STEP,
      name: 'Grade 4 neutropenia',
      input: { triggerPayload: {}, previousStepOutputs: { 'extract-aes': { events: [{ term: 'Neutropenia', anc: 0.4 }] } } },
      workspaceSeedCommit: null,
      expectation: 'positive',
      notes: 'ANC < 0.5 is grade 4.',
      split: 'dev',
      containsProductionData: false,
      origin: 'user',
    }, fixture.scope());
    expect(evalCase.source).toBe('manual');

    await archiveEvalCase({ caseId: evalCase.id, archived: true }, fixture.scope());
    expect((await listEvalCases(STEP, fixture.scope())).cases).toEqual([]);
    expect((await listEvalCases({ ...STEP, includeArchived: true }, fixture.scope())).cases).toHaveLength(1);
  });

  it('records a case from an accepted assistant proposal as the assistant\'s, in the case and its audit entry', async () => {
    const { evalCase } = await createEvalCaseFromAgentRun({ agentRunId: GRADED_RUN, step: STEP, expectation: 'positive', split: 'dev', origin: 'assistant' }, fixture.scope());

    expect(evalCase.origin).toBe('assistant');
    const [event] = await fixture.auditRepo.getByEntity('eval_case', evalCase.id);
    expect(event?.inputSnapshot).toMatchObject({ origin: 'assistant' });
  });

  it('refuses to harvest a run of another step into the step it was asked for', async () => {
    await expect(createEvalCaseFromAgentRun({
      agentRunId: GRADED_RUN, step: { ...STEP, stepId: 'extract-aes' }, expectation: 'positive', split: 'dev', origin: 'assistant',
    }, fixture.scope())).rejects.toThrow("is not a run of step 'extract-aes'");
    expect((await listEvalCases(STEP, fixture.scope())).cases).toEqual([]);
  });

  it('refuses to harvest an eval trial as a production run', async () => {
    await fixture.instanceRepo.update('run-graded', { evalRunId: 'eval-run-1' });
    await expect(createEvalCaseFromAgentRun({ agentRunId: GRADED_RUN, expectation: 'positive', split: 'dev', origin: 'user' }, fixture.scope()))
      .rejects.toThrow('is an eval trial, not a production run');
  });
});
