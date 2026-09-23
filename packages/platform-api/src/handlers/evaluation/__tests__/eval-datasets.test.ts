import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ValidationError } from '../../../errors';
import { archiveEvalCase, createEvalCaseFromAgentRun } from '../eval-cases';
import { freezeEvalDataset, listEvalDatasets } from '../eval-datasets';
import { evaluationFixture, GRADED_RUN, STEP, UNGRADED_RUN } from './fixture';

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
