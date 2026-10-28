import { randomUUID } from 'node:crypto';
import { EvalRunOutputSchema, ListEvalRunsOutputSchema } from '@mediforce/platform-api/contract';
import { test, expect } from '../helpers/test-fixtures';
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
 * are set on accepting them, and a person confirms or overwrites a run's verdict from a
 * finished run's report. The task-completion Evaluators are added one by one,
 * and offered again once every one is archived. The model is the scripted mock OpenRouter.
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
          { name: 'propose_evaluator', arguments: { name: 'summary-present', rule: 'The result carries a summary.', check } },
        ],
      },
      { content: 'The summary check passed on the recent run. I drafted a Brief and proposed the check.' },
    ]);

    await page.goto(`/${EVALUATION_WORKSPACE}/workflows/${encodeURIComponent(workflowName)}`);
    await page.getByRole('tab', { name: /evaluation/i }).click();
    await expect(page).toHaveURL(/tab=evaluation/);
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
              risks: [{ failure: 'A fatal AE is graded below 5', why: 'A missed grade 5 hides a death.', check: { kind: 'code', rule: 'An AE with a fatal outcome is graded 5.' } }],
              minPassRate: 0.95,
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

  test('a person adds the task-completion Evaluators one by one, and is offered them again once every one is archived', async ({ page, request }) => {
    test.setTimeout(90_000);
    trackPageErrors(page);
    // No production runs: each drafted check's self-test finds nothing to try, so no judge is called on one.
    const workflowName = `e2e-eval-task-completion-${randomUUID().slice(0, 8)}`;
    const created = await request.post(`/api/workflow-definitions?namespace=${EVALUATION_WORKSPACE}`, {
      headers: JSON_HEADERS,
      data: agentStepWorkflow(workflowName, { autonomyLevel: 'L4', agent: { prompt: 'Grade each AE.' } }),
    });
    expect(created.status(), await created.text()).toBe(201);

    // The button sends a fixed message, so the turn is scripted under the workflow's name, which its context names.
    await scriptOpenRouter(workflowName, [
      { toolCalls: [{ name: 'get_step_instructions', arguments: {} }] },
      {
        toolCalls: [{
          name: 'propose_task_completion_evaluators',
          arguments: {
            evaluators: [
              { name: 'summary-present', requirement: 'The result carries a summary.', source: 'output_schema', check: { kind: 'schema', schema: { required: ['summary'] } } },
              { name: 'every-ae-kept', requirement: 'Every adverse event in the input appears in the output.', source: 'prompt', check: { kind: 'code', runtime: 'python', source: 'print(1)' } },
              { name: 'grades-justified', requirement: 'Each grade is justified by the event\'s description.', source: 'prompt', priority: 'high', check: { kind: 'llm_judge' } },
            ],
            vagueInstructions: [{ quote: 'Be thorough.', why: 'Nothing says what thorough covers.' }],
          },
        }],
      },
      { content: 'Drafted three task-completion Evaluators.' },
    ]);

    await page.goto(`/${EVALUATION_WORKSPACE}/workflows/${encodeURIComponent(workflowName)}?tab=evaluation`);
    await expect(page.getByTestId('evaluation-step-select')).toHaveValue('grade-aes', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Add task-completion evaluators' }).click();
    await expect(page.getByText('Drafted three task-completion Evaluators.')).toBeVisible({ timeout: 20_000 });

    const card = page.getByTestId('task-completion-evaluators-card');
    await expect(card.getByText('Proposed task-completion Evaluators (3)')).toBeVisible();
    await expect(card.getByTestId('task-completion-vague-instructions')).toContainText('Be thorough.');
    const rows = card.getByTestId('task-completion-evaluator');
    const summary = rows.filter({ hasText: 'task-completion-summary-present' });
    const kept = rows.filter({ hasText: 'task-completion-every-ae-kept' });
    const judge = rows.filter({ hasText: 'task-completion-grades-justified' });
    await expect(summary.getByText('schema', { exact: true })).toBeVisible();
    await expect(kept.getByText('Counts only once a person approves its source.')).toBeVisible();
    await expect(judge.getByText('— matters most')).toBeVisible();
    await judge.getByText('Rubric').click();
    await expect(judge.getByText(/Judge this one requirement only/)).toBeVisible();

    // Each row is decided on its own; the rest stay open.
    await summary.getByTestId('proposal-accept').click();
    await expect(summary.getByText('Accepted')).toBeVisible({ timeout: 10_000 });
    await kept.getByRole('button', { name: 'Reject' }).click();
    await expect(kept.getByText('Rejected')).toBeVisible();
    await expect(judge.getByTestId('proposal-accept')).toBeEnabled();
    await judge.getByTestId('proposal-accept').click();
    await expect(judge.getByText('Accepted')).toBeVisible({ timeout: 10_000 });

    const evaluatorRows = page.getByTestId('evaluator-row');
    await expect(evaluatorRows.filter({ hasText: 'task-completion-summary-present' })).toBeVisible({ timeout: 10_000 });
    await expect(evaluatorRows.filter({ hasText: 'task-completion-grades-justified' })).toBeVisible();
    await expect(evaluatorRows.filter({ hasText: 'task-completion-every-ae-kept' })).toHaveCount(0);
    // A live task-completion Evaluator: nothing to add any more.
    const addButton = page.getByRole('button', { name: 'Add task-completion evaluators' });
    await expect(addButton).toHaveCount(0);

    // Archiving one still leaves a live one; archiving the last offers them again.
    await evaluatorRows.filter({ hasText: 'task-completion-summary-present' }).getByRole('button', { name: 'Archive' }).click();
    await expect(evaluatorRows.filter({ hasText: 'task-completion-summary-present' })).toHaveCount(0, { timeout: 10_000 });
    await expect(addButton).toHaveCount(0);
    await evaluatorRows.filter({ hasText: 'task-completion-grades-justified' }).getByRole('button', { name: 'Archive' }).click();
    await expect(addButton).toBeVisible({ timeout: 10_000 });
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
      ...step, name: 'summary-grounded', rule: 'The summary is grounded in the input.',
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
    await post('/api/evaluation/acceptance-criteria', { ...step, criteria: { minPassRate: 1 } });
    const prepared = EvalRunOutputSchema.parse(await post('/api/evaluation/runs', { ...step, trialsPerCase: 1, budgetUsd: 1 }));
    await post(`/api/evaluation/runs/${prepared.evalRun.id}/start`, { confirmedBudgetUsd: 1 });
    await pollUntil(async () => {
      const res = await request.get(`/api/evaluation/runs/${prepared.evalRun.id}`, { headers: AUTH_HEADERS });
      return EvalRunOutputSchema.parse(await res.json()).evalRun.status === 'completed' ? true : null;
    }, { description: 'the Eval Run to complete', timeoutMs: 90_000 });

    await page.goto(`/${EVALUATION_WORKSPACE}/workflows/${encodeURIComponent(workflowName)}?tab=evaluation`);
    await expect(page.getByTestId('evaluation-step-select')).toHaveValue('grade-aes', { timeout: 15_000 });
    // Below its minimum confidence, the judge's only verdict is left out: the criteria cannot be judged.
    const row = page.getByTestId('eval-run-row').filter({ hasText: prepared.evalRun.id.slice(0, 8) });
    await expect(row.getByTestId('eval-run-acceptance')).toHaveText('Not judged');
    await row.getByRole('link', { name: 'Details' }).click();
    await expect(page.getByTestId('eval-run-detail')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('eval-run-report').getByTestId('criteria-verdict')).toContainText('not judged');

    await page.getByTestId('eval-run-tab-verdicts').click();
    const verdict = page.getByTestId('judge-verdict');
    await expect(verdict).toContainText('confidence 0.5 (below 0.8)');
    await expect(verdict).toContainText('left out — below its minimum confidence');
    await expect(verdict.getByTestId('judge-rationale')).toHaveText(rationale);

    // Everything the judge read, on the trial's page: its question, its Evaluator logs — the exact messages it was sent, and the input in them — and the input.
    await verdict.getByRole('link', { name: 'What the judge read' }).click();
    const judge = page.getByTestId('trial-evaluator').filter({ hasText: 'summary-grounded' });
    await expect(judge.getByTestId('evaluator-looks-for')).toContainText('Is the summary grounded in the input?');
    await judge.getByRole('button', { name: /Evaluator logs/ }).click();
    await expect(judge.getByTestId('evaluator-log')).toContainText(judgeKey);
    await expect(judge.getByTestId('evaluator-log')).toContainText(rationale);
    await expect(page.getByTestId('trial-input')).toContainText(judgeKey);

    const review = judge.getByTestId('judge-verdict');
    await review.getByRole('button', { name: 'Accept' }).click();
    await review.getByLabel('Why (optional)').fill('The summary matches the input; the judge was right to pass it.');
    await review.getByRole('button', { name: 'Confirm accept' }).click();
    await expect(review).toContainText('counts — accepted by', { timeout: 10_000 });
    await expect(review).toContainText('The summary matches the input; the judge was right to pass it.');

    await page.getByRole('link', { name: `Eval Run ${prepared.evalRun.id.slice(0, 8)}` }).click();
    await page.getByTestId('eval-run-tab-summary').click();
    await expect(page.getByTestId('eval-run-report').getByTestId('criteria-verdict')).toHaveAttribute('data-status', 'met');
  });

  test('accepted criteria judge a run, and the person confirms its verdict from the report — no Brief needed', async ({ page, request }) => {
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
    await post('/api/evaluation/evaluators', { ...step, name: 'findings-present', rule: 'The result lists findings.', check: { kind: 'schema', schema: { required: ['findings'] } } });
    await post('/api/evaluation/cases/from-agent-run', { agentRunId });
    await post('/api/evaluation/datasets', step);

    const question = `What should the floors be? ${randomUUID()}`;
    await scriptOpenRouter(question, [
      {
        toolCalls: [{
          name: 'propose_acceptance_criteria',
          arguments: { criteria: { minPassRate: 0.5 }, rationale: 'A missed summary loses the whole grading.' },
        }],
      },
      { content: 'Here is a floor for every check.' },
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
    await expect(thresholds.getByLabel('Minimum pass rate')).toHaveValue('50');
    await thresholds.getByRole('button', { name: 'Cancel' }).click();

    // The run is prepared and confirmed over the API; the report is read and its verdict confirmed in the tab.
    const prepared = EvalRunOutputSchema.parse(await post('/api/evaluation/runs', { ...step, trialsPerCase: 1, budgetUsd: 1 }));
    await post(`/api/evaluation/runs/${prepared.evalRun.id}/start`, { confirmedBudgetUsd: 1 });
    await pollUntil(async () => {
      const res = await request.get(`/api/evaluation/runs/${prepared.evalRun.id}`, { headers: AUTH_HEADERS });
      return EvalRunOutputSchema.parse(await res.json()).evalRun.status === 'completed' ? true : null;
    }, { description: 'the Eval Run to complete', timeoutMs: 90_000 });

    await page.reload();
    // The newest finished run of the version missed its criteria on findings-present, but waits for a person to sign it off.
    await expect(page.getByTestId('validation-status')).toHaveAttribute('data-status', 'awaiting_approval', { timeout: 10_000 });
    await expect(page.getByTestId('validation-status')).toHaveText('Waiting for human approval');
    await expect(page.getByTestId('validation-run-verdict')).toHaveText('missed');
    await expect(page.getByTestId('validation-reason')).toContainText(/Eval Run [0-9a-f]{8} missed: findings-present/);
    await expect(page.getByTestId('review-eval-run')).toBeVisible();
    await page.getByTestId('eval-run-row').filter({ hasText: prepared.evalRun.id.slice(0, 8) }).getByRole('link', { name: 'Details' }).click();
    const report = page.getByTestId('eval-run-report');
    await expect(report.getByTestId('criteria-verdict')).toHaveText('Acceptance criteria missed — 1 of 1 counted Evaluator below pass rate ≥ 50%', { timeout: 15_000 });
    await expect(report.getByRole('row').filter({ hasText: 'findings-present' }).getByTestId('evaluator-pass-rate')).toHaveAttribute('data-met', 'false');
    await expect(report.getByTestId('confirm-verdict')).toHaveText('Confirm that evaluation failed');
    await expect(report.getByTestId('overwrite-verdict')).toHaveText('Overwrite the evaluation verdict');
    await report.getByTestId('confirm-verdict').click();
    const form = page.getByTestId('sign-qualification-form');
    await expect(form).toContainText('agree with its verdict');
    await expect(form).not.toContainText('Brief');
    await expect(form.getByLabel('Justification for overwriting the verdict')).toHaveCount(0);
    await form.getByRole('button', { name: 'Sign' }).click();
    await expect(form).toBeHidden({ timeout: 10_000 });
    await expect(report.getByTestId('run-decision')).toHaveAttribute('data-outcome', 'failed');

    await page.getByRole('link', { name: 'Evaluation · grade-aes' }).click();
    await expect(page.getByTestId('validation-status')).toHaveText('Validation failed', { timeout: 15_000 });
    await expect(page.getByTestId('validation-reason')).toContainText(/findings-present passed 0 of \d+ trials? \(0%, needs 50%\)/);
    await page.getByTestId('validation-status').click();
    await expect(page.getByTestId('step-qualification')).toContainText(`Eval Run ${prepared.evalRun.id.slice(0, 8)}`);
    await expect(page.getByTestId('step-qualification')).toContainText('Verdict confirmed by');

    // The version reads Failed in the selector and on the Definitions tab; its agent step's box in the editor links back here.
    await expect(page.getByTestId('evaluation-version-select').locator('option:checked')).toHaveText(/v1.*Failed/);
    await page.getByRole('tab', { name: 'Definitions' }).click();
    const definitionsPanel = page.getByRole('tabpanel', { name: 'Definitions' });
    await expect(definitionsPanel.getByTestId('version-validation-badge')).toHaveAttribute('data-status', 'failed', { timeout: 10_000 });
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
    await post('/api/evaluation/runs', { ...step, definitionVersion: 1, trialsPerCase: 1, budgetUsd: 1 });
    await page.reload();
    await expect(page.getByTestId('evaluation-version-select')).toHaveValue('1', { timeout: 15_000 });
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
    await expect(form.getByLabel('Type').locator('option')).toHaveText(['Output schema', 'Code', 'LLM judge', 'Expected output']);
    await form.getByLabel('Type').selectOption('schema');
    await form.getByLabel('JSON Schema').fill('{"required": ["summary"]}');
    await expect(form.getByLabel('Evaluator name')).toHaveCount(0);
    await expect(form.getByLabel('Rule')).toHaveCount(0);
    await form.getByRole('button', { name: 'Create' }).click();

    const row = page.getByTestId('evaluator-row').filter({ hasText: 'output-schema' });
    await expect(row).toContainText('v1 · Output schema', { timeout: 10_000 });
    await expect(row.getByText('Counts')).toBeVisible();
    await row.getByText('Details', { exact: true }).click();
    await expect(row.getByTestId('evaluator-details')).toContainText('"summary"');

    await row.getByRole('button', { name: 'Edit' }).click();
    const editForm = row.getByTestId('evaluator-form');
    await expect(editForm.getByLabel('Type')).toBeDisabled();
    await editForm.getByLabel('JSON Schema').fill('{"required": ["summary", "findings"]}');
    await editForm.getByRole('button', { name: 'Save as v2' }).click();

    await expect(row).toContainText('v2 · Output schema', { timeout: 10_000 });
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
    await post('/api/evaluation/evaluators', { ...step, name: 'findings-present', rule: 'The result lists findings.', check: { kind: 'schema', schema: { required: ['findings'] } } });
    await post('/api/evaluation/evaluators', {
      ...step, name: 'matches-expected', rule: 'The output matches what the case expects.',
      check: { kind: 'expected_output', model: 'anthropic/claude-haiku-4.5', minAgreement: 0.8 },
    });

    await page.goto(`/${EVALUATION_WORKSPACE}/workflows/${encodeURIComponent(workflowName)}?tab=evaluation`);
    await expect(page.getByTestId('evaluation-step-select')).toHaveValue('grade-aes', { timeout: 15_000 });
    await expect(page.getByTestId('evaluator-row').filter({ hasText: 'matches-expected' })).toContainText('Only checks cases that have an expected output', { timeout: 10_000 });

    await page.getByRole('button', { name: 'Add case' }).click();
    const form = page.getByTestId('case-dialog').getByTestId('case-form');
    await expect(form.getByLabel('Notes')).toHaveCount(0);
    await form.getByLabel('Case name').fill('Fatal sepsis graded 4');
    await form.getByLabel('Expected output').fill('{"findings": [{"term": "Sepsis", "grade": 4}]}');
    await form.getByLabel('Expectation').selectOption('negative');
    await form.getByLabel('Comparison').selectOption('agreement');
    await form.getByLabel('Agreement instructions').fill('Narrative wording is trivial; the grade decides.');
    await form.getByLabel('Only these').check();
    await form.getByLabel('Checked by findings-present').uncheck();
    await form.getByRole('button', { name: 'Add case' }).click();
    await expect(page.getByTestId('case-dialog')).toHaveCount(0);

    const row = page.getByTestId('eval-case-row').filter({ hasText: 'Fatal sepsis graded 4' });
    await expect(row.getByTestId('eval-case-expectation')).toHaveText('negative', { timeout: 10_000 });
    await expect(row.getByTestId('eval-case-comparison')).toContainText('By meaning');
    await expect(row.getByTestId('eval-case-evaluators')).toHaveText('1 selected evaluator');
    await row.getByText('Details', { exact: true }).click();
    await expect(row.getByTestId('eval-case-expected-output')).toContainText('The output must not match this, by meaning');
    await expect(row.getByTestId('eval-case-expected-output')).toContainText('"grade": 4');
    await expect(row.getByTestId('eval-case-expected-output')).toContainText('Narrative wording is trivial; the grade decides.');
    await expect(row.getByTestId('eval-case-details')).toContainText('Checked by: matches-expected');
  });
});
