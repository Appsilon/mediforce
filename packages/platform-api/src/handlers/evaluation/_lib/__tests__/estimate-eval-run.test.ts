import { describe, it, expect } from 'vitest';
import type { EvalRunEvaluator, EvaluatorVersion, WorkflowStep } from '@mediforce/platform-core';
import type { CallerScope } from '../../../../repositories/index';
import { estimateEvalRun } from '../estimate-eval-run';
import { evaluationFixture, STEP } from '../../__tests__/fixture';

const workflowStep: WorkflowStep = { id: 'grade-aes', name: 'Grade', type: 'creation', executor: 'agent', agentId: 'ae-grader' };

function asItIs(scope: CallerScope) {
  return { agents: scope.agentDefinitions, useHistory: true };
}

function withPrices(scope: CallerScope, prices: Record<string, { input: number; output: number }>): CallerScope {
  Object.assign(scope, {
    models: { list: async () => Object.entries(prices).map(([id, pricing]) => ({ id, pricing })) },
  });
  return scope;
}

const judge: { frozen: EvalRunEvaluator; version: EvaluatorVersion } = {
  frozen: { evaluatorId: '3e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', name: 'grounded', version: 1, kind: 'llm_judge', counted: false },
  version: {
    evaluatorId: '3e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', version: 1, rule: 'Grades are grounded.',
    check: { kind: 'llm_judge', model: 'judge/model', rubric: 'r', minConfidence: 0.8 },
    origin: 'user', sourceApproval: null, createdBy: 'a', createdAt: '2026-09-23T08:00:00.000Z',
  },
};

describe('estimateEvalRun', () => {
  it('uses the step\'s mean production cost when it has history', async () => {
    const fixture = await evaluationFixture();
    // Each production run's execution records what it cost.
    for (const [instanceId, cost] of [['run-graded', 0.2], ['run-ungraded', 0.4]] as const) {
      const [execution] = await fixture.instanceRepo.getStepExecutions(instanceId);
      await fixture.instanceRepo.updateStepExecution(instanceId, execution!.id, {
        agentOutput: {
          confidence: 0.9, confidence_rationale: null, reasoning: null, model: 'anthropic/claude-sonnet-4',
          duration_ms: 1000, gitMetadata: null, estimatedCostUsd: cost,
        },
      });
    }
    const scope = withPrices(fixture.scope(), { 'openai/gpt-5': { input: 0.000001, output: 0.000002 } });
    const estimate = await estimateEvalRun(scope, STEP, workflowStep, [], 10, asItIs(scope));
    expect(estimate).toEqual({ perTrialUsd: 0.3, totalUsd: 3, basis: 'history', sampleSize: 2 });

    // A Variant on another model is priced by that model, not by what the step spent on its own.
    const variantStep: WorkflowStep = { ...workflowStep, agent: { model: 'openai/gpt-5' } };
    const variant = await estimateEvalRun(scope, STEP, variantStep, [], 10, { agents: scope.agentDefinitions, useHistory: false });
    // 50k × 1e-6 + 5k × 2e-6 = 0.06.
    expect(variant).toEqual({ perTrialUsd: 0.06, totalUsd: 0.6, basis: 'model_pricing', sampleSize: 0 });
  });

  it('falls back to the agent model\'s price for a nominal turn, plus one call per judge', async () => {
    const fixture = await evaluationFixture();
    const scope = withPrices(fixture.scope(), {
      'anthropic/claude-sonnet-4': { input: 0.000003, output: 0.000015 },
      'judge/model': { input: 0.000001, output: 0.000005 },
    });
    const estimate = await estimateEvalRun(scope, STEP, workflowStep, [judge], 4, asItIs(scope));
    // Agent: 50k × 3e-6 + 5k × 15e-6 = 0.225; judge: 4k × 1e-6 + 500 × 5e-6 = 0.0065.
    expect(estimate).toMatchObject({ perTrialUsd: 0.2315, totalUsd: 0.926, basis: 'model_pricing', sampleSize: 0 });
  });

  it('has no estimate when neither history nor a price is known', async () => {
    const fixture = await evaluationFixture();
    const scope = withPrices(fixture.scope(), {});
    const estimate = await estimateEvalRun(scope, STEP, workflowStep, [], 4, asItIs(scope));
    expect(estimate).toMatchObject({ perTrialUsd: null, totalUsd: null, basis: 'unknown', sampleSize: 0 });
  });
});
