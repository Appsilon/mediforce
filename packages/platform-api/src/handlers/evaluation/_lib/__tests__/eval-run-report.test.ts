import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { EvalRun, EvalTrial } from '@mediforce/platform-core';
import { recordScore } from '../../../scores/record-score';
import { buildEvalRunReport } from '../eval-run-report';
import { evaluationFixture, NAMESPACE, STEP } from '../../__tests__/fixture';

const EVALUATOR = '3e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c';
const CASE_A = '4e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c';
const CASE_B = '5e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c';

function run(): EvalRun {
  return {
    ...STEP, id: randomUUID(), definitionVersion: 1, datasetVersionId: randomUUID(), caseIds: [CASE_A, CASE_B],
    trialsPerCase: 2, concurrency: 2,
    evaluators: [{ evaluatorId: EVALUATOR, name: 'findings-present', version: 1, kind: 'schema', severity: 'critical', counted: true }],
    mcpPolicy: {}, estimate: { perTrialUsd: null, totalUsd: null, basis: 'unknown', sampleSize: 0 },
    budgetUsd: 5, spentUsd: 0, status: 'completed', createdBy: 'a', createdAt: '2026-09-23T08:00:00.000Z', startedAt: null, completedAt: null,
  };
}

function trial(evalRunId: string, caseId: string, trialIndex: number, overrides: Partial<EvalTrial> = {}): EvalTrial {
  return {
    id: randomUUID(), evalRunId, caseId, trialIndex, status: 'scored', processInstanceId: `trial-${caseId}-${trialIndex}`,
    agentRunId: `agent-${caseId}-${trialIndex}`, costUsd: 0.1, inputTokens: 100, outputTokens: 10, durationMs: 1000,
    error: null, startedAt: null, completedAt: null, ...overrides,
  };
}

describe('buildEvalRunReport', () => {
  it('counts each trial\'s Score for the Evaluator, and a trial with none as an error', async () => {
    const fixture = await evaluationFixture();
    const scope = fixture.scope();
    const evalRun = run();
    // Case A: pass, fail (flaky). Case B: pass, and one trial the check could not grade.
    const trials = [trial(evalRun.id, CASE_A, 0), trial(evalRun.id, CASE_A, 1), trial(evalRun.id, CASE_B, 0), trial(evalRun.id, CASE_B, 1, { durationMs: 3000 })];
    for (const [index, value] of [[0, 1], [1, 0], [2, 1]] as const) {
      const scored = trials[index]!;
      await recordScore({
        subject: { type: 'agent_run', id: scored.agentRunId! }, name: 'findings-present', value, label: null, comment: null,
        source: 'deterministic', createdBy: null, metadata: { evalRunId: evalRun.id }, namespace: NAMESPACE,
        processInstanceId: scored.processInstanceId, stepId: STEP.stepId, evaluatorId: EVALUATOR, supersedes: null, basis: 'test',
      }, scope);
    }
    // A Score from another Eval Run on the same trial run is not this report's.
    await recordScore({
      subject: { type: 'agent_run', id: 'x' }, name: 'findings-present', value: 1, label: null, comment: null,
      source: 'deterministic', createdBy: null, metadata: { evalRunId: 'another-run' }, namespace: NAMESPACE,
      processInstanceId: trials[3]!.processInstanceId, stepId: STEP.stepId, evaluatorId: EVALUATOR, supersedes: null, basis: 'test',
    }, scope);

    const report = await buildEvalRunReport(scope, evalRun, trials);

    expect(report.evaluators[0]).toMatchObject({
      passes: 2, failures: 1, errors: 1, passRate: 2 / 3,
      passAtK: 1, passHatK: 0.5, flakiness: 0.5,
    });
    expect(report).toMatchObject({
      k: 2,
      trials: { total: 4, scored: 4, failed: 0, skipped: 0, inProgress: 0 },
      inputTokens: 400, outputTokens: 40, meanDurationMs: 1500, maxDurationMs: 3000,
    });
    expect(report.costUsd).toBeCloseTo(0.4, 10);
  });
});
