import { describe, it, expect } from 'vitest';
import type { EvalRunEvaluator, EvaluatorVersion, WorkflowStep } from '@mediforce/platform-core';
import { buildStepExecution } from '@mediforce/platform-core/testing';
import type { CallerScope } from '../../../../repositories/index';
import { estimateEvalRun } from '../estimate-eval-run';
import { evaluationFixture, STEP } from '../../__tests__/fixture';

const workflowStep: WorkflowStep = { id: 'grade-aes', name: 'Grade', type: 'creation', executor: 'agent', agentId: 'ae-grader' };

function withPrices(scope: CallerScope, prices: Record<string, { input: number; output: number }>): CallerScope {
  Object.assign(scope, {
    models: { list: async () => Object.entries(prices).map(([id, pricing]) => ({ id, pricing })) },
  });
  return scope;
}

const champion = { id: 'champion', patch: {} };

const judge: { frozen: EvalRunEvaluator; version: EvaluatorVersion } = {
  frozen: { evaluatorId: '3e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', name: 'grounded', version: 1, kind: 'llm_judge', severity: 'major', counted: false },
  version: {
    evaluatorId: '3e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', version: 1, rule: 'Grades are grounded.', severity: 'major',
    check: { kind: 'llm_judge', model: 'judge/model', rubric: 'r', choices: [{ label: 'yes', value: 1 }, { label: 'no', value: 0 }] },
    origin: 'user', sourceApproval: null, calibration: null, createdBy: 'a', createdAt: '2026-09-23T08:00:00.000Z',
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
          duration_ms: 1000, gitMetadata: null, deliverableFile: null, presentation: null, estimatedCostUsd: cost,
        },
      });
    }
    const estimate = await estimateEvalRun(fixture.scope(), STEP, workflowStep, [], [champion], 10);
    expect(estimate).toEqual({
      perTrialUsd: 0.3, totalUsd: 3, basis: 'history', sampleSize: 2,
      variants: [{ variantId: 'champion', perTrialUsd: 0.3, basis: 'history' }],
    });
  });

  it('falls back to the agent model\'s price for a nominal turn, plus one call per judge', async () => {
    const fixture = await evaluationFixture();
    const scope = withPrices(fixture.scope(), {
      'anthropic/claude-sonnet-4': { input: 0.000003, output: 0.000015 },
      'judge/model': { input: 0.000001, output: 0.000005 },
    });
    const estimate = await estimateEvalRun(scope, STEP, workflowStep, [judge], [champion], 4);
    // Agent: 50k × 3e-6 + 5k × 15e-6 = 0.225; judge: 4k × 1e-6 + 500 × 5e-6 = 0.0065.
    expect(estimate).toMatchObject({ perTrialUsd: 0.2315, totalUsd: 0.926, basis: 'model_pricing', sampleSize: 0 });
  });

  it('has no estimate when neither history nor a price is known', async () => {
    const fixture = await evaluationFixture();
    const estimate = await estimateEvalRun(withPrices(fixture.scope(), {}), STEP, workflowStep, [], [champion], 4);
    expect(estimate).toMatchObject({ perTrialUsd: null, totalUsd: null, basis: 'unknown', sampleSize: 0 });
  });

  it('prices a challenger on another model at that model, for the tokens the step\'s runs used', async () => {
    const fixture = await evaluationFixture();
    for (const instanceId of ['run-graded', 'run-ungraded']) {
      const [execution] = await fixture.instanceRepo.getStepExecutions(instanceId);
      await fixture.instanceRepo.updateStepExecution(instanceId, execution!.id, {
        agentOutput: buildStepExecution({ agentOutput: {
          confidence: 0.9, confidence_rationale: null, reasoning: null, model: 'anthropic/claude-sonnet-4',
          duration_ms: 1000, gitMetadata: null, deliverableFile: null, presentation: null, estimatedCostUsd: 0.2,
          tokenUsage: { inputTokens: 10_000, outputTokens: 1_000 },
        } }).agentOutput,
      });
    }
    const scope = withPrices(fixture.scope(), { 'openai/gpt-5': { input: 0.00001, output: 0.00002 } });

    const estimate = await estimateEvalRun(scope, STEP, workflowStep, [], [champion, { id: 'challenger-1', patch: { model: 'openai/gpt-5' } }], 5);

    // Champion: its history, 0.2. Challenger: 10k × 1e-5 + 1k × 2e-5 = 0.12.
    expect(estimate).toEqual({
      perTrialUsd: 0.16, totalUsd: 1.6, basis: 'history', sampleSize: 2,
      variants: [
        { variantId: 'champion', perTrialUsd: 0.2, basis: 'history' },
        { variantId: 'challenger-1', perTrialUsd: 0.12, basis: 'model_pricing' },
      ],
    });
  });
});
