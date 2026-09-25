import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DEFAULT_AGENT_IMAGE } from '@mediforce/platform-core';
import { buildWorkflowDefinition } from '@mediforce/platform-core/testing';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../errors';
import { userCaller } from '../../../repositories/__tests__/create-test-scope';
import { applyVariantToStep } from '../apply-step-variant';
import { getStepQualification } from '../step-qualification';
import { computeStepFingerprint } from '../_lib/step-fingerprint';
import { evaluationFixture, NAMESPACE, STEP, WORKFLOW, type EvaluationFixture } from './fixture';
import { evalScenario, finishEvalRun, type EvalScenario } from './finished-eval-run';

vi.mock('../../system/_docker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../system/_docker')>();
  return {
    ...actual,
    isLocalAgentMode: vi.fn().mockReturnValue(false),
    fetchFromContainerWorker: vi.fn().mockResolvedValue({ available: false }),
    fetchFromLocalDocker: vi.fn().mockResolvedValue({ available: false }),
  };
});

const PROMPT = 'Grade each AE by CTCAE v5. Grade 5 is death.';

describe('applyVariantToStep (ADR-0023 D5)', () => {
  let fixture: EvaluationFixture;
  let scenario: EvalScenario;
  let previousAllowLocal: string | undefined;

  beforeEach(async () => {
    previousAllowLocal = process.env.ALLOW_LOCAL_AGENTS;
    process.env.ALLOW_LOCAL_AGENTS = 'true';
    fixture = await evaluationFixture();
    // Version 2 is as registered — plugins named, the agent's image set, as the editor's save requires — and the default.
    await fixture.processRepo.saveWorkflowDefinition(buildWorkflowDefinition({
      name: WORKFLOW,
      namespace: NAMESPACE,
      version: 2,
      steps: [
        { id: 'extract-aes', name: 'Extract AEs', type: 'creation', executor: 'script', plugin: 'script-container', script: { runtime: 'python', inlineScript: 'print(1)' } },
        { id: 'grade-aes', name: 'Grade AEs', type: 'creation', executor: 'agent', plugin: 'claude-code-agent', agentId: 'ae-grader', agent: { prompt: 'Grade each AE.', image: DEFAULT_AGENT_IMAGE } },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'extract-aes', to: 'grade-aes' }, { from: 'grade-aes', to: 'done' }],
    }));
    await fixture.processRepo.setDefaultWorkflowVersion(NAMESPACE, WORKFLOW, 2);
    scenario = await evalScenario(fixture);
  });

  afterEach(() => {
    if (previousAllowLocal === undefined) delete process.env.ALLOW_LOCAL_AGENTS;
    else process.env.ALLOW_LOCAL_AGENTS = previousAllowLocal;
  });

  async function runWithChallenger(): Promise<string> {
    return finishEvalRun(fixture, scenario, {
      trialsPerCase: 1, budgetUsd: 5, challengers: [{ label: 'Stricter prompt', patch: { prompt: PROMPT } }],
    }, () => ({ findings: ['graded'] }));
  }

  it('saves a challenger as a new Definition version whose step carries the patch, with the variant\'s Fingerprint', async () => {
    const evalRunId = await runWithChallenger();
    const { scope } = scenario;

    const result = await applyVariantToStep({ ...STEP, evalRunId, variantId: 'challenger-1' }, scope);

    expect(result).toMatchObject({
      definitionVersion: 3,
      variant: { evalRunId, variantId: 'challenger-1', label: 'Stricter prompt', matchesFingerprint: true, changed: [] },
    });
    const saved = await scope.workflowDefinitions.get(NAMESPACE, WORKFLOW, 3);
    expect(saved?.steps.find((step) => step.id === STEP.stepId)?.agent?.prompt).toBe(PROMPT);
    expect(saved?.steps.find((step) => step.id === 'extract-aes')).toBeDefined();
    const original = await scope.workflowDefinitions.get(NAMESPACE, WORKFLOW, 2);
    expect(original?.steps.find((step) => step.id === STEP.stepId)?.agent?.prompt).toBe('Grade each AE.');
    const run = await fixture.evaluationRepo.getEvalRun(evalRunId);
    expect(result.fingerprint.hash).toBe(run?.variants[1]?.fingerprint?.hash);
    const savedStep = saved!.steps.find((step) => step.id === STEP.stepId)!;
    expect((await computeStepFingerprint(scope, saved!, savedStep)).hash).toBe(result.fingerprint.hash);
  });

  it('leaves the default version alone unless asked, and makes the new one the default on request', async () => {
    const evalRunId = await runWithChallenger();
    const kept = await applyVariantToStep({ ...STEP, evalRunId, variantId: 'challenger-1' }, scenario.scope);
    expect(kept).toMatchObject({ definitionVersion: 3, runnable: false });
    expect(await fixture.processRepo.getDefaultWorkflowVersion(NAMESPACE, WORKFLOW)).toBe(2);

    const result = await applyVariantToStep({ ...STEP, evalRunId, variantId: 'challenger-1', setAsDefault: true }, scenario.scope);

    expect(result).toMatchObject({ definitionVersion: 4, runnable: true });
    expect(await fixture.processRepo.getDefaultWorkflowVersion(NAMESPACE, WORKFLOW)).toBe(4);
    expect((await getStepQualification(STEP, scenario.scope)).fingerprint.hash).toBe(result.fingerprint.hash);
  });

  it('applies a bare patch, with no variant to compare against', async () => {
    const result = await applyVariantToStep({ ...STEP, patch: { prompt: PROMPT } }, scenario.scope);
    expect(result).toMatchObject({ definitionVersion: 3, variant: null });
  });

  it('audits what was applied and to which version', async () => {
    await applyVariantToStep({ ...STEP, patch: { prompt: PROMPT } }, scenario.scope);
    const events = await fixture.auditRepo.getByEntity('workflow_definition', WORKFLOW);
    expect(events.find((event) => event.action === 'step_variant.applied')).toMatchObject({
      inputSnapshot: { patch: { prompt: PROMPT }, basedOnVersion: 2 },
      outputSnapshot: { definitionVersion: 3, runnable: false },
    });
  });

  it('refuses the champion, an empty patch, a run of another step and an unknown variant', async () => {
    const evalRunId = await runWithChallenger();
    const { scope } = scenario;
    await expect(applyVariantToStep({ ...STEP, evalRunId, variantId: 'champion' }, scope)).rejects.toThrow(/nothing to apply/);
    await expect(applyVariantToStep({ ...STEP, patch: {} }, scope)).rejects.toThrow(ValidationError);
    await expect(applyVariantToStep({ ...STEP, evalRunId, variantId: 'challenger-7' }, scope)).rejects.toThrow(/has no variant 'challenger-7'/);
    await expect(applyVariantToStep({ ...STEP, stepId: 'extract-aes', evalRunId, variantId: 'challenger-1' }, scope)).rejects.toThrow();
    await expect(applyVariantToStep({ ...STEP, evalRunId: '0e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', variantId: 'challenger-1' }, scope)).rejects.toThrow(NotFoundError);
    expect(await scope.workflowDefinitions.getLatestVersion(NAMESPACE, WORKFLOW)).toBe(2);
  });

  it('refuses a patch the step cannot take, and few-shot examples from a holdout case', async () => {
    const { scope } = scenario;
    await expect(applyVariantToStep({ ...STEP, patch: { skillCommit: 'a'.repeat(40) } }, scope)).rejects.toThrow(/external skills repository/);
    await expect(applyVariantToStep({ ...STEP, patch: { mcpRestrictions: { nowhere: { disable: true } } } }, scope)).rejects.toThrow(/does not bind: nowhere/);
    const { evalCase } = await (await import('../eval-cases')).createEvalCase({
      ...STEP, name: 'Held out', input: { triggerPayload: {}, previousStepOutputs: {} }, workspaceSeedCommit: null,
      expectation: 'positive', notes: null, split: 'holdout', containsProductionData: false, origin: 'user',
    }, scope);
    await expect(applyVariantToStep({ ...STEP, patch: { examples: [{ input: 'i', output: 'o', caseId: evalCase.id }] } }, scope))
      .rejects.toThrow(/holdout/);
  });

  it('needs the workflow\'s edit verb', async () => {
    await fixture.processRepo.setWorkflowAccess(NAMESPACE, WORKFLOW, { run: ['viewer-1'], edit: ['someone-else'] });
    const outsider = fixture.scope(userCaller('viewer-1', [NAMESPACE]));
    await expect(applyVariantToStep({ ...STEP, patch: { prompt: PROMPT } }, outsider)).rejects.toThrow(ForbiddenError);
    expect(await fixture.processRepo.getLatestWorkflowVersion(NAMESPACE, WORKFLOW)).toBe(2);
  });
});
