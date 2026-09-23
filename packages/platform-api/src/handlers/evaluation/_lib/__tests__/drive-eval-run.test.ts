import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowEngine } from '@mediforce/workflow-engine';
import { noopRunKicker, type NoopRunKicker } from '../../../../runtime/run-kicker';
import type { CallerScope } from '../../../../repositories/index';
import { createEvaluator } from '../../evaluators';
import { createEvalCase } from '../../eval-cases';
import { freezeEvalDataset } from '../../eval-datasets';
import { prepareEvalRun, startEvalRun } from '../../eval-runs';
import { driveEvalRun } from '../drive-eval-run';
import { evaluationFixture, STEP, type EvaluationFixture } from '../../__tests__/fixture';

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
      expectation: 'positive', notes: null, split: 'dev', containsProductionData: false,
    }, scope);
    await freezeEvalDataset(STEP, scope);
  });

  it('never starts more than the concurrency, however often it is called', async () => {
    const { evalRun } = await prepareEvalRun({ ...STEP, trialsPerCase: 3, concurrency: 1, budgetUsd: 5 }, scope);
    await startEvalRun({ evalRunId: evalRun.id, confirmedBudgetUsd: 5 }, scope);
    await driveEvalRun(scope, evalRun.id);
    await driveEvalRun(scope, evalRun.id);

    expect(kicker.kicks).toHaveLength(1);
  });

  it('fails a trial whose run ended without an Agent Run, with the run\'s error', async () => {
    const { evalRun } = await prepareEvalRun({ ...STEP, trialsPerCase: 1, concurrency: 1, budgetUsd: 5 }, scope);
    await startEvalRun({ evalRunId: evalRun.id, confirmedBudgetUsd: 5 }, scope);
    const instanceId = kicker.kicks[0]!.instanceId;
    await fixture.instanceRepo.update(instanceId, { status: 'paused', pauseReason: 'missing_env', error: 'OPENROUTER_API_KEY missing' });

    await driveEvalRun(scope, evalRun.id);

    const [trial] = await fixture.evaluationRepo.listTrials(evalRun.id);
    expect(trial).toMatchObject({ status: 'failed', error: 'OPENROUTER_API_KEY missing' });
    expect((await fixture.evaluationRepo.getEvalRun(evalRun.id))?.status).toBe('completed');
  });

  it('leaves a run that is not running alone', async () => {
    const { evalRun } = await prepareEvalRun({ ...STEP, trialsPerCase: 1, concurrency: 1, budgetUsd: 5 }, scope);
    await driveEvalRun(scope, evalRun.id);
    expect(kicker.kicks).toEqual([]);
  });
});
