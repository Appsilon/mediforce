import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import {
  EvalRunOutputSchema,
  GetAgentTrajectoryOutputSchema,
  GetStepQualificationOutputSchema,
  ListAgentVersionsOutputSchema,
  ListEvalRunsOutputSchema,
  type EvalRunOutput,
} from '@mediforce/platform-api/contract';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { pollUntil } from '../helpers/poll-until';
import { AUTH_HEADERS, JSON_HEADERS, agentStepWorkflow } from '../helpers/agent-step-runs';

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

async function post(request: APIRequestContext, path: string, data: Record<string, unknown>, status = 200) {
  const res = await request.post(path, { headers: JSON_HEADERS, data });
  expect(res.status(), await res.text()).toBe(status);
  return res.json();
}

async function getJson(request: APIRequestContext, path: string) {
  const res = await request.get(path, { headers: AUTH_HEADERS });
  expect(res.status(), await res.text()).toBe(200);
  return res.json();
}

async function createAgent(request: APIRequestContext, name: string): Promise<string> {
  const { agent } = await post(request, '/api/agents', {
    name,
    iconName: 'Bot',
    description: 'Grades adverse events',
    runtimeId: 'claude-code-agent',
    foundationModel: BASE_MODEL,
    systemPrompt: 'You grade adverse events by CTCAE v5.',
    inputDescription: 'Extracted AEs',
    outputDescription: 'Graded AEs',
    namespace: TEST_ORG_HANDLE,
  }, 201) as { agent: { id: string } };
  return agent.id;
}

/** A summary-present Evaluator, one written case and a saved Dataset: enough to prepare an Eval Run. */
async function seedSuite(request: APIRequestContext, subject: Record<string, string>) {
  await post(request, '/api/evaluation/evaluators', {
    ...subject, name: 'summary-present', rule: 'The result carries a summary.',
    check: { kind: 'schema', schema: { required: ['summary'] } },
  }, 201);
  await post(request, '/api/evaluation/cases', {
    ...subject, name: 'Grade 4 neutropenia', expectation: 'positive',
    input: { triggerPayload: { events: [{ term: 'Neutropenia', anc: 0.4 }] }, previousStepOutputs: {} },
  }, 201);
  await post(request, '/api/evaluation/datasets', subject, 201);
}

async function runToCompletion(request: APIRequestContext, evalRunId: string, budgetUsd: number): Promise<EvalRunOutput> {
  await post(request, `/api/evaluation/runs/${evalRunId}/start`, { confirmedBudgetUsd: budgetUsd });
  return pollUntil(
    async () => {
      const body = EvalRunOutputSchema.parse(await getJson(request, `/api/evaluation/runs/${evalRunId}`));
      return body.evalRun.status === 'completed' ? body : null;
    },
    { description: `Eval Run ${evalRunId} to complete`, timeoutMs: 90_000 },
  );
}

async function firstTrajectoryText(request: APIRequestContext, agentRunId: string): Promise<string> {
  return GetAgentTrajectoryOutputSchema.parse(await getJson(request, `/api/agent-runs/${agentRunId}/trajectory`)).entries[0]?.text ?? '';
}

test.describe('Eval Run Variants — API E2E', () => {
  test('a Step\'s Variant runs another model and prompt, and stays out of its runs list and validation', async ({ request }) => {
    test.setTimeout(120_000);
    const suffix = randomUUID().slice(0, 8);
    const agentId = await createAgent(request, `AE grader ${suffix}`);
    const workflowName = `e2e-eval-variant-${suffix}`;
    const registered = await request.post(`/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}`, {
      headers: JSON_HEADERS,
      data: agentStepWorkflow(workflowName, { autonomyLevel: 'L4', agentId, agent: { prompt: 'Grade each AE.' } }),
    });
    expect(registered.status(), await registered.text()).toBe(201);
    const step = { namespace: TEST_ORG_HANDLE, workflowName, stepId: 'grade-aes' };
    await seedSuite(request, step);

    const baseline = EvalRunOutputSchema.parse(await post(request, '/api/evaluation/runs', { ...step, trialsPerCase: 1, budgetUsd: 1 }, 201));
    expect(baseline.evalRun.variant).toBeNull();

    // A moving alias or a model the registry does not list is refused, as for the step itself.
    for (const model of ['~anthropic/claude-sonnet-latest', 'acme/not-a-model']) {
      const refused = await request.post('/api/evaluation/runs', { headers: JSON_HEADERS, data: { ...step, trialsPerCase: 1, budgetUsd: 1, variant: { model } } });
      expect(refused.status(), await refused.text()).toBe(400);
    }

    const variant = { model: VARIANT_MODEL, prompt: 'Grade each AE by CTCAE v5, citing the criterion.' };
    const prepared = EvalRunOutputSchema.parse(await post(request, '/api/evaluation/runs', { ...step, trialsPerCase: 2, budgetUsd: 1, variant }, 201));
    expect(prepared.evalRun.variant).toEqual(variant);
    // The Fingerprint is the patched step's: its model and step config differ from the baseline's, nothing else.
    expect(prepared.evalRun.definitionVersion).toBe(baseline.evalRun.definitionVersion);
    expect(prepared.evalRun.fingerprint!.hash).not.toBe(baseline.evalRun.fingerprint!.hash);
    const changed = Object.keys(prepared.evalRun.fingerprint!.components)
      .filter((component) => prepared.evalRun.fingerprint!.components[component as 'step'] !== baseline.evalRun.fingerprint!.components[component as 'step']);
    expect(changed.sort()).toEqual(['model', 'step']);

    const finished = await runToCompletion(request, prepared.evalRun.id, 1);
    expect(finished.trials).toHaveLength(2);
    for (const trial of finished.trials) {
      expect(trial.status, trial.error ?? '').toBe('scored');
      const text = await firstTrajectoryText(request, trial.agentRunId!);
      expect(text).toContain(`Model: ${VARIANT_MODEL}.`);
      expect(text).toContain(`| ${variant.prompt}`);
    }
    expect(finished.report.evaluators[0]).toMatchObject({ name: 'summary-present', passes: 2, failures: 0 });

    // The runs list shows only the step as it is, and validation ignores the Variant.
    const listed = ListEvalRunsOutputSchema.parse(await getJson(request, `/api/evaluation/runs?namespace=${TEST_ORG_HANDLE}&workflowName=${workflowName}&stepId=grade-aes`));
    expect(listed.evalRuns.map((run) => run.id)).toEqual([baseline.evalRun.id]);
    const qualification = GetStepQualificationOutputSchema.parse(
      await getJson(request, `/api/evaluation/qualification?namespace=${TEST_ORG_HANDLE}&workflowName=${workflowName}&stepId=grade-aes`),
    );
    expect(qualification.validation.evalRunId).not.toBe(prepared.evalRun.id);
  });

  test('an Agent\'s Variant replaces its model and system prompt in the trial only', async ({ request }) => {
    test.setTimeout(120_000);
    const agentId = await createAgent(request, `AE grader ${randomUUID().slice(0, 8)}`);
    const subject = { namespace: TEST_ORG_HANDLE, agentId };
    await seedSuite(request, subject);

    const variant = { model: VARIANT_MODEL, prompt: 'You grade adverse events by CTCAE v6.' };
    const prepared = EvalRunOutputSchema.parse(await post(request, '/api/evaluation/runs', { ...subject, trialsPerCase: 1, budgetUsd: 1, variant }, 201));
    expect(prepared.evalRun).toMatchObject({ variant, agentVersion: 1 });
    // The run assessed version 1 with the patch over it; the patch is not a version.
    expect(prepared.assessedAgentVersion?.config).toMatchObject({ foundationModel: BASE_MODEL, systemPrompt: 'You grade adverse events by CTCAE v5.' });

    const finished = await runToCompletion(request, prepared.evalRun.id, 1);
    const [trial] = finished.trials;
    expect(trial!.status, trial!.error ?? '').toBe('scored');
    const text = await firstTrajectoryText(request, trial!.agentRunId!);
    expect(text).toContain(`Model: ${VARIANT_MODEL}.`);
    expect(text).toContain(variant.prompt);
    expect(text).not.toContain('CTCAE v5');

    const versions = ListAgentVersionsOutputSchema.parse(await getJson(request, `/api/agents/${agentId}/versions`));
    expect(versions.versions.map((version) => version.version)).toEqual([1]);
    const listed = ListEvalRunsOutputSchema.parse(await getJson(request, `/api/evaluation/runs?namespace=${TEST_ORG_HANDLE}&agentId=${agentId}`));
    expect(listed.evalRuns).toEqual([]);
  });
});
