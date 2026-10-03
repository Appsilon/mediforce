import { randomUUID } from 'node:crypto';
import { EvalRunOutputSchema, ListEvalRunsOutputSchema } from '@mediforce/platform-api/contract';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_USER_PASSWORD } from '../helpers/constants';
import { pollUntil } from '../helpers/poll-until';
import { trackPageErrors } from '../helpers/page-errors';
import { AUTH_HEADERS, JSON_HEADERS, agentStepAfterExtractWorkflow, agentStepWorkflow, awaitFinishedAgentRun, startRun } from '../helpers/agent-step-runs';
import { EVALUATION_WORKSPACE, seedEvaluationWorkspace } from '../helpers/evaluation-workspace';
import { scriptOpenRouter } from '../helpers/mock-openrouter-server';

/**
 * L4 journeys for the workflow's Evaluation tab (ADR-0023 D14): pick the agent
 * step, ask the Evaluation Assistant, and decide its proposals — accepting the
 * Evaluator adds it to the step's list as one that counts, rejecting the Brief
 * draft leaves the Brief, opened from the assistant's header, unwritten; a plan's risk asks the assistant to draft
 * its check; a person reads a judge's rationale in a run's report and accepts
 * the verdict it was unsure of, so it counts. The steps the assistant took stay listed under its reply, and the
 * panel widens from its left edge. Acceptance Criteria the assistant proposes
 * are set on accepting them, and a person signs a Step Qualification from a
 * finished run's report. The model is the scripted mock OpenRouter.
 */
test.describe('Step Evaluation tab', () => {
  // Each worker seeding the workspace's model key at once races on its insert, so the tab's journeys share one worker.
  test.describe.configure({ mode: 'serial' });
  test.beforeAll(async () => {
    await seedEvaluationWorkspace();
  });

  test('the assistant proposes; accepting a proposal creates it, rejecting one does not', async ({ page, request }) => {
    test.setTimeout(90_000);
    trackPageErrors(page);
    const workflowName = `e2e-eval-tab-${randomUUID().slice(0, 8)}`;
    const runId = await startRun(request, agentStepWorkflow(workflowName, { autonomyLevel: 'L4', agent: { prompt: 'Grade each AE.' } }), {}, EVALUATION_WORKSPACE);
    await awaitFinishedAgentRun(request, runId);

    const question = `What should I check first? ${randomUUID()}`;
    const check = { kind: 'schema', schema: { required: ['summary'] } };
    await scriptOpenRouter(question, [
      { toolCalls: [{ name: 'preview_evaluator', arguments: { check } }] },
      {
        toolCalls: [
          { name: 'propose_brief', arguments: { text: 'Grades **adverse events** for the DSMB; a missed grade 5 is critical.' } },
          { name: 'propose_evaluator', arguments: { name: 'summary-present', rule: 'The result carries a summary.', severity: 'critical', check } },
        ],
      },
      { content: 'The summary check passed on the recent run. I drafted a Brief and proposed the check.' },
    ]);

    await page.goto(`/${EVALUATION_WORKSPACE}/workflows/${encodeURIComponent(workflowName)}?tab=evaluation`);
    await expect(page.getByTestId('evaluation-step-select')).toHaveValue('grade-aes', { timeout: 15_000 });
    await expect(page.getByText('No Evaluators yet.')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Show the step brief' }).click();
    const briefField = page.getByTestId('evaluation-brief');
    await expect(briefField.getByText(/No Brief yet/)).toBeVisible();
    await briefField.getByRole('button', { name: 'Write' }).click();
    await briefField.getByLabel('Step brief').fill('An unsaved draft');
    await page.getByRole('button', { name: 'Hide the step brief' }).click();
    await expect(briefField).toBeHidden();
    await page.getByRole('button', { name: 'Show the step brief' }).click();
    await expect(briefField.getByLabel('Step brief')).toHaveValue('An unsaved draft');
    await briefField.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'Assistant settings' }).click();
    await expect(page.getByLabel('Evaluation Assistant Model')).toBeVisible();

    await page.getByTestId('evaluation-assistant-input').fill(question);
    await page.getByTestId('evaluation-assistant-send').click();
    await expect(page.getByText('The summary check passed on the recent run.')).toBeVisible({ timeout: 20_000 });

    await page.getByText('3 steps').click();
    const steps = page.getByTestId('assistant-activity-step');
    await expect(steps).toHaveText(['Previewing a check on real runs', 'Drafting the brief', 'Drafting an evaluator']);

    const cards = page.getByTestId('proposal-card');
    await expect(cards).toHaveCount(2);
    const briefCard = cards.filter({ hasText: 'Proposed Evaluation Brief' });
    const evaluatorCard = cards.filter({ hasText: 'Proposed Evaluator' });
    await expect(briefCard.getByText('adverse events')).toBeVisible();

    await briefCard.getByRole('button', { name: 'Reject' }).click();
    await expect(briefCard.getByText('Rejected')).toBeVisible();

    await evaluatorCard.getByTestId('proposal-accept').click();
    await expect(evaluatorCard.getByText('Accepted')).toBeVisible({ timeout: 10_000 });

    const row = page.getByTestId('evaluator-row').filter({ hasText: 'summary-present' });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText('Counts')).toBeVisible();
    await expect(row.getByText(/from the assistant/)).toBeVisible();
    await expect(page.getByTestId('evaluation-brief').getByText(/No Brief yet/)).toBeVisible();
    await expect(page.getByTestId('brief-indicator')).toHaveCount(0);

    const panel = page.getByTestId('evaluation-assistant');
    const narrow = (await panel.boundingBox())!.width;
    const handle = (await page.getByTestId('evaluation-assistant-resize').boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x - 150, handle.y + handle.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await panel.boundingBox())!.width).toBeGreaterThan(narrow + 100);
  });

  test('a plan drafts its checks one risk at a time', async ({ page, request }) => {
    test.setTimeout(90_000);
    trackPageErrors(page);
    const workflowName = `e2e-eval-plan-${randomUUID().slice(0, 8)}`;
    const runId = await startRun(request, agentStepWorkflow(workflowName, { autonomyLevel: 'L4', agent: { prompt: 'Grade each AE.' } }), {}, EVALUATION_WORKSPACE);
    await awaitFinishedAgentRun(request, runId);

    const question = `Plan the evaluation. ${randomUUID()}`;
    await scriptOpenRouter(question, [
      {
        toolCalls: [
          {
            name: 'propose_evaluation_plan',
            arguments: {
              summary: 'Wrong grades on fatal events matter most.',
              risks: [{ failure: 'A fatal AE is graded below 5', severity: 'critical', why: 'A missed grade 5 hides a death.', check: { kind: 'code', rule: 'An AE with a fatal outcome is graded 5.' } }],
              acceptanceCriteria: { critical: 0.95, major: 0.8, minor: 0.6 },
            },
          },
        ],
      },
      { content: 'Here is the plan.' },
      { content: 'Drafting the fatal-outcome check now.' },
    ]);

    await page.goto(`/${EVALUATION_WORKSPACE}/workflows/${encodeURIComponent(workflowName)}?tab=evaluation`);
    await expect(page.getByTestId('evaluation-step-select')).toHaveValue('grade-aes', { timeout: 15_000 });
    await page.getByTestId('evaluation-assistant-input').fill(question);
    await page.getByTestId('evaluation-assistant-send').click();
    await expect(page.getByText('Here is the plan.')).toBeVisible({ timeout: 20_000 });

    // A risk of the plan asks the assistant to draft its check.
    const plan = page.getByTestId('plan-card');
    await expect(plan.getByTestId('plan-risk')).toHaveCount(1);
    await plan.getByRole('button', { name: 'Draft this check' }).click();
    await expect(page.getByText('Drafting the fatal-outcome check now.')).toBeVisible({ timeout: 20_000 });
  });

  test('a person reads a judge\'s rationale in the report and accepts a verdict it was unsure of, so it counts', async ({ page, request }) => {
    test.setTimeout(150_000);
    trackPageErrors(page);
    const suffix = randomUUID().slice(0, 8);
    const workflowName = `e2e-eval-judge-${suffix}`;
    const step = { namespace: EVALUATION_WORKSPACE, workflowName, stepId: 'grade-aes' };
    const post = async (path: string, data: Record<string, unknown>) => {
      const res = await request.post(path, { headers: JSON_HEADERS, data });
      expect(res.status(), await res.text()).toBeLessThan(300);
      return res.json();
    };
    await post(`/api/workflow-definitions?namespace=${EVALUATION_WORKSPACE}`, agentStepAfterExtractWorkflow(workflowName, {
      autonomyLevel: 'L4', agent: { prompt: 'Grade each AE.' },
    }));
    await post('/api/evaluation/evaluators', {
      ...step, name: 'summary-grounded', rule: 'The summary is grounded in the input.', severity: 'critical',
      check: { kind: 'llm_judge', model: 'anthropic/claude-haiku-4.5', rubric: 'Is the summary grounded in the input?', minConfidence: 0.8 },
    });
    // The judge reads the step's input — the case's `extract-aes` output — so a marker there keys its scripted answer.
    const judgeKey = `judge-key-${suffix}`;
    const rationale = 'The log does not show where the summary came from, so the evidence is thin.';
    await scriptOpenRouter(judgeKey, [{ content: JSON.stringify({ rationale, passed: true, confidence: 0.5 }) }]);
    await post('/api/evaluation/cases', {
      ...step, name: 'Unsure', input: { triggerPayload: {}, previousStepOutputs: { 'extract-aes': { events: [{ term: 'Sepsis' }], judgeKey } } },
    });
    await post('/api/evaluation/datasets', step);
    await post('/api/evaluation/acceptance-criteria', { ...step, criteria: { critical: { minPassRate: 1 } } });
    const prepared = EvalRunOutputSchema.parse(await post('/api/evaluation/runs', { ...step, trialsPerCase: 1, budgetUsd: 1 }));
    await post(`/api/evaluation/runs/${prepared.evalRun.id}/start`, { confirmedBudgetUsd: 1 });
    await pollUntil(async () => {
      const res = await request.get(`/api/evaluation/runs/${prepared.evalRun.id}`, { headers: AUTH_HEADERS });
      return EvalRunOutputSchema.parse(await res.json()).evalRun.status === 'completed' ? true : null;
    }, { description: 'the Eval Run to complete', timeoutMs: 90_000 });

    await page.goto(`/${EVALUATION_WORKSPACE}/workflows/${encodeURIComponent(workflowName)}?tab=evaluation`);
    await expect(page.getByTestId('evaluation-step-select')).toHaveValue('grade-aes', { timeout: 15_000 });
    // Below its minimum confidence, the judge's only verdict is left out: the critical criterion cannot be judged.
    const row = page.getByTestId('eval-run-row').filter({ hasText: prepared.evalRun.id.slice(0, 8) });
    await expect(row.getByTestId('eval-run-acceptance')).toHaveText('Not judged');
    await row.getByRole('link', { name: 'Details' }).click();
    await expect(page.getByTestId('eval-run-detail')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('variant-report').getByTestId('criteria-verdicts')).toContainText('critical not judged');

    await page.getByTestId('eval-run-tab-verdicts').click();
    const verdict = page.getByTestId('judge-verdict');
    await expect(verdict).toContainText('confidence 0.5 (below 0.8)');
    await expect(verdict).toContainText('left out — below its minimum confidence');
    await expect(verdict.getByTestId('judge-rationale')).toHaveText(rationale);

    // Everything the judge read, on the trial's page: its question, the exact messages it was sent, and the input in them.
    await verdict.getByRole('link', { name: 'What the judge read' }).click();
    const judge = page.getByTestId('trial-evaluator').filter({ hasText: 'summary-grounded' });
    await expect(judge.getByTestId('evaluator-looks-for')).toContainText('Is the summary grounded in the input?');
    await judge.getByTestId('judge-prompt').locator('summary').click();
    await expect(judge.getByTestId('judge-prompt')).toContainText(judgeKey);
    await expect(page.getByTestId('trial-input')).toContainText(judgeKey);

    const review = judge.getByTestId('judge-verdict');
    await review.getByRole('button', { name: 'Accept' }).click();
    await review.getByLabel('Why (optional)').fill('The summary matches the input; the judge was right to pass it.');
    await review.getByRole('button', { name: 'Confirm accept' }).click();
    await expect(review).toContainText('counts — accepted by', { timeout: 10_000 });
    await expect(review).toContainText('The summary matches the input; the judge was right to pass it.');

    await page.getByRole('link', { name: `Eval Run ${prepared.evalRun.id.slice(0, 8)}` }).click();
    await page.getByTestId('eval-run-tab-summary').click();
    await expect(page.getByTestId('variant-report').getByTestId('criteria-verdicts')).toContainText('critical met');
  });

  test('accepted criteria judge a run, and the person signs a Step Qualification from its report — no Brief needed', async ({ page, request }) => {
    test.setTimeout(150_000);
    trackPageErrors(page);
    const workflowName = `e2e-eval-qualify-${randomUUID().slice(0, 8)}`;
    const runId = await startRun(request, agentStepWorkflow(workflowName, { autonomyLevel: 'L4', agent: { prompt: 'Grade each AE.' } }), {}, EVALUATION_WORKSPACE);
    const agentRunId = (await awaitFinishedAgentRun(request, runId)).id;
    const step = { namespace: EVALUATION_WORKSPACE, workflowName, stepId: 'grade-aes' };
    const post = async (path: string, data: Record<string, unknown>) => {
      const res = await request.post(path, { headers: JSON_HEADERS, data });
      expect(res.status(), await res.text()).toBeLessThan(300);
      return res.json();
    };
    await post('/api/evaluation/evaluators', { ...step, name: 'summary-present', rule: 'The result carries a summary.', severity: 'critical', check: { kind: 'schema', schema: { required: ['summary'] } } });
    await post('/api/evaluation/evaluators', { ...step, name: 'findings-present', rule: 'The result lists findings.', severity: 'major', check: { kind: 'schema', schema: { required: ['findings'] } } });
    await post('/api/evaluation/cases/from-agent-run', { agentRunId });
    await post('/api/evaluation/datasets', step);

    const question = `What should the floors be? ${randomUUID()}`;
    await scriptOpenRouter(question, [
      {
        toolCalls: [{
          name: 'propose_acceptance_criteria',
          arguments: { criteria: { critical: { minPassRate: 0.1 }, major: { minPassRate: 0.5 } }, rationale: 'A missed summary loses the whole grading.' },
        }],
      },
      { content: 'Here are floors for the critical and major checks.' },
    ]);
    await page.goto(`/${EVALUATION_WORKSPACE}/workflows/${encodeURIComponent(workflowName)}?tab=evaluation`);
    await expect(page.getByTestId('evaluation-step-select')).toHaveValue('grade-aes', { timeout: 15_000 });
    await expect(page.getByTestId('validation-status')).toHaveAttribute('data-status', 'not_verified', { timeout: 10_000 });
    await expect(page.getByTestId('validation-status')).toHaveText('Not verified');
    await page.getByTestId('evaluation-assistant-input').fill(question);
    await page.getByTestId('evaluation-assistant-send').click();
    const criteriaCard = page.getByTestId('proposal-card').filter({ hasText: 'Proposed Acceptance Criteria' });
    await criteriaCard.getByTestId('proposal-accept').click();
    await expect(criteriaCard.getByText('Accepted')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('set-threshold').click();
    const thresholds = page.getByTestId('threshold-dialog');
    await expect(thresholds.getByLabel('critical minimum pass rate')).toHaveValue('10');
    await expect(thresholds.getByLabel('major minimum pass rate')).toHaveValue('50');
    await expect(thresholds.getByLabel('judge minor')).not.toBeChecked();
    await thresholds.getByRole('button', { name: 'Cancel' }).click();

    // The run is prepared and confirmed over the API; the report is read and signed in the tab.
    const prepared = EvalRunOutputSchema.parse(await post('/api/evaluation/runs', { ...step, trialsPerCase: 1, budgetUsd: 1 }));
    await post(`/api/evaluation/runs/${prepared.evalRun.id}/start`, { confirmedBudgetUsd: 1 });
    await pollUntil(async () => {
      const res = await request.get(`/api/evaluation/runs/${prepared.evalRun.id}`, { headers: AUTH_HEADERS });
      return EvalRunOutputSchema.parse(await res.json()).evalRun.status === 'completed' ? true : null;
    }, { description: 'the Eval Run to complete', timeoutMs: 90_000 });

    await page.reload();
    // The newest finished run of the version missed its major criterion: validation fails, signed or not.
    await expect(page.getByTestId('validation-status')).toHaveAttribute('data-status', 'failed', { timeout: 10_000 });
    await page.getByTestId('eval-run-row').filter({ hasText: prepared.evalRun.id.slice(0, 8) }).getByRole('link', { name: 'Details' }).click();
    const report = page.getByTestId('variant-report');
    await expect(report.getByTestId('criteria-verdicts')).toContainText('critical met', { timeout: 15_000 });
    await expect(report.getByTestId('criteria-verdicts')).toContainText('major missed');
    await report.getByTestId('sign-qualification').click();
    const form = page.getByTestId('sign-qualification-form');
    await expect(form).toContainText('qualify this Step configuration as it ran in it');
    await expect(form).not.toContainText('Brief');
    await form.getByLabel('Justification for the major criterion').fill('Findings are listed downstream; a reviewer reads every grade.');
    await form.getByLabel('Your password').fill(TEST_USER_PASSWORD);
    await form.getByRole('button', { name: 'Sign' }).click();
    await expect(form).toBeHidden({ timeout: 10_000 });

    await page.getByRole('link', { name: 'Evaluation · grade-aes' }).click();
    await expect(page.getByTestId('validation-status')).toHaveText('Validation failed', { timeout: 15_000 });
    await page.getByTestId('validation-status').click();
    await expect(page.getByTestId('validation-reason')).toContainText('major missed');
    await expect(page.getByTestId('step-qualification')).toContainText(`Eval Run ${prepared.evalRun.id.slice(0, 8)}`);
    await expect(page.getByTestId('step-qualification')).toContainText('Deviation (major): Findings are listed downstream');

    // The version reads Failed in the selector and on the Definitions tab; its agent step's box in the editor links back here.
    await expect(page.getByTestId('evaluation-version-select').locator('option:checked')).toHaveText(/v1.*Failed/);
    await page.getByRole('tab', { name: 'Definitions' }).click();
    await expect(page.getByTestId('version-validation-badge')).toHaveAttribute('data-status', 'failed', { timeout: 10_000 });
    await page.goto(`/${EVALUATION_WORKSPACE}/workflows/${encodeURIComponent(workflowName)}/definitions/1`);
    const mark = page.getByTestId('step-evaluation-mark');
    await expect(mark).toHaveAttribute('data-status', 'failed', { timeout: 15_000 });
    await mark.click();
    await expect(page).toHaveURL(/tab=evaluation&version=1&step=grade-aes/);
    await expect(page.getByTestId('evaluation-version-select')).toHaveValue('1', { timeout: 15_000 });
    await expect(page.getByTestId('evaluation-step-select')).toHaveValue('grade-aes');

    // With a newer runnable version, a run prepared on v1 runs v1 — and stays in view on v2 until it is started.
    const v2 = await request.post(`/api/workflow-definitions?namespace=${EVALUATION_WORKSPACE}`, {
      headers: JSON_HEADERS,
      data: agentStepWorkflow(workflowName, { autonomyLevel: 'L4', agent: { prompt: 'Grade every AE by CTCAE v5.' } }),
    });
    expect(v2.status(), await v2.text()).toBe(201);
    await page.reload();
    await expect(page.getByTestId('evaluation-version-select')).toHaveValue('1', { timeout: 15_000 });
    await page.getByLabel('Budget $').fill('1');
    await page.getByRole('button', { name: 'Prepare', exact: true }).click();
    const startCard = page.getByTestId('start-eval-run-card');
    await expect(startCard).toBeVisible({ timeout: 10_000 });
    await expect(startCard).not.toContainText('on v1');
    const runsRes = await request.get(`/api/evaluation/runs?${new URLSearchParams(step)}`, { headers: AUTH_HEADERS });
    expect(ListEvalRunsOutputSchema.parse(await runsRes.json()).evalRuns.find((run) => run.status === 'prepared')).toMatchObject({ definitionVersion: 1 });
    await page.getByTestId('evaluation-version-select').selectOption('2');
    await expect(page).toHaveURL(/version=2/);
    await expect(startCard).toContainText('on v1', { timeout: 15_000 });
  });

  test('an Evaluator is added through its type\'s fields, read in full, and edited into a new version', async ({ page, request }) => {
    test.setTimeout(60_000);
    trackPageErrors(page);
    const workflowName = `e2e-eval-form-${randomUUID().slice(0, 8)}`;
    await startRun(request, agentStepWorkflow(workflowName, { autonomyLevel: 'L4', agent: { prompt: 'Grade each AE.' } }), {}, EVALUATION_WORKSPACE);

    await page.goto(`/${EVALUATION_WORKSPACE}/workflows/${encodeURIComponent(workflowName)}?tab=evaluation`);
    await expect(page.getByTestId('evaluation-step-select')).toHaveValue('grade-aes', { timeout: 15_000 });
    await expect(page.getByText('No Evaluators yet.')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const form = page.getByTestId('evaluator-form');
    await form.getByLabel('Evaluator name').fill('Summary present');
    await expect(form.getByLabel('Evaluator name')).toHaveValue('summary-present');
    await expect(form.getByLabel('Type').locator('option')).toHaveText(['Output schema', 'Code', 'LLM judge', 'Expected output']);
    await form.getByLabel('Type').selectOption('schema');
    await form.getByLabel('JSON Schema').fill('{"required": ["summary"]}');
    await form.getByLabel('Rule').fill('The output carries a summary.');
    await form.getByRole('button', { name: 'Create' }).click();

    const row = page.getByTestId('evaluator-row').filter({ hasText: 'summary-present' });
    await expect(row).toContainText('v1 · Output schema · major', { timeout: 10_000 });
    await expect(row.getByText('Counts')).toBeVisible();
    await row.getByText('Details', { exact: true }).click();
    await expect(row.getByTestId('evaluator-details')).toContainText('"summary"');

    await row.getByRole('button', { name: 'Edit' }).click();
    const editForm = row.getByTestId('evaluator-form');
    await expect(editForm.getByLabel('Evaluator name')).toBeDisabled();
    await expect(editForm.getByLabel('Type')).toBeDisabled();
    await editForm.getByLabel('Severity').selectOption('critical');
    await editForm.getByRole('button', { name: 'Save as v2' }).click();

    await expect(row).toContainText('v2 · Output schema · critical', { timeout: 10_000 });
    await row.getByText('Details', { exact: true }).click();
    await expect(row.getByTestId('evaluator-details')).toContainText('v1 ·');
  });

  test('a case is added in a dialog with its input beside its expected output, marked negative, compared by agreement and graded only by the selected Evaluators', async ({ page, request }) => {
    test.setTimeout(60_000);
    trackPageErrors(page);
    const workflowName = `e2e-eval-case-form-${randomUUID().slice(0, 8)}`;
    const step = { namespace: EVALUATION_WORKSPACE, workflowName, stepId: 'grade-aes' };
    const post = async (path: string, data: Record<string, unknown>) => {
      const res = await request.post(path, { headers: JSON_HEADERS, data });
      expect(res.status(), await res.text()).toBeLessThan(300);
      return res.json();
    };
    await post(`/api/workflow-definitions?namespace=${EVALUATION_WORKSPACE}`, agentStepWorkflow(workflowName, { autonomyLevel: 'L4', agent: { prompt: 'Grade each AE.' } }));
    await post('/api/evaluation/evaluators', { ...step, name: 'findings-present', rule: 'The result lists findings.', severity: 'major', check: { kind: 'schema', schema: { required: ['findings'] } } });
    await post('/api/evaluation/evaluators', {
      ...step, name: 'matches-expected', rule: 'The output matches what the case expects.', severity: 'critical',
      check: { kind: 'expected_output', model: 'anthropic/claude-haiku-4.5', minAgreement: 0.8 },
    });

    await page.goto(`/${EVALUATION_WORKSPACE}/workflows/${encodeURIComponent(workflowName)}?tab=evaluation`);
    await expect(page.getByTestId('evaluation-step-select')).toHaveValue('grade-aes', { timeout: 15_000 });
    await expect(page.getByTestId('evaluator-row').filter({ hasText: 'matches-expected' })).toContainText('Grades Eval Cases with an expected output only', { timeout: 10_000 });

    await page.getByRole('button', { name: 'Add case' }).click();
    const form = page.getByTestId('case-dialog').getByTestId('case-form');
    await expect(form.getByLabel('Notes')).toHaveCount(0);
    await form.getByLabel('Case name').fill('Fatal sepsis graded 4');
    await form.getByLabel('Expected output').fill('{"findings": [{"term": "Sepsis", "grade": 4}]}');
    await form.getByLabel('Negative — the output must not match').check();
    await form.getByLabel('Comparison').selectOption('agreement');
    await form.getByLabel('Agreement instructions').fill('Narrative wording is trivial; the grade decides.');
    await form.getByLabel('Selected evaluators').check();
    await form.getByLabel('Graded by findings-present').uncheck();
    await form.getByRole('button', { name: 'Add case' }).click();
    await expect(page.getByTestId('case-dialog')).toHaveCount(0);

    const row = page.getByTestId('eval-case-row').filter({ hasText: 'Fatal sepsis graded 4' });
    await expect(row.getByTestId('eval-case-expectation')).toHaveText('negative', { timeout: 10_000 });
    await expect(row.getByTestId('eval-case-comparison')).toContainText('Agreement score');
    await expect(row.getByTestId('eval-case-evaluators')).toHaveText('1 selected evaluator');
    await row.getByText('Details', { exact: true }).click();
    await expect(row.getByTestId('eval-case-expected-output')).toContainText('An output that does not match this, by output agreement score');
    await expect(row.getByTestId('eval-case-expected-output')).toContainText('"grade": 4');
    await expect(row.getByTestId('eval-case-expected-output')).toContainText('Narrative wording is trivial; the grade decides.');
    await expect(row.getByTestId('eval-case-details')).toContainText('Graded by: matches-expected');
  });
});
