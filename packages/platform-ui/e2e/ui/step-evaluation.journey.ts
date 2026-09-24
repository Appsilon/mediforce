import { randomUUID } from 'node:crypto';
import { EvalRunOutputSchema } from '@mediforce/platform-api/contract';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_USER_PASSWORD } from '../helpers/constants';
import { pollUntil } from '../helpers/poll-until';
import { trackPageErrors } from '../helpers/page-errors';
import { AUTH_HEADERS, JSON_HEADERS, agentStepWorkflow, awaitFinishedAgentRun, startRun } from '../helpers/agent-step-runs';
import { EVALUATION_WORKSPACE, seedEvaluationWorkspace } from '../helpers/evaluation-workspace';
import { scriptOpenRouter } from '../helpers/mock-openrouter-server';

/**
 * L4 journeys for the workflow's Evaluation tab (ADR-0023 D14): pick the agent
 * step, ask the Evaluation Assistant, and decide its proposals — accepting the
 * Evaluator adds it to the step's list as one that counts, rejecting the Brief
 * draft leaves the Brief unwritten; a plan's risk asks the assistant to draft
 * its check; outputs it picks are labelled by the person and become Eval
 * Cases. The steps the assistant took stay listed under its reply, and the
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
    await expect(page.getByText(/No Brief yet/)).toBeVisible();

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
    await expect(page.getByText(/No Brief yet/)).toBeVisible();

    const panel = page.getByTestId('evaluation-assistant');
    const narrow = (await panel.boundingBox())!.width;
    const handle = (await page.getByTestId('evaluation-assistant-resize').boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x - 150, handle.y + handle.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await panel.boundingBox())!.width).toBeGreaterThan(narrow + 100);
  });

  test('a plan drafts its checks one risk at a time; the person labels the outputs the assistant picks', async ({ page, request }) => {
    test.setTimeout(90_000);
    trackPageErrors(page);
    const workflowName = `e2e-eval-label-${randomUUID().slice(0, 8)}`;
    const runId = await startRun(request, agentStepWorkflow(workflowName, { autonomyLevel: 'L4', agent: { prompt: 'Grade each AE.' } }), {}, EVALUATION_WORKSPACE);
    const agentRunId = (await awaitFinishedAgentRun(request, runId)).id;
    const judgeRes = await request.post('/api/evaluation/evaluators', {
      headers: JSON_HEADERS,
      data: {
        namespace: EVALUATION_WORKSPACE, workflowName, stepId: 'grade-aes',
        name: 'grades-justified', rule: 'Every grade is justified by the source record.', severity: 'major',
        check: { kind: 'llm_judge', model: 'anthropic/claude-haiku-4.5', rubric: 'Is every AE graded?', choices: [{ label: 'yes', value: 1 }, { label: 'no', value: 0 }] },
      },
    });
    expect(judgeRes.status(), await judgeRes.text()).toBe(201);
    const { evaluator } = (await judgeRes.json()) as { evaluator: { id: string } };

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
          { name: 'propose_outputs_to_label', arguments: { evaluatorId: evaluator.id, outputs: [{ agentRunId, why: 'It carries no grades at all.' }] } },
        ],
      },
      { content: 'Here is the plan. Label the output I picked so the judge can be calibrated.' },
      { content: 'Drafting the fatal-outcome check now.' },
    ]);

    await page.goto(`/${EVALUATION_WORKSPACE}/workflows/${encodeURIComponent(workflowName)}?tab=evaluation`);
    await expect(page.getByTestId('evaluation-step-select')).toHaveValue('grade-aes', { timeout: 15_000 });
    await page.getByTestId('evaluation-assistant-input').fill(question);
    await page.getByTestId('evaluation-assistant-send').click();
    await expect(page.getByText('Here is the plan.')).toBeVisible({ timeout: 20_000 });

    // The person labels the picked output; the labels become an Eval Case.
    const labelling = page.getByTestId('labelling-card');
    await expect(labelling.getByText('Label outputs for grades-justified v1')).toBeVisible();
    await labelling.getByTestId('label-output').getByRole('button', { name: 'Fail' }).click();
    await expect(labelling.getByText('labelled fail')).toBeVisible({ timeout: 10_000 });
    await expect(labelling.getByTestId('label-counts')).toContainText('1 output(s) labelled, 1 fail');
    await labelling.getByRole('button', { name: 'Add labelled outputs as Eval Cases' }).click();
    await expect(labelling.getByText('1 Eval Case(s) added.')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/From run .* \(\d{4}-\d{2}-\d{2}\)/)).toBeVisible();

    // A risk of the plan asks the assistant to draft its check.
    const plan = page.getByTestId('plan-card');
    await expect(plan.getByTestId('plan-risk')).toHaveCount(1);
    await plan.getByRole('button', { name: 'Draft this check' }).click();
    await expect(page.getByText('Drafting the fatal-outcome check now.')).toBeVisible({ timeout: 20_000 });
  });

  test('accepted criteria judge a run, and the person signs a Step Qualification from its report', async ({ page, request }) => {
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
    await post('/api/evaluation/briefs', { ...step, text: 'Grades AEs for the DSMB.' });
    await post('/api/evaluation/evaluators', { ...step, name: 'summary-present', rule: 'The result carries a summary.', severity: 'critical', check: { kind: 'schema', schema: { required: ['summary'] } } });
    await post('/api/evaluation/evaluators', { ...step, name: 'findings-present', rule: 'The result lists findings.', severity: 'major', check: { kind: 'schema', schema: { required: ['findings'] } } });
    await post('/api/evaluation/cases/from-agent-run', { agentRunId, expectation: 'positive' });
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
    await expect(page.getByTestId('step-qualification-badge')).toHaveAttribute('data-status', 'not_qualified', { timeout: 10_000 });
    await page.getByTestId('evaluation-assistant-input').fill(question);
    await page.getByTestId('evaluation-assistant-send').click();
    const criteriaCard = page.getByTestId('proposal-card').filter({ hasText: 'Proposed Acceptance Criteria' });
    await criteriaCard.getByTestId('proposal-accept').click();
    await expect(criteriaCard.getByText('Accepted')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('acceptance-criteria')).toHaveText('critical: lower bound ≥ 0.1; major: lower bound ≥ 0.5');

    // The run is prepared and confirmed over the API; the report is read and signed in the tab.
    const prepared = EvalRunOutputSchema.parse(await post('/api/evaluation/runs', { ...step, trialsPerCase: 1, budgetUsd: 1 }));
    await post(`/api/evaluation/runs/${prepared.evalRun.id}/start`, { confirmedBudgetUsd: 1 });
    await pollUntil(async () => {
      const res = await request.get(`/api/evaluation/runs/${prepared.evalRun.id}`, { headers: AUTH_HEADERS });
      return EvalRunOutputSchema.parse(await res.json()).evalRun.status === 'completed' ? true : null;
    }, { description: 'the Eval Run to complete', timeoutMs: 90_000 });

    await page.reload();
    await page.getByRole('button', { name: prepared.evalRun.id.slice(0, 8) }).click();
    const report = page.getByTestId('variant-report');
    await expect(report.getByTestId('criteria-verdicts')).toContainText('critical met');
    await expect(report.getByTestId('criteria-verdicts')).toContainText('major missed');
    await report.getByTestId('sign-qualification').click();
    const form = page.getByTestId('sign-qualification-form');
    await expect(form).toContainText('as stated in Evaluation Brief v1');
    await form.getByLabel('Justification for the major criterion').fill('Findings are listed downstream; a reviewer reads every grade.');
    await form.getByLabel('Your password').fill(TEST_USER_PASSWORD);
    await form.getByRole('button', { name: 'Sign' }).click();

    await expect(page.getByTestId('step-qualification-badge')).toHaveAttribute('data-status', 'qualified', { timeout: 10_000 });
    await expect(page.getByTestId('step-qualification')).toContainText('Deviation (major): Findings are listed downstream');
  });
});
