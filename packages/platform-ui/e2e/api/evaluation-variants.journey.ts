import { randomUUID } from 'node:crypto';
import type { EvalRunOutput, ListEvalRunsInput, RegisterWorkflowBody } from '@mediforce/platform-api/contract';
import { ApiError, Mediforce } from '@mediforce/platform-api/client';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { pollUntil } from '../helpers/poll-until';
import { agentStepWorkflow } from '../helpers/agent-step-runs';

/**
 * API E2E for a Variant on an Eval Run (ADR-0024 D2, D3): an Eval Run can run
 * its subject — a Step or an Agent — with another model and prompt, without
 * minting a Workflow Definition or Agent version. The run carries the patch
 * and the Fingerprint of the patched subject, its trials run the patch, and it
 * stays out of the subject's Eval Runs list and validation.
 *
 * MOCK_AGENT=true: the mock agent's first trajectory entry names the model and
 * the instructions it was given.
 */

const BASE_MODEL = 'anthropic/claude-sonnet-4';
const VARIANT_MODEL = 'openai/gpt-4o';
// A moving alias, a model the registry does not list, and one it has retired.
const REFUSED_MODELS = ['~anthropic/claude-sonnet-latest', 'acme/not-a-model', 'openai/gpt-4-0314'];

function apiClient(baseURL: string | undefined): Mediforce {
  if (baseURL === undefined) throw new Error('Playwright baseURL is not configured — cannot build an API client');
  return new Mediforce({ apiKey: process.env.PLATFORM_API_KEY ?? 'test-api-key', baseUrl: baseURL });
}

async function createAgent(mediforce: Mediforce, name: string): Promise<string> {
  const { agent } = await mediforce.agents.create({
    name,
    iconName: 'Bot',
    description: 'Grades adverse events',
    runtimeId: 'claude-code-agent',
    foundationModel: BASE_MODEL,
    systemPrompt: 'You grade adverse events by CTCAE v5.',
    inputDescription: 'Extracted AEs',
    outputDescription: 'Graded AEs',
    namespace: TEST_ORG_HANDLE,
  });
  return agent.id;
}

/** A summary-present Evaluator, one written case and a saved Dataset: enough to prepare an Eval Run. */
async function seedSuite(mediforce: Mediforce, subject: ListEvalRunsInput) {
  await mediforce.evaluation.createEvaluator({
    ...subject, name: 'summary-present', rule: 'The result carries a summary.',
    check: { kind: 'schema', schema: { required: ['summary'] } },
  });
  await mediforce.evaluation.createCase({
    ...subject, name: 'Grade 4 neutropenia', expectation: 'positive',
    input: { triggerPayload: { events: [{ term: 'Neutropenia', anc: 0.4 }] }, previousStepOutputs: {} },
  });
  await mediforce.evaluation.saveDataset(subject);
}

async function expectRefused(mediforce: Mediforce, subject: ListEvalRunsInput, model: string): Promise<void> {
  const refused = await mediforce.evaluation.prepareRun({ ...subject, trialsPerCase: 1, budgetUsd: 1, variant: { model } })
    .then(() => null, (error: unknown) => error);
  expect(refused, `a Variant on '${model}'`).toBeInstanceOf(ApiError);
  expect((refused as ApiError).status).toBe(400);
}

async function runToCompletion(mediforce: Mediforce, evalRunId: string): Promise<EvalRunOutput> {
  await mediforce.evaluation.startRun({ evalRunId, confirmedBudgetUsd: 1 });
  return pollUntil(
    async () => {
      const run = await mediforce.evaluation.getRun({ evalRunId });
      return run.evalRun.status === 'completed' ? run : null;
    },
    { description: `Eval Run ${evalRunId} to complete`, timeoutMs: 90_000 },
  );
}

async function firstTrajectoryText(mediforce: Mediforce, agentRunId: string): Promise<string> {
  return (await mediforce.agentRuns.trajectory({ agentRunId })).entries[0]?.text ?? '';
}

function changedComponents(variant: EvalRunOutput, baseline: EvalRunOutput): string[] {
  const before = baseline.evalRun.fingerprint!.components;
  const after = variant.evalRun.fingerprint!.components;
  return Object.keys(after).filter((component) => after[component as 'step'] !== before[component as 'step']).sort();
}

test.describe('Eval Run Variants — API E2E', () => {
  test('a Step\'s Variant runs another model and prompt, and stays out of its runs list and validation', async ({ baseURL }) => {
    test.setTimeout(180_000);
    const mediforce = apiClient(baseURL);
    const suffix = randomUUID().slice(0, 8);
    const agentId = await createAgent(mediforce, `AE grader ${suffix}`);
    const workflowName = `e2e-eval-variant-${suffix}`;
    await mediforce.workflows.register(
      agentStepWorkflow(workflowName, { autonomyLevel: 'L4', agentId, agent: { prompt: 'Grade each AE.' } }) as RegisterWorkflowBody,
      { namespace: TEST_ORG_HANDLE },
    );
    const step = { namespace: TEST_ORG_HANDLE, workflowName, stepId: 'grade-aes' };
    await seedSuite(mediforce, step);

    for (const model of REFUSED_MODELS) await expectRefused(mediforce, step, model);

    const baseline = await mediforce.evaluation.prepareRun({ ...step, trialsPerCase: 1, budgetUsd: 1 });
    expect(baseline.evalRun.variant).toBeNull();
    // An empty patch is a run of the step as it is.
    const unpatched = await mediforce.evaluation.prepareRun({ ...step, trialsPerCase: 1, budgetUsd: 1, variant: {} });
    expect(unpatched.evalRun.variant).toBeNull();
    expect(unpatched.evalRun.fingerprint).toEqual(baseline.evalRun.fingerprint);
    await runToCompletion(mediforce, baseline.evalRun.id);

    const variant = { model: VARIANT_MODEL, prompt: 'Grade each AE by CTCAE v5, citing the criterion.' };
    const prepared = await mediforce.evaluation.prepareRun({ ...step, trialsPerCase: 2, budgetUsd: 1, variant });
    expect(prepared.evalRun.variant).toEqual(variant);
    expect(prepared.evalRun.variantAgentHash).toBeNull();
    // The Fingerprint is the patched step's: its model and step config differ from the baseline's, nothing else.
    expect(prepared.evalRun.definitionVersion).toBe(baseline.evalRun.definitionVersion);
    expect(prepared.evalRun.fingerprint!.hash).not.toBe(baseline.evalRun.fingerprint!.hash);
    expect(changedComponents(prepared, baseline)).toEqual(['model', 'step']);

    const finished = await runToCompletion(mediforce, prepared.evalRun.id);
    expect(finished.trials).toHaveLength(2);
    for (const trial of finished.trials) {
      expect(trial.status, trial.error ?? '').toBe('scored');
      // The trial's run records the patched Definition it ran.
      const trialRun = await mediforce.processes.get({ instanceId: trial.processInstanceId! });
      expect(trialRun.evalDefinition?.steps.find((candidate) => candidate.id === 'grade-aes')?.agent).toMatchObject(variant);
      const text = await firstTrajectoryText(mediforce, trial.agentRunId!);
      expect(text).toContain(`Model: ${VARIANT_MODEL}.`);
      expect(text).toContain(`| ${variant.prompt}`);
    }
    expect(finished.report.evaluators[0]).toMatchObject({ name: 'summary-present', passes: 2, failures: 0 });

    // The runs list shows only the step as it is, and validation reads the baseline, not the newer Variant run.
    const listed = await mediforce.evaluation.listRuns(step);
    expect(listed.evalRuns.map((run) => run.id).sort()).toEqual([baseline.evalRun.id, unpatched.evalRun.id].sort());
    const qualification = await mediforce.evaluation.getQualification(step);
    expect(qualification.validation.evalRunId).toBe(baseline.evalRun.id);
  });

  test('an Agent\'s Variant replaces its model and system prompt in the trial only', async ({ baseURL }) => {
    test.setTimeout(180_000);
    const mediforce = apiClient(baseURL);
    const agentId = await createAgent(mediforce, `AE grader ${randomUUID().slice(0, 8)}`);
    const subject = { namespace: TEST_ORG_HANDLE, agentId };
    await seedSuite(mediforce, subject);

    for (const model of REFUSED_MODELS) await expectRefused(mediforce, subject, model);

    const baseline = await mediforce.evaluation.prepareRun({ ...subject, trialsPerCase: 1, budgetUsd: 1 });
    await runToCompletion(mediforce, baseline.evalRun.id);

    const variant = { model: VARIANT_MODEL, prompt: 'You grade adverse events by CTCAE v6.' };
    const prepared = await mediforce.evaluation.prepareRun({ ...subject, trialsPerCase: 1, budgetUsd: 1, variant });
    expect(prepared.evalRun).toMatchObject({ variant, agentVersion: 1 });
    expect(changedComponents(prepared, baseline)).toEqual(['model', 'systemPrompt']);
    // The run assessed version 1 with the patch over it; the patch is not a version.
    expect(prepared.assessedAgentVersion?.config).toMatchObject({ foundationModel: BASE_MODEL, systemPrompt: 'You grade adverse events by CTCAE v5.' });
    // It records the hash the patched Agent would have, which applying the Variant matches against (ADR-0024 D3, D6).
    expect(baseline.evalRun.variantAgentHash).toBeNull();
    expect(prepared.evalRun.variantAgentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(prepared.evalRun.variantAgentHash).not.toBe(prepared.assessedAgentVersion?.hash);

    const finished = await runToCompletion(mediforce, prepared.evalRun.id);
    const [trial] = finished.trials;
    expect(trial!.status, trial!.error ?? '').toBe('scored');
    const text = await firstTrajectoryText(mediforce, trial!.agentRunId!);
    expect(text).toContain(`Model: ${VARIANT_MODEL}.`);
    expect(text).toContain(variant.prompt);
    expect(text).not.toContain('CTCAE v5');

    const versions = await mediforce.agents.listVersions({ id: agentId });
    expect(versions.versions.map((version) => version.version)).toEqual([1]);
    const listed = await mediforce.evaluation.listRuns(subject);
    expect(listed.evalRuns.map((run) => run.id)).toEqual([baseline.evalRun.id]);
    const qualification = await mediforce.evaluation.getQualification(subject);
    expect(qualification.validation.evalRunId).toBe(baseline.evalRun.id);
  });
});
