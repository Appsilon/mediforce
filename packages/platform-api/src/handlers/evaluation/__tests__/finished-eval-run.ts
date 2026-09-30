import type { z } from 'zod';
import { WorkflowEngine } from '@mediforce/workflow-engine';
import type { EvalTrial } from '@mediforce/platform-core';
import { buildAgentOutputEnvelope, buildAgentRun, buildStepExecution } from '@mediforce/platform-core/testing';
import { noopRunKicker, type NoopRunKicker } from '../../../runtime/run-kicker';
import type { CallerScope } from '../../../repositories/index';
import type { PrepareEvalRunInputSchema } from '../../../contract/evaluation';
import { createEvalCase } from '../eval-cases';
import { createEvaluator } from '../evaluators';
import { freezeEvalDataset } from '../eval-datasets';
import { advanceEvalRunOfInstance, prepareEvalRun, startEvalRun } from '../eval-runs';
import { STEP, type EvaluationFixture } from './fixture';

export interface EvalScenario {
  readonly scope: CallerScope;
  readonly kicker: NoopRunKicker;
  /** Case ids by name, in the frozen Dataset. */
  readonly caseIds: Readonly<Record<string, string>>;
}

/**
 * A scope that can start Eval Runs (with a run kicker that records instead of
 * running), a critical `findings-present` schema Evaluator, and a frozen
 * Dataset of two dev cases, "Grade 5 sepsis" and "Grade 4 neutropenia".
 */
export async function evalScenario(fixture: EvaluationFixture): Promise<EvalScenario> {
  const kicker = noopRunKicker();
  const scope = fixture.scope();
  Object.assign(scope.system, {
    engine: new WorkflowEngine(fixture.processRepo, fixture.instanceRepo, fixture.auditRepo),
    runKicker: kicker,
  });
  await createEvaluator({
    ...STEP, name: 'findings-present', rule: 'The result lists findings.', severity: 'critical',
    check: { kind: 'schema', schema: { required: ['findings'] } }, origin: 'user',
  }, scope);
  const caseIds: Record<string, string> = {};
  for (const name of ['Grade 5 sepsis', 'Grade 4 neutropenia']) {
    const { evalCase } = await createEvalCase({
      ...STEP, name,
      input: { triggerPayload: { studyId: 'CDISCPILOT01' }, previousStepOutputs: { 'extract-aes': { events: [{ term: name }] } } },
      workspaceSeedCommit: null, expectation: 'positive', notes: `${name} must be graded.`, split: 'dev',
      containsProductionData: false, origin: 'user',
    }, scope);
    caseIds[name] = evalCase.id;
  }
  await freezeEvalDataset(STEP, scope);
  return { scope, kicker, caseIds };
}

/** Prepares and starts an Eval Run, then finishes every trial it kicked with the result `resultOf` gives it. */
export async function finishEvalRun(
  fixture: EvaluationFixture,
  scenario: EvalScenario,
  prepare: { trialsPerCase: number; budgetUsd: number; challengers: z.output<typeof PrepareEvalRunInputSchema>['challengers'] },
  resultOf: (trial: EvalTrial) => Record<string, unknown>,
): Promise<string> {
  const { scope, kicker } = scenario;
  const kicksBefore = kicker.kicks.length;
  const { evalRun } = await prepareEvalRun({ ...STEP, concurrency: 4, ...prepare }, scope);
  await startEvalRun({ evalRunId: evalRun.id, confirmedBudgetUsd: evalRun.budgetUsd }, scope);
  for (const { instanceId } of kicker.kicks.slice(kicksBefore)) {
    const trial = (await fixture.evaluationRepo.getTrialByInstanceId(instanceId))!;
    const startedAt = new Date().toISOString();
    await fixture.instanceRepo.addStepExecution(instanceId, buildStepExecution({ instanceId, stepId: 'grade-aes', startedAt }));
    await fixture.agentRunRepo.create(buildAgentRun({
      processInstanceId: instanceId, stepId: 'grade-aes', startedAt,
      envelope: buildAgentOutputEnvelope({ result: resultOf(trial) }),
    }));
    await fixture.instanceRepo.update(instanceId, { status: 'completed', currentStepId: null });
    await advanceEvalRunOfInstance(scope, instanceId);
  }
  return evalRun.id;
}
