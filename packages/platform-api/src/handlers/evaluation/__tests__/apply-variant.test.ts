import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkflowEngine } from '@mediforce/workflow-engine';
import { buildAgentOutputEnvelope, buildAgentRun, buildStepExecution } from '@mediforce/platform-core/testing';
import { noopRunKicker, type NoopRunKicker } from '../../../runtime/run-kicker';
import { ValidationError } from '../../../errors';
import type { CallerScope } from '../../../repositories/index';
import { createEvaluator } from '../evaluators';
import { createEvalCase } from '../eval-cases';
import { saveEvalDataset } from '../eval-datasets';
import { advanceEvalRunOfInstance } from '../eval-runs';
import { prepareComparison, startComparison } from '../comparisons';
import { applyVariant } from '../apply-variant';
import { getWorkflowValidation } from '../step-qualification';
import { registerWorkflow } from '../../workflows/register-workflow';
import { evaluationFixture, STEP, WORKFLOW, type EvaluationFixture } from './fixture';

const VARIANT = { model: 'openai/gpt-5' };
/** Registers the fixture's v1 again through the real handler, so its agent step's image is stamped in (ADR-0029 D9) the way `applyVariant`'s own registration will stamp its patched copy too. */
async function registerCurrentAsNewVersion(scope: CallerScope): Promise<number> {
  const v1 = (await scope.workflowDefinitions.get(STEP.namespace, WORKFLOW, 1))!;
  const { namespace, version: _version, createdAt: _createdAt, ...body } = v1;
  return (await registerWorkflow({ ...body, namespace }, scope)).version;
}

describe('Applying a Comparison\'s Variant (ADR-0024 D6)', () => {
  let fixture: EvaluationFixture;
  let kicker: NoopRunKicker;
  let scope: CallerScope;
  let previousAllowLocal: string | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    if (previousAllowLocal === undefined) delete process.env.ALLOW_LOCAL_AGENTS;
    else process.env.ALLOW_LOCAL_AGENTS = previousAllowLocal;
  });

  beforeEach(async () => {
    previousAllowLocal = process.env.ALLOW_LOCAL_AGENTS;
    process.env.ALLOW_LOCAL_AGENTS = 'true';
    fixture = await evaluationFixture();
    kicker = noopRunKicker();
    scope = fixture.scope();
    Object.assign(scope.system, {
      engine: new WorkflowEngine(fixture.processRepo, fixture.instanceRepo, fixture.auditRepo),
      runKicker: kicker,
    });
    await createEvaluator({ ...STEP, name: 'findings-present', rule: 'The result lists findings.', check: { kind: 'schema', schema: { required: ['findings'] } }, origin: 'user' }, scope);
    await createEvalCase({
      ...STEP,
      name: 'Grade 5 sepsis',
      input: { triggerPayload: { studyId: 'CDISCPILOT01' }, previousStepOutputs: { 'extract-aes': { events: [{ term: 'Grade 5 sepsis' }] } } },
      workspaceSeedCommit: 'a1b2c3d4',
      expectation: 'positive',
      expectedOutput: null, comparison: 'exact', agreementInstructions: null, evaluatorIds: null,
      split: 'dev',
      containsProductionData: false,
      origin: 'user',
    }, scope);
    await saveEvalDataset(STEP, scope);
  });

  async function finishKickedTrials(variantRunIds: ReadonlySet<string>) {
    for (const { instanceId } of kicker.kicks) {
      const instance = await fixture.instanceRepo.getById(instanceId);
      if (instance === null || instance.status !== 'running') continue;
      const startedAt = new Date().toISOString();
      await fixture.instanceRepo.addStepExecution(instanceId, buildStepExecution({
        instanceId, stepId: 'grade-aes', startedAt,
        agentOutput: {
          confidence: 0.9, confidence_rationale: null, reasoning: null, model: 'anthropic/claude-sonnet-5',
          duration_ms: 1000, gitMetadata: null, tokenUsage: { inputTokens: 100, outputTokens: 20 }, estimatedCostUsd: 0.1,
        },
      }));
      const result = variantRunIds.has(instance.evalRunId ?? '') ? { findings: ['sepsis: 5'] } : { summary: 'nothing' };
      await fixture.agentRunRepo.create(buildAgentRun({ processInstanceId: instanceId, stepId: 'grade-aes', startedAt, envelope: buildAgentOutputEnvelope({ result }) }));
      await fixture.instanceRepo.update(instanceId, { status: 'completed', currentStepId: null });
      await advanceEvalRunOfInstance(scope, instanceId);
    }
  }

  it('applies the winning Variant as a new Workflow Definition version the run\'s own verdict validates, with no new Eval Run', async () => {
    const baseVersion = await registerCurrentAsNewVersion(scope);
    const prepared = await prepareComparison({ ...STEP, variants: [VARIANT], definitionVersion: baseVersion, trialsPerCase: 1, concurrency: 2, budgetUsdPerRun: 1 }, scope);
    await startComparison({ comparisonId: prepared.comparison.id, confirmedBudgetUsd: prepared.comparison.budgetUsd }, scope);
    const variantRunId = prepared.variants[0]!.evalRun.id;
    await finishKickedTrials(new Set([variantRunId]));

    const result = await applyVariant({ comparisonId: prepared.comparison.id, evalRunId: variantRunId, makeDefault: false }, scope);
    expect(result).toEqual({ definitionVersion: baseVersion + 1, agentVersion: null });

    const { versions } = await getWorkflowValidation({ namespace: STEP.namespace, workflowName: WORKFLOW }, scope);
    const applied = versions.find((version) => version.definitionVersion === baseVersion + 1);
    const step = applied?.steps.find((candidate) => candidate.stepId === 'grade-aes');
    expect(step?.validation.evalRunId).toBe(variantRunId);
    expect(step?.validation.status).not.toBe('not_verified');
  });

  it('refuses a run that is not the Comparison\'s, and the baseline run', async () => {
    const baseVersion = await registerCurrentAsNewVersion(scope);
    const prepared = await prepareComparison({ ...STEP, variants: [VARIANT], definitionVersion: baseVersion, trialsPerCase: 1, concurrency: 2, budgetUsdPerRun: 1 }, scope);
    await startComparison({ comparisonId: prepared.comparison.id, confirmedBudgetUsd: prepared.comparison.budgetUsd }, scope);
    await finishKickedTrials(new Set([prepared.variants[0]!.evalRun.id]));

    await expect(applyVariant({ comparisonId: prepared.comparison.id, evalRunId: prepared.comparison.baselineEvalRunId, makeDefault: false }, scope))
      .rejects.toThrow(/baseline, not a Variant/);

    const other = await prepareComparison({ ...STEP, variants: [{ model: 'anthropic/claude-sonnet-5' }], definitionVersion: baseVersion, trialsPerCase: 1, concurrency: 1, budgetUsdPerRun: 1 }, scope);
    await expect(applyVariant({ comparisonId: prepared.comparison.id, evalRunId: other.variants[0]!.evalRun.id, makeDefault: false }, scope))
      .rejects.toThrow(/not a run of Comparison/);
  });

  it('refuses to apply once the subject changed since the Comparison was prepared', async () => {
    const baseVersion = await registerCurrentAsNewVersion(scope);
    const prepared = await prepareComparison({ ...STEP, variants: [VARIANT], definitionVersion: baseVersion, trialsPerCase: 1, concurrency: 2, budgetUsdPerRun: 1 }, scope);
    await startComparison({ comparisonId: prepared.comparison.id, confirmedBudgetUsd: prepared.comparison.budgetUsd }, scope);
    const variantRunId = prepared.variants[0]!.evalRun.id;
    await finishKickedTrials(new Set([variantRunId]));

    const current = (await scope.workflowDefinitions.get(STEP.namespace, WORKFLOW, baseVersion))!;
    const { namespace, version: _version, createdAt: _createdAt, ...body } = current;
    await registerWorkflow({
      ...body,
      namespace,
      steps: body.steps.map((candidate) => (candidate.id === 'grade-aes' ? { ...candidate, agent: { ...candidate.agent, prompt: 'Grade each AE, differently now.' } } : candidate)),
    }, scope);

    await expect(applyVariant({ comparisonId: prepared.comparison.id, evalRunId: variantRunId, makeDefault: false }, scope))
      .rejects.toThrow(ValidationError);
  });
});
