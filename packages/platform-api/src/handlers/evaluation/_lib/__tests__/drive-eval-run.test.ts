import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowEngine } from '@mediforce/workflow-engine';
import { buildAgentOutputEnvelope, buildAgentRun } from '@mediforce/platform-core/testing';
import { noopRunKicker, type NoopRunKicker } from '../../../../runtime/run-kicker';
import type { CallerScope } from '../../../../repositories/index';
import { createEvaluator } from '../../evaluators';
import { createEvalCase } from '../../eval-cases';
import { freezeEvalDataset } from '../../eval-datasets';
import { prepareEvalRun, startEvalRun } from '../../eval-runs';
import { recordScore } from '../../../scores/record-score';
import { driveEvalRun } from '../drive-eval-run';
import { evaluationFixture, NAMESPACE, STEP, type EvaluationFixture } from '../../__tests__/fixture';

const AN_HOUR_AGO = () => new Date(Date.now() - 60 * 60_000).toISOString();

describe('driveEvalRun', () => {
  let fixture: EvaluationFixture;
  let kicker: NoopRunKicker;
  let scope: CallerScope;

  beforeEach(async () => {
    fixture = await evaluationFixture();
    kicker = noopRunKicker();
    scope = fixture.scope();
    Object.assign(scope.system, {
      engine: new WorkflowEngine(fixture.processRepo, fixture.instanceRepo, fixture.auditRepo),
      runKicker: kicker,
    });
    await createEvaluator({ ...STEP, name: 'findings-present', rule: 'r', severity: 'critical', check: { kind: 'schema', schema: { required: ['findings'] } }, origin: 'user' }, scope);
    await createEvalCase({
      ...STEP, name: 'case', input: { triggerPayload: {}, previousStepOutputs: {} }, workspaceSeedCommit: null,
      expectation: 'positive', notes: null, split: 'dev', containsProductionData: false, origin: 'user',
    }, scope);
    await freezeEvalDataset(STEP, scope);
  });

  it('never starts more than the concurrency, however often it is called', async () => {
    const { evalRun } = await prepareEvalRun({ ...STEP, challengers: [], trialsPerCase: 3, concurrency: 1, budgetUsd: 5 }, scope);
    await startEvalRun({ evalRunId: evalRun.id, confirmedBudgetUsd: 5 }, scope);
    await driveEvalRun(scope, evalRun.id);
    await driveEvalRun(scope, evalRun.id);

    expect(kicker.kicks).toHaveLength(1);
  });

  it('fails a trial whose run ended without an Agent Run, with the run\'s error', async () => {
    const { evalRun } = await prepareEvalRun({ ...STEP, challengers: [], trialsPerCase: 1, concurrency: 1, budgetUsd: 5 }, scope);
    await startEvalRun({ evalRunId: evalRun.id, confirmedBudgetUsd: 5 }, scope);
    const instanceId = kicker.kicks[0]!.instanceId;
    await fixture.instanceRepo.update(instanceId, { status: 'paused', pauseReason: 'missing_env', error: 'OPENROUTER_API_KEY missing' });

    await driveEvalRun(scope, evalRun.id);

    const [trial] = await fixture.evaluationRepo.listTrials(evalRun.id);
    expect(trial).toMatchObject({ status: 'failed', error: 'OPENROUTER_API_KEY missing' });
    expect((await fixture.evaluationRepo.getEvalRun(evalRun.id))?.status).toBe('completed');
  });

  it('creates each trial\'s run under the id it claimed the trial with', async () => {
    const { evalRun } = await prepareEvalRun({ ...STEP, challengers: [], trialsPerCase: 1, concurrency: 1, budgetUsd: 5 }, scope);
    await startEvalRun({ evalRunId: evalRun.id, confirmedBudgetUsd: 5 }, scope);

    const [trial] = await fixture.evaluationRepo.listTrials(evalRun.id);
    expect(trial!.processInstanceId).toBe(kicker.kicks[0]!.instanceId);
    expect(await fixture.instanceRepo.getById(trial!.processInstanceId!)).toMatchObject({ evalRunId: evalRun.id });
  });

  it('still kicks a trial\'s run when creating it threw after the run was stored', async () => {
    const engine = new WorkflowEngine(fixture.processRepo, fixture.instanceRepo, fixture.auditRepo);
    Object.assign(scope.system, {
      engine: {
        createEvalTrial: async (input: Parameters<WorkflowEngine['createEvalTrial']>[0]) => {
          await engine.createEvalTrial(input);
          throw new Error('audit store unavailable');
        },
      },
    });
    const { evalRun } = await prepareEvalRun({ ...STEP, challengers: [], trialsPerCase: 1, concurrency: 1, budgetUsd: 5 }, scope);
    await startEvalRun({ evalRunId: evalRun.id, confirmedBudgetUsd: 5 }, scope);

    const [trial] = await fixture.evaluationRepo.listTrials(evalRun.id);
    expect(trial).toMatchObject({ status: 'running', error: null });
    expect(kicker.kicks.map((kick) => kick.instanceId)).toEqual([trial!.processInstanceId]);
  });

  it('fails a claimed trial whose run was never created once its claim goes stale, and waits while it is fresh', async () => {
    const { evalRun } = await prepareEvalRun({ ...STEP, challengers: [], trialsPerCase: 2, concurrency: 1, budgetUsd: 5 }, scope);
    await fixture.evaluationRepo.transitionEvalRun(evalRun.id, 'prepared', { status: 'running' });
    const [stale, fresh] = await fixture.evaluationRepo.listTrials(evalRun.id);
    // Two drivers died between claiming a trial and creating its run.
    await fixture.evaluationRepo.transitionTrial(stale!.id, 'pending', { status: 'running', processInstanceId: 'never-created-1', startedAt: AN_HOUR_AGO() });
    await fixture.evaluationRepo.transitionTrial(fresh!.id, 'pending', { status: 'running', processInstanceId: 'never-created-2', startedAt: new Date().toISOString() });

    await driveEvalRun(scope, evalRun.id);

    const trials = await fixture.evaluationRepo.listTrials(evalRun.id);
    expect(trials.find((trial) => trial.id === stale!.id)).toMatchObject({ status: 'failed', error: 'The trial\'s Workflow Run was never created' });
    expect(trials.find((trial) => trial.id === fresh!.id)?.status).toBe('running');
  });

  it('takes over a scoring claim whose driver died, without scoring an Evaluator twice', async () => {
    const { evalRun } = await prepareEvalRun({ ...STEP, challengers: [], trialsPerCase: 1, concurrency: 1, budgetUsd: 5 }, scope);
    await startEvalRun({ evalRunId: evalRun.id, confirmedBudgetUsd: 5 }, scope);
    const [trial] = await fixture.evaluationRepo.listTrials(evalRun.id);
    const instanceId = trial!.processInstanceId!;
    await fixture.agentRunRepo.create(buildAgentRun({
      id: 'trial-agent-run', processInstanceId: instanceId, stepId: STEP.stepId, envelope: buildAgentOutputEnvelope({ result: { findings: [] } }),
    }));
    await fixture.instanceRepo.update(instanceId, { status: 'completed', currentStepId: null });
    // A driver claimed it, recorded the Score, then died before marking it scored.
    await fixture.evaluationRepo.transitionTrial(trial!.id, 'running', { status: 'scoring', scoringStartedAt: AN_HOUR_AGO() });
    await recordScore({
      subject: { type: 'agent_run', id: 'trial-agent-run' }, name: 'findings-present', value: 1, label: null, comment: null,
      source: 'deterministic', createdBy: null, metadata: { evalRunId: evalRun.id, trialId: trial!.id }, namespace: NAMESPACE,
      processInstanceId: instanceId, stepId: STEP.stepId, evaluatorId: evalRun.evaluators[0]!.evaluatorId, supersedes: null, basis: 'test',
    }, scope);

    await driveEvalRun(scope, evalRun.id);

    expect((await fixture.evaluationRepo.listTrials(evalRun.id))[0]).toMatchObject({ status: 'scored', agentRunId: 'trial-agent-run' });
    expect(await fixture.scoreRepo.list({ processInstanceId: instanceId, limit: 50 })).toHaveLength(1);
    expect((await fixture.evaluationRepo.getEvalRun(evalRun.id))?.status).toBe('completed');
  });

  it('fails a trial whose scoring was abandoned too often rather than pay for its judges again', async () => {
    const { evalRun } = await prepareEvalRun({ ...STEP, challengers: [], trialsPerCase: 1, concurrency: 1, budgetUsd: 5 }, scope);
    await startEvalRun({ evalRunId: evalRun.id, confirmedBudgetUsd: 5 }, scope);
    const [trial] = await fixture.evaluationRepo.listTrials(evalRun.id);
    await fixture.evaluationRepo.transitionTrial(trial!.id, 'running', { status: 'scoring', scoringStartedAt: AN_HOUR_AGO(), scoringAttempts: 3 });

    await driveEvalRun(scope, evalRun.id);

    expect((await fixture.evaluationRepo.listTrials(evalRun.id))[0]).toMatchObject({ status: 'failed', error: 'Scoring did not finish in 3 attempts' });
    expect((await fixture.evaluationRepo.getEvalRun(evalRun.id))?.status).toBe('completed');
  });

  it('leaves a fresh scoring claim to the driver holding it', async () => {
    const { evalRun } = await prepareEvalRun({ ...STEP, challengers: [], trialsPerCase: 1, concurrency: 1, budgetUsd: 5 }, scope);
    await startEvalRun({ evalRunId: evalRun.id, confirmedBudgetUsd: 5 }, scope);
    const [trial] = await fixture.evaluationRepo.listTrials(evalRun.id);
    await fixture.evaluationRepo.transitionTrial(trial!.id, 'running', { status: 'scoring', scoringStartedAt: new Date().toISOString() });

    await driveEvalRun(scope, evalRun.id);

    expect((await fixture.evaluationRepo.listTrials(evalRun.id))[0]?.status).toBe('scoring');
  });

  it('leaves a run that is not running alone', async () => {
    const { evalRun } = await prepareEvalRun({ ...STEP, challengers: [], trialsPerCase: 1, concurrency: 1, budgetUsd: 5 }, scope);
    await driveEvalRun(scope, evalRun.id);
    expect(kicker.kicks).toEqual([]);
  });
});
