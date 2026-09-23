import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ValidationError } from '../../../errors';
import { recordScore } from '../../scores/record-score';
import { archiveEvalCase, createEvalCase, createEvalCaseFromAgentRun, listEvalCases } from '../eval-cases';
import { freezeEvalDataset, listEvalDatasets } from '../eval-datasets';
import { getMcpEvalPolicy, setMcpEvalPolicy } from '../mcp-eval-policy';
import { evaluationFixture, GRADED_RUN, NAMESPACE, STEP, UNGRADED_RUN, type EvaluationFixture } from './fixture';

async function reviewVerdict(fixture: EvaluationFixture, agentRunId: string, value: number, comment: string | null) {
  await recordScore({
    subject: { type: 'agent_run', id: agentRunId },
    name: 'human_verdict',
    value,
    label: value === 1 ? 'approve' : 'reject',
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
    const { evalCase } = await createEvalCaseFromAgentRun({ agentRunId: UNGRADED_RUN, split: 'dev' }, fixture.scope());

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
    const { evalCase } = await createEvalCaseFromAgentRun({ agentRunId: GRADED_RUN, split: 'holdout' }, fixture.scope());
    expect(evalCase).toMatchObject({ expectation: 'positive', split: 'holdout', notes: null });
  });

  it('asks for the expectation of a run nobody reviewed', async () => {
    await expect(createEvalCaseFromAgentRun({ agentRunId: GRADED_RUN, split: 'dev' }, fixture.scope()))
      .rejects.toBeInstanceOf(ValidationError);
    const { evalCase } = await createEvalCaseFromAgentRun({ agentRunId: GRADED_RUN, expectation: 'positive', split: 'dev' }, fixture.scope());
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
    }, fixture.scope());
    expect(evalCase.source).toBe('manual');

    await archiveEvalCase({ caseId: evalCase.id, archived: true }, fixture.scope());
    expect((await listEvalCases(STEP, fixture.scope())).cases).toEqual([]);
    expect((await listEvalCases({ ...STEP, includeArchived: true }, fixture.scope())).cases).toHaveLength(1);
  });
});

describe('Eval Datasets', () => {
  it('freezes the live cases and flags production data', async () => {
    const fixture = await evaluationFixture();
    const { evalCase: production } = await createEvalCaseFromAgentRun({ agentRunId: GRADED_RUN, expectation: 'positive', split: 'dev' }, fixture.scope());
    const { evalCase: archived } = await createEvalCaseFromAgentRun({ agentRunId: UNGRADED_RUN, expectation: 'negative', split: 'dev' }, fixture.scope());
    await archiveEvalCase({ caseId: archived.id, archived: true }, fixture.scope());

    const { dataset } = await freezeEvalDataset(STEP, fixture.scope());
    expect(dataset).toMatchObject({ version: 1, caseIds: [production.id], containsProductionData: true });

    const { dataset: second } = await freezeEvalDataset({ ...STEP, caseIds: [archived.id] }, fixture.scope());
    expect(second.version).toBe(2);
    expect((await listEvalDatasets(STEP, fixture.scope())).datasets.map((row) => row.version)).toEqual([2, 1]);
  });

  it('refuses a case of another step and an empty set', async () => {
    const fixture = await evaluationFixture();
    await expect(freezeEvalDataset(STEP, fixture.scope())).rejects.toBeInstanceOf(ValidationError);
    await expect(freezeEvalDataset({ ...STEP, caseIds: [randomUUID()] }, fixture.scope())).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('MCP eval policy', () => {
  it('denies every server of the step\'s agent until declared safe', async () => {
    const fixture = await evaluationFixture();
    expect((await getMcpEvalPolicy(STEP, fixture.scope())).servers).toEqual([
      { name: 'edc', mode: 'deny', defaulted: true },
      { name: 'email', mode: 'deny', defaulted: true },
    ]);

    await setMcpEvalPolicy({ ...STEP, servers: { edc: { mode: 'live', denyTools: ['write_record'] } } }, fixture.scope());
    expect((await getMcpEvalPolicy(STEP, fixture.scope())).servers).toEqual([
      { name: 'edc', mode: 'live', denyTools: ['write_record'], defaulted: false },
      { name: 'email', mode: 'deny', defaulted: true },
    ]);
  });

  it('refuses a server the agent does not bind, and denied tools with no allowlist', async () => {
    const fixture = await evaluationFixture();
    await expect(setMcpEvalPolicy({ ...STEP, servers: { slack: { mode: 'live' } } }, fixture.scope()))
      .rejects.toThrow(/not an MCP server of this step's agent/);
    await expect(setMcpEvalPolicy({ ...STEP, servers: { email: { mode: 'live', denyTools: ['send'] } } }, fixture.scope()))
      .rejects.toThrow(/lists no allowedTools/);
  });
});
