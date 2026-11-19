import { describe, it, expect, beforeEach } from 'vitest';
import { recordScore } from '../../scores/record-score';
import { listReviewedRunsForImport, importReviewedRuns } from '../reviewed-runs-import';
import { ListReviewedRunsInputSchema, ImportReviewedRunsInputSchema } from '../../../contract/evaluation';
import { addStepRun, evaluationFixture, GRADED_RUN, NAMESPACE, STEP, UNGRADED_RUN, type EvaluationFixture } from './fixture';

const SENT_BACK_2 = 'agent-run-sent-back-2';

async function reviewVerdict(fixture: EvaluationFixture, agentRunId: string, value: number, comment: string | null) {
  await recordScore({
    subject: { type: 'agent_run', id: agentRunId },
    name: 'human_verdict',
    value,
    label: value === 1 ? 'approve' : 'revise',
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

describe('Importing reviewed runs as Eval Cases in bulk (ADR-0024 D7)', () => {
  let fixture: EvaluationFixture;
  beforeEach(async () => {
    fixture = await evaluationFixture();
    await addStepRun(fixture, { instanceId: 'run-sent-back-2', agentRunId: SENT_BACK_2, result: { summary: 'also ungraded' }, at: '2026-09-22T11:00:00.000Z' });
  });

  const list = (input: Record<string, unknown> = {}) => listReviewedRunsForImport(ListReviewedRunsInputSchema.parse({ ...STEP, ...input }), fixture.scope());
  const importRuns = (input: Record<string, unknown> = {}) => importReviewedRuns(ImportReviewedRunsInputSchema.parse({ ...STEP, ...input }), fixture.scope());

  it('lists only the reviewed runs not yet an Eval Case, filterable by verdict', async () => {
    await reviewVerdict(fixture, GRADED_RUN, 1, null);
    await reviewVerdict(fixture, UNGRADED_RUN, 0.5, 'Fix the grade.');
    // A plain reject with no revise label is neither sent back nor approved: not O5's business.
    const { runs: all } = await list();
    expect(all.map((run) => run.agentRunId).sort()).toEqual([GRADED_RUN, UNGRADED_RUN].sort());

    const { runs: approved } = await list({ verdict: 'approved' });
    expect(approved).toEqual([{ agentRunId: GRADED_RUN, outcome: 'approved', startedAt: expect.any(String), definitionVersion: expect.anything() }]);

    const { runs: sentBack } = await list({ verdict: 'sentBack' });
    expect(sentBack.map((run) => run.agentRunId)).toEqual([UNGRADED_RUN]);
  });

  it('imports two sent-back runs and one approved run as negative/positive cases, split dev/holdout, and skips a re-import', async () => {
    await reviewVerdict(fixture, GRADED_RUN, 1, null);
    await reviewVerdict(fixture, UNGRADED_RUN, 0.5, 'Fix the grade.');
    await reviewVerdict(fixture, SENT_BACK_2, 0.5, 'Fix it again.');

    const { imported, skipped } = await importRuns();
    expect(skipped).toBe(0);
    expect(imported).toHaveLength(3);

    const bySource = new Map(imported.map((evalCase) => [evalCase.sourceAgentRunId, evalCase]));
    expect(bySource.get(GRADED_RUN)).toMatchObject({ expectation: 'positive' });
    expect(bySource.get(UNGRADED_RUN)).toMatchObject({ expectation: 'negative', comparison: 'agreement' });
    expect(bySource.get(SENT_BACK_2)).toMatchObject({ expectation: 'negative', comparison: 'agreement' });

    const splits = imported.map((evalCase) => evalCase.split);
    expect(splits.filter((split) => split === 'dev')).toHaveLength(2);
    expect(splits.filter((split) => split === 'holdout')).toHaveLength(1);

    const again = await importRuns();
    expect(again.imported).toEqual([]);
    expect(again.skipped).toBe(3);
    expect((await list()).runs).toEqual([]);
  });

  it('imports only the runs named, and refuses one that is not a reviewed run awaiting import', async () => {
    await reviewVerdict(fixture, GRADED_RUN, 1, null);
    await reviewVerdict(fixture, UNGRADED_RUN, 0.5, 'Fix the grade.');

    const { imported } = await importRuns({ agentRunIds: [GRADED_RUN] });
    expect(imported.map((evalCase) => evalCase.sourceAgentRunId)).toEqual([GRADED_RUN]);

    await expect(importRuns({ agentRunIds: [GRADED_RUN] })).rejects.toThrow('Not a reviewed run awaiting import');
  });
});
